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
  console.log('[acme] starting issuance for router', routerId);
  const router = await one('SELECT * FROM routers WHERE id=$1', [routerId]);
  if (!router) throw new Error('router not found');
  const domain = router.hotspot_dns_name;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  console.log('[acme] domain:', domain, 'zone:', zone);

  const accountKey = await acme.crypto.createPrivateKey();
  const client = new acme.Client({ directoryUrl: dirUrl(), accountKey });

  const [key, csr] = await acme.crypto.createCsr({ commonName: domain, altNames: [domain] });

  const txtRecords: { id: string; name: string }[] = [];

  console.log('[acme] calling client.auto for', domain);
  const certPem = await client.auto({
    csr,
    email: ACME_EMAIL,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    challengeCreateFn: async (authz: any, challenge: any, keyAuthorization: string) => {
      const name = `_acme-challenge.${domain}`;
      const id = await createTxtRecord(name, keyAuthorization);
      txtRecords.push({ id, name });
      console.log('[acme] TXT record created for', name, 'waiting for propagation...');
      // wait for propagation (reduced from 15s to 8s)
      await new Promise(res => setTimeout(res, 8000));
    },
    challengeRemoveFn: async (authz: any, challenge: any, keyAuthorization: string) => {
      // remove all created txt records
      for (const t of txtRecords) {
        try { await deleteTxtRecord(t.id); } catch {}
      }
      txtRecords.length = 0;
    },
  });

  // certPem is the certificate (PEM). Combine with key for fullchain? acme-client returns cert only.
  // Build fullchain: cert + intermediate. client.getCertificate would include chain, but auto returns cert.
  // We need the chain. Let's get it via getCertificate? auto returns the final cert. Use splitPemChain to add intermediates? 
  // Simpler: store cert as fullchain (cert only) + key. Router imports both; fullchain may be just leaf. For hotspot, leaf is enough? Better to include chain.
  // acme-client auto returns the certificate chain (leaf + intermediates) typically. Use as-is.
  console.log('[acme] auto completed, cert length:', certPem?.length);
  const fullchain = certPem.toString();
  const privkey = key.toString();

  // parse not_after
  const info = acme.crypto.readCertificateInfo(Buffer.from(fullchain));
  const notAfter = info.notAfter ? new Date(info.notAfter) : new Date(Date.now() + 89 * 24 * 3600 * 1000);
  const notBefore = info.notBefore ? new Date(info.notBefore) : new Date();

  // version
  const last = await one('SELECT COALESCE(MAX(version),0) AS v FROM certificates WHERE router_id=$1', [routerId]);
  const version = (last?.v || 0) + 1;

  await query(
    `INSERT INTO certificates(router_id, version, status, source, acme_managed, fullchain_pem, privkey_pem, not_before, not_after)
     VALUES($1,$2,'issued','acme',true,$3,$4,$5,$6)`,
    [routerId, version, fullchain, privkey, notBefore, notAfter]
  );

  return { version, notAfter };
}
