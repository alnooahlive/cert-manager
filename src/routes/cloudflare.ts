import { Router } from 'express';
import { authMiddleware } from '../auth';
import { checkDns, ensureARecord } from '../cloudflare';

const router = Router();
router.use(authMiddleware);

router.get('/check', async (req, res) => {
  const name = String(req.query.name || process.env.AGENT_HOST);
  const r = await checkDns(name);
  res.json(r);
});

router.post('/ensure-a', async (req, res) => {
  const { name, ip } = req.body || {};
  try {
    const id = await ensureARecord(name, ip);
    res.json({ ok: true, id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
