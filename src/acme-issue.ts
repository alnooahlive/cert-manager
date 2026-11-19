import acme from 'acme-client';
import crypto from 'crypto';
import { query, one } from './db';
import { cfRequest } from './cloudflare';

const ACME_ENV = process.env.ACME_ENV || 'staging';
const ACME_EMAIL = process.env.ACME_EMAIL || 'admin@alnooah.pro';
const LOCK_MINUTES = 3;

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

export async function issueCertificate(routerId: string, opts: { force?: boolean } = {}) {
  const router = await one('SELECT * FROM routers WHERE id=$1', [routerId]);
  if (!router) throw new Error('router not found');
  const domain = router.hotspot_dns_name;
  const owner = makeOwner();

  // ---- domain lock: only one ACME challenge per domain at a time ----
  let lock = await acquireDomainLock(domain, owner);
  if (!lock) {
    for (let i = 0; i < 12; i++) {
      await new Promise(res => setTimeout(res, 5000));
      lock = await acquireDomainLock(domain, owner);
      if (lock) break;
    }
    if (!lock) {
      console.log('[acme] domain busy, skipping:', domain);
      await query('UPDATE routers SET last_issue_error=$1,last_issue_at=now() WHERE id=$2', ['النطاق مشغول بإصدار آخر، أعد المحاولة لاحقاً', routerId]);
      return { version: 0, notAfter: new Date(), skipped: true, reason: 'domain busy' };
    }
  }

  try {
    // ---- router lock: atomic, prevents worker + API double run ----
    const routerLock = await one(
      `UPDATE routers SET issuing_at=now() WHERE id=$1
       AND (issuing_at IS NULL OR issuing_at < now() - ($2 || ' minutes')::interval)
       RETURNING id`, [routerId, String(LOCK_MINUTES)]);
    if (!routerLock) {
      await query('UPDATE routers SET last_issue_error=$1,last_issue_at=now() WHERE id=$2', ['جارٍ إصدار شهادة لهذا الراوتر', routerId]);
      return { version: 0, notAfter: new Date(), skipped: true, reason: 'router busy' };
    }

    try {
      console.log('[acme] starting issuance for router', routerId, 'domain', domain);
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

      const last = await one('SELECT COALESCE(MAX(version),0) AS v FROM certificates WHERE router_id=$1', [routerId]);
      const version = (last?.v || 0) + 1;
      await query(
        `INSERT INTO certificates(router_id,version,status,source,acme_managed,fullchain_pem,privkey_pem,not_before,not_after)
         VALUES($1,$2,'issued','acme',true,$3,$4,$5,$6)`,
        [routerId, version, fullchain, privkey, notBefore, notAfter]
      );
      await query('UPDATE routers SET last_issue_error=NULL,last_issue_at=now() WHERE id=$1', [routerId]);
      console.log('[acme] issued', routerId, 'version', version);
      return { version, notAfter };
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 500);
      console.error('[acme] FAILED', routerId, msg);
      await query('UPDATE routers SET last_issue_error=$1,last_issue_at=now() WHERE id=$2', [msg, routerId]);
      throw e;
    } finally {
      await query('UPDATE routers SET issuing_at=NULL WHERE id=$1', [routerId]);
    }
  } finally {
    await query('DELETE FROM issuance_locks WHERE domain=$1 AND owner=$2', [domain, owner]);
  }
}
