import cron from 'node-cron';
import { one } from './db';
import { ensureSharedCertificate } from './cert-service';

// ONE shared certificate for the unified domain. No per-router issuance, ever.
// The worker only renews the shared certificate when it is close to expiry.
async function renewScan() {
  console.log('[worker] shared certificate renew scan tick');
  const s = await one(`SELECT status, not_after FROM shared_certificate WHERE id=1`);
  if (!s || s.status !== 'issued' || !s.not_after) {
    console.log('[worker] no shared certificate yet — skipping (no auto-create)');
    return;
  }
  const daysLeft = (new Date(s.not_after).getTime() - Date.now()) / 86400000;
  if (daysLeft > 14) {
    console.log('[worker] shared certificate still valid for', Math.floor(daysLeft), 'days — skipping');
    return;
  }
  try {
    await Promise.race([
      ensureSharedCertificate({ force: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 120s')), 120000)),
    ]);
    console.log('[worker] shared certificate renewed');
  } catch (e: any) {
    console.error('[worker] shared renewal failed', e.message);
  }
}

cron.schedule('0 */6 * * *', () => { renewScan().catch(console.error); });
console.log('worker started (shared certificate renewal only — no per-router issuance)');
setInterval(() => {}, 1 << 30);
