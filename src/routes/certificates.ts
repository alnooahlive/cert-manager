import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  const rows = await query(`SELECT c.*, r.router_name, r.network_name FROM certificates c LEFT JOIN routers r ON r.id=c.router_id ORDER BY c.created_at DESC`);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { router_id, source } = req.body || {};
  const rows = await query('INSERT INTO certificates(router_id, source) VALUES($1,$2) RETURNING *', [router_id || null, source || 'acme']);
  res.json(rows[0]);
});

router.get('/:id', async (req, res) => {
  const row = await one('SELECT * FROM certificates WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  const row = await one(
    `UPDATE certificates SET
       status=COALESCE($1,status),
       renewal_enabled=COALESCE($2,renewal_enabled),
       revoked_at=CASE WHEN $1='revoked' THEN now() ELSE revoked_at END,
       updated_at=now()
     WHERE id=$3 RETURNING *`,
    [b.status, b.renewal_enabled, req.params.id]
  );
  res.json(row);
});

router.post('/:id/import', async (req, res) => {
  const { fullchain_pem, privkey_pem } = req.body || {};
  const row = await one('UPDATE certificates SET fullchain_pem=$1, privkey_pem=$2, source=\'imported\', acme_managed=false, status=\'issued\', updated_at=now() WHERE id=$3 RETURNING *', [fullchain_pem, privkey_pem, req.params.id]);
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM certificates WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
