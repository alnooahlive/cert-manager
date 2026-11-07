import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  const rows = await query('SELECT key,value FROM settings');
  const obj: any = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

router.patch('/', async (req, res) => {
  const { main_domain, apply_to_all } = req.body || {};
  if (main_domain) {
    const oldRow = await one("SELECT value FROM settings WHERE key='main_domain'");
    const oldDomain = oldRow ? oldRow.value : null;
    await query("INSERT INTO settings(key,value) VALUES('main_domain',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [main_domain]);
    if (apply_to_all && oldDomain && oldDomain !== main_domain) {
      await query(`UPDATE routers SET hotspot_dns_name = replace(hotspot_dns_name, $1, $2)`, [oldDomain, main_domain]);
    }
  }
  const rows = await query('SELECT key,value FROM settings');
  const obj: any = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

export default router;
