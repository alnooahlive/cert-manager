import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  const rows = await query(`SELECT c.*, (SELECT COUNT(*)::int FROM routers r WHERE r.customer_id=c.id) AS actual_routers FROM customers c ORDER BY c.created_at DESC`);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const rows = await query('INSERT INTO customers(name,phone,email,router_count) VALUES($1,$2,$3,$4) RETURNING *', [b.name, b.phone || null, b.email || null, b.router_count || 1]);
  res.json(rows[0]);
});

router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  const row = await one('UPDATE customers SET name=COALESCE($1,name), phone=COALESCE($2,phone), email=COALESCE($3,email), router_count=COALESCE($4,router_count), updated_at=now() WHERE id=$5 RETURNING *', [b.name, b.phone, b.email, b.router_count, req.params.id]);
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM customers WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
