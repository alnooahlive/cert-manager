import { Router } from 'express';
import { query, one } from '../db';
import { hashPassword, verifyPassword, signToken } from '../auth';
import cookieParser from 'cookie-parser';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing' });
  const hash = await hashPassword(password);
  try {
    const rows = await query('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email', [email, hash]);
    res.json(rows[0]);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = await one('SELECT * FROM users WHERE email=$1', [email]);
  if (!u) return res.status(401).json({ error: 'invalid' });
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid' });
  const token = signToken({ id: u.id, email: u.email });
  res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.json({ ok: true, token });
});

router.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

export default router;
