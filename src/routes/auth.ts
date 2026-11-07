import { Router } from 'express';
import { query, one } from '../db';
import { hashPassword, verifyPassword, signToken } from '../auth';
import cookieParser from 'cookie-parser';

const router = Router();

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
