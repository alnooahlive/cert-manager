import acme from 'acme-client';
import crypto from 'crypto';
import { query, one } from './db';
import { cfRequest } from './cloudflare';

const ACME_ENV = process.env.ACME_ENV || 'staging';
const ACME_EMAIL = process.env.ACME_EMAIL || 'admin@alnooah.pro';

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

export async function issueCertificate(routerId: string) {
  // prevent concurrent issuance for the same router
  const lock = await one('SELECT issuing_at FROM routers WHERE id=$1', [routerId]);
  if (lock?.issuing_at && new Date(lock.issuing_at).getTime() > Date.now() - 180000) {
    console.log('[acme] skipping', routerId, '- already issuing');
    return { version: 0, notAfter: new Date(), skipped: true };
  }
  await query('UPDATE routers SET issuing_at=now() WHERE id=$1', [routerId]);
  console.log('[acme] starting issuance for router', routerId);
  const router = await one('SELECT * FROM routers WHERE id=$1', [routerId]);
  if (!router) { await query('UPDATE routers SET issuing_at=NULL WHERE id=$1', [routerId]); throw new Error('router not found'); }
  const domain = router.hotspot_dns_name;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  console.log('[acme] domain:', domain, 'zone:', zone);

  const accountKey = await acme.crypto.createPrivateKey();
  const client = new acme.Client({ directoryUrl: dirUrl(), accountKey });

  const [key, csr] = await acme.crypto.createCsr({ commonName: domain, altNames: [domain] });

  const txtRecords: { id: string; name: string }[] = [];

  console.log('[acme] calling client.auto for', domain);
  let certPem: any;
  try {
    certPem = await client.auto({
    csr,
    email: ACME_EMAIL,
    termsOfServiceAgreed: true,
    skipChallengeVerification: true,
    challengePriority: ['dns-01'],
    challengeCreateFn: async (authz: any, challenge: any, keyAuthorization: string) => {
      const name = `_acme-challenge.${domain}`;
      const id = await createTxtRecord(name, keyAuthorization);
      txtRecords.push({ id, name });
      console.log('[acme] TXT record created for', name, 'waiting for propagation...');
      await new Promise(res => setTimeout(res, 8000));
    },
    challengeRemoveFn: async (authz: any, challenge: any, keyAuthorization: string) => {
      for (const t of txtRecords) {
        try { await deleteTxtRecord(t.id); } catch {}
      }
      txtRecords.length = 0;
    },
  });
  } catch (e: any) {
    console.error('[acme] auto FAILED:', e.message);
    // cleanup TXT records
    for (const t of txtRecords) {
      try { await deleteTxtRecord(t.id); } catch {}
    }
    txtRecords.length = 0;
    await query('UPDATE routers SET issuing_at=NULL WHERE id=$1', [routerId]);
    throw e;
  }

  console.log('[acme] auto completed, cert length:', certPem?.length);
  const fullchain = certPem.toString();
  const privkey = key.toString();

  const info = acme.crypto.readCertificateInfo(Buffer.from(fullchain));
  const notAfter = info.notAfter ? new Date(info.notAfter) : new Date(Date.now() + 89 * 24 * 3600 * 1000);
  const notBefore = info.notBefore ? new Date(info.notBefore) : new Date();

  const last = await one('SELECT COALESCE(MAX(version),0) AS v FROM certificates WHERE router_id=$1', [routerId]);
  const version = (last?.v || 0) + 1;

  await query(
    `INSERT INTO certificates(router_id, version, status, source, acme_managed, fullchain_pem, privkey_pem, not_before, not_after)
     VALUES($1,$2,'issued','acme',true,$3,$4,$5,$6)`,
    [routerId, version, fullchain, privkey, notBefore, notAfter]
  );

  await query('UPDATE routers SET issuing_at=NULL WHERE id=$1', [routerId]);
  console.log('[acme] issuance completed for', routerId, 'version', version);
  return { version, notAfter };
}
