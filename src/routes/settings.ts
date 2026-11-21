import { Router } from 'express';
import { query } from '../db';
import { authMiddleware } from '../auth';
import { BASE_DOMAIN } from '../config';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  const rows = await query('SELECT key,value FROM settings');
  const obj: any = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  // Keep the base zone visible to the dashboard; per-network domains are
  // stored on each router and are no longer overwritten here.
  obj.main_domain = BASE_DOMAIN;
  res.json(obj);
});

router.patch('/', async (req, res) => {
  const requested = req.body?.main_domain;
  if (requested !== undefined && String(requested).trim().toLowerCase().replace(/\.$/, '') !== BASE_DOMAIN) {
    return res.status(400).json({ error: `النطاق الأساسي ثابت: ${BASE_DOMAIN} — اختر النطاق الفرعي لكل شبكة على حدة` });
  }
  // Never rewrite routers.hotspot_dns_name: apex and subdomains both work now.
  await query("INSERT INTO settings(key,value) VALUES('main_domain',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [BASE_DOMAIN]);
  const rows = await query('SELECT key,value FROM settings');
  const obj: any = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  obj.main_domain = BASE_DOMAIN;
  res.json(obj);
});

export default router;
