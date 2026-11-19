import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';
import { FORCED_DOMAIN } from '../config';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  const rows = await query('SELECT key,value FROM settings');
  const obj: any = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

router.patch('/', async (req, res) => {
  // domain is fixed — ignore any submitted value
  await query("INSERT INTO settings(key,value) VALUES('main_domain',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [FORCED_DOMAIN]);
  await query('UPDATE routers SET hotspot_dns_name=$1 WHERE hotspot_dns_name IS DISTINCT FROM $1', [FORCED_DOMAIN]);
  const rows = await query('SELECT key,value FROM settings');
  const obj: any = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

export default router;
