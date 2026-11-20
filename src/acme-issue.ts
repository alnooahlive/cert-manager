import acme from 'acme-client';
import crypto from 'crypto';
import { query, one } from './db';
import { cfRequest } from './cloudflare';
import { FORCED_DOMAIN } from './config';

const ACME_ENV = process.env.ACME_ENV || 'staging';
const ACME_EMAIL = process.env.ACME_EMAIL || 'admin@alnooah.pro';
const LOCK_MINUTES = 3;
const MIN_INTERVAL_HOURS = 24;
const MAX_PER_WEEK = 4;

// Budget guard: at most one issuance per 24h and at most four per 7 days.
async function checkIssuanceBudget(domain: string) {
  const recent: any = await one(
    `SELECT issued_at FROM issuance_history WHERE domain=$1
     AND issued_at > now() - ($2 || ' hours')::interval
     ORDER BY issued_at DESC LIMIT 1`, [domain, String(MIN_INTERVAL_HOURS)]
  );
  if (recent) {
    const next = new Date(new Date(recent.issued_at).getTime() + MIN_INTERVAL_HOURS * 3600000);
    return { ok: false, reason: `تم إصدار شهادة خلال آخر 24 ساعة — أعد المحاولة بعد ${next.toLocaleString('ar')}` };
  }
  const weekly: any = await one(
    `SELECT COUNT(*)::int AS n FROM issuance_history WHERE domain=$1
     AND issued_at > now() - interval '7 days'`, [domain]
  );
  if ((weekly?.n || 0) >= MAX_PER_WEEK) {
    return { ok: false, reason: `تم الوصول للحد الأسبوعي (${MAX_PER_WEEK} إصدارات) — انتظر حتى يتجدد الرصيد` };
  }
  return { ok: true as const, reason: '' };
}

function dirUrl() {
  return ACME_ENV === 'production'
    ? acme.directory.letsencrypt.production
    : acme.directory.letsencrypt.staging;
}

