import cron from 'node-cron';
import { query } from './db';

async function renewScan() {
  console.log('[worker] renew scan tick');
  // placeholder: find certs expiring soon
  const rows = await query(`SELECT id,router_id,not_after FROM certificates WHERE status='issued' AND not_after < now() + interval '14 days'`);
  console.log('[worker] expiring soon:', rows.length);
}

cron.schedule('0 */6 * * *', () => { renewScan().catch(console.error); });
console.log('worker started');
// keep alive
setInterval(() => {}, 1 << 30);
