import cron from 'node-cron';
import { query } from './db';
import { ensureCertificate } from './cert-service';

// NO automatic first-time issuance: certificates are created only via the UI button.
// The worker ONLY renews certificates that are about to expire.
async function renewScan() {
  console.log('[worker] renew scan tick');
  const rows = await query(
    `SELECT r.id FROM certificates c
     JOIN routers r ON r.id=c.router_id
     WHERE c.status='issued' AND c.renewal_enabled=true AND c.not_after < now() + interval '14 days'
     GROUP BY r.id`
  );
  for (const r of rows) {
    try {
      await Promise.race([
        ensureCertificate(r.id, { force: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 120s')), 120000)),
      ]);
      console.log('[worker] renewed for', r.id);
    } catch (e: any) {
      console.error('[worker] renew failed', r.id, e.message);
    }
  }
}

cron.schedule('0 */6 * * *', () => { renewScan().catch(console.error); });
console.log('worker started (renewal only — no auto-create)');
setInterval(() => {}, 1 << 30);