async function createTxtRecord(name: string, content: string) {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const r: any = await cfRequest(`/zones/${zone}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'TXT', name, content, ttl: 120 }),
  });
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.result.id;
}

async function deleteTxtRecord(id: string) {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  await cfRequest(`/zones/${zone}/dns_records/${id}`, { method: 'DELETE' });
}

// Remove leftover TXT records from any previous failed/stuck issuance
async function cleanupStaleTxt(domain: string) {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const name = `_acme-challenge.${domain}`;
  const r: any = await cfRequest(`/zones/${zone}/dns_records?type=TXT&name=${encodeURIComponent(name)}&per_page=100`);
  if (r.success && Array.isArray(r.result)) {
    for (const rec of r.result) {
      try { await deleteTxtRecord(rec.id); console.log('[acme] removed stale TXT', rec.id); } catch {}
    }
  }
}

function makeOwner() {
  return crypto.randomBytes(12).toString('hex');
}

async function acquireDomainLock(domain: string, owner: string) {
  return one(
    `INSERT INTO issuance_locks(domain,locked_at,owner) VALUES($1,now(),$2)
     ON CONFLICT(domain) DO UPDATE SET locked_at=now(),owner=EXCLUDED.owner
     WHERE issuance_locks.locked_at < now() - ($3 || ' minutes')::interval
     RETURNING domain`, [domain, owner, String(LOCK_MINUTES)]);
}

/**
 * Issue ONE shared certificate for the unified apex domain.
 * Stores it in the singleton shared_certificate table. No router_id involved.
 */
export async function issueSharedCertificate(opts: { force?: boolean } = {}) {
  const domain = FORCED_DOMAIN;
  const owner = makeOwner();

  let lock = await acquireDomainLock(domain, owner);
  if (!lock) {
    for (let i = 0; i < 12; i++) {
      await new Promise(res => setTimeout(res, 5000));
      lock = await acquireDomainLock(domain, owner);
      if (lock) break;
    }
    if (!lock) {
      const msg = 'النطاق مشغول بإصدار آخر، أعد المحاولة لاحقاً';
      await query('UPDATE shared_certificate SET last_error=$1,updated_at=now() WHERE id=1', [msg]);
      return { version: 0, notAfter: new Date(), skipped: true, reason: 'domain busy' };
    }
  }

  try {
    const busy = await one(
      `SELECT id FROM shared_certificate WHERE id=1
       AND (issuing_at IS NULL OR issuing_at < now() - ($1 || ' minutes')::interval)
       RETURNING id`, [String(LOCK_MINUTES)]);
    if (!busy) {
      const msg = 'جارٍ إصدار الشهادة المشتركة بالفعل';
      await query('UPDATE shared_certificate SET last_error=$1,updated_at=now() WHERE id=1', [msg]);
      return { version: 0, notAfter: new Date(), skipped: true, reason: 'shared cert busy' };
    }
    const budget = await checkIssuanceBudget(domain);
    if (!budget.ok) {
      await query('UPDATE shared_certificate SET last_error=$1,last_renewal_attempt_at=now(),updated_at=now() WHERE id=1', [budget.reason]);
      console.log('[acme] issuance budget blocked:', budget.reason);
      return { version: 0, notAfter: new Date(), skipped: true, reason: 'budget', message: budget.reason };
    }

    await query('UPDATE shared_certificate SET issuing_at=now(),last_renewal_attempt_at=now(),last_error=NULL,updated_at=now() WHERE id=1');

    try {
      console.log('[acme] issuing shared certificate for', domain);
      await cleanupStaleTxt(domain);
      const accountKey = await acme.crypto.createPrivateKey();
      const client = new acme.Client({ directoryUrl: dirUrl(), accountKey });
      const [key, csr] = await acme.crypto.createCsr({ commonName: domain, altNames: [domain] });
      const txtRecords: { id: string; name: string }[] = [];

      let certPem: any;
      try {
        certPem = await client.auto({
          csr,
          email: ACME_EMAIL,
          termsOfServiceAgreed: true,
          skipChallengeVerification: true,
          challengePriority: ['dns-01'],
          challengeCreateFn: async (_authz: any, _challenge: any, keyAuthorization: string) => {
            const name = `_acme-challenge.${domain}`;
            const id = await createTxtRecord(name, keyAuthorization);
            txtRecords.push({ id, name });
            console.log('[acme] TXT created:', name);
            await new Promise(res => setTimeout(res, 8000));
          },
          challengeRemoveFn: async () => {
            for (const t of txtRecords) { try { await deleteTxtRecord(t.id); } catch {} }
            txtRecords.length = 0;
          },
        });
      } catch (e: any) {
        for (const t of txtRecords) { try { await deleteTxtRecord(t.id); } catch {} }
        txtRecords.length = 0;
        throw e;
      }

      const fullchain = certPem.toString();
      const privkey = key.toString();
      const info = acme.crypto.readCertificateInfo(Buffer.from(fullchain));
      const notAfter = info.notAfter ? new Date(info.notAfter) : new Date(Date.now() + 89 * 24 * 3600 * 1000);
      const notBefore = info.notBefore ? new Date(info.notBefore) : new Date();

      const last = await one('SELECT version FROM shared_certificate WHERE id=1');
      const version = (last?.version || 0) + 1;
      await query(
        `UPDATE shared_certificate SET
           version=$1,status='issued',source='acme',fullchain_pem=$2,privkey_pem=$3,
           not_before=$4,not_after=$5,last_error=NULL,issuing_at=NULL,
           renewal_failures=0,updated_at=now()
         WHERE id=1`,
        [version, fullchain, privkey, notBefore, notAfter]
      );
      await query('INSERT INTO issuance_history(domain,version,reason) VALUES($1,$2,$3)',
        [domain, version, opts.force ? 'renewal' : 'manual']);
      console.log('[acme] shared certificate issued, version', version);
      return { version, notAfter };
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 500);
      console.error('[acme] shared issuance FAILED', msg);
      await query('UPDATE shared_certificate SET last_error=$1,issuing_at=NULL,renewal_failures=renewal_failures+1,last_renewal_attempt_at=now(),updated_at=now() WHERE id=1', [msg]);
      throw e;
    }
  } finally {
    await query('DELETE FROM issuance_locks WHERE domain=$1 AND owner=$2', [domain, owner]);
  }
}

// Backward-compatible alias: never issues per-router certificates.
export async function issueCertificate(routerId: string, opts: { force?: boolean } = {}) {
  console.log('[acme] per-router issuance disabled; using shared certificate', routerId);
  return issueSharedCertificate(opts);
}
