import { Router } from 'express';
import pool from '../db';
import { checkAgentCertificate } from '../cert-monitor';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', ts: new Date().toISOString() });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

router.get('/agent-cert', async (_req, res) => {
  res.json(await checkAgentCertificate());
});

export default router;
