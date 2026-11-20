import cron from 'node-cron';
import { one } from './db';
import { ensureSharedCertificate } from './cert-service';
import { checkAgentCertificate } from './cert-monitor';

// ONE shared certificate for the unified domain. No per-router issuance, ever.
// The worker only renews the shared certificate when it is close to expiry.
async function renewScan() {
  console.log('[worker] shared certificate renew scan tick');
  const s = await one(`SELECT status, not_after, last_renewal_attempt_at, renewal_failures FROM shared_certificate WHERE id=1`);
  if (!s || s.status !== 'issued' || !s.not_after) {
    console.log('[worker] no shared certificate yet — skipping (no auto-create)');
    return;
  }
  if (s.last_renewal_attempt_at && (Date.now() - new Date(s.last_renewal_attempt_at).getTime()) < 6 * 3600000) {
    console.log('[worker] renewal attempted recently — cooling down');
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

async function agentCertWatch() {
  const c = await checkAgentCertificate();
  if (!c.ok) console.warn(`[worker] agent certificate warning: ${c.error || `only ${c.daysLeft} days left`}`);
  else console.log('[worker] agent certificate ok until', c.notAfter);
}

cron.schedule('0 */6 * * *', () => { renewScan().catch(console.error); });
cron.schedule('0 8 * * *', () => { agentCertWatch().catch(console.error); });
console.log('worker started (shared certificate renewal only — no per-router issuance)');
setInterval(() => {}, 1 << 30);
