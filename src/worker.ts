import cron from 'node-cron';
import { query, one } from './db';
import { issueCertificate } from './acme-issue';

async function issueMissing() {
  // routers without any issued cert
  const rows = await query(`SELECT r.id FROM routers r WHERE r.status='active' AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.router_id=r.id AND c.status='issued')`);
  for (const r of rows) {
    try {
      await Promise.race([
        issueCertificate(r.id),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 120s')), 120000)),
      ]);
      console.log('[worker] issued for', r.id);
    } catch (e: any) {
      console.error('[worker] issue failed', r.id, e.message);
    }
  }
}

async function renewScan() {
  console.log('[worker] renew scan tick');
  const rows = await query(`SELECT router_id FROM certificates WHERE status='issued' AND renewal_enabled=true AND not_after < now() + interval '14 days'`);
  for (const r of rows) {
    try {
      await Promise.race([
        issueCertificate(r.router_id),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 120s')), 120000)),
      ]);
      console.log('[worker] renewed for', r.router_id);
    } catch (e: any) {
      console.error('[worker] renew failed', r.router_id, e.message);
    }
  }
}

// run issueMissing on startup
issueMissing().catch(e => console.error(e));
cron.schedule('0 */6 * * *', () => { renewScan().catch(console.error); issueMissing().catch(console.error); });
console.log('worker started');
setInterval(() => {}, 1 << 30);
