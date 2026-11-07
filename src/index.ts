import fs from 'fs';
import path from 'path';
import pool from './db';
import app from './server';
import { hashPassword } from './auth';

// env validation
function validateEnv() {
  const required = ['DATABASE_URL', 'SESSION_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('missing env vars:', missing.join(', '));
    process.exit(1);
  }
}

async function runMigrations() {
  try {
    const dir = path.join(process.cwd(), 'migrations');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      console.log('running migration', f);
      await pool.query(sql);
    }
    console.log('migrations done');
    // seed admin if none
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@alnooah.pro';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!ChangeMe';
    const hash = await hashPassword(adminPassword);
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
    if (existing.rows.length === 0) {
      await pool.query('INSERT INTO users(email,password_hash) VALUES($1,$2)', [adminEmail, hash]);
      console.log('seeded admin:', adminEmail);
    } else {
      await pool.query('UPDATE users SET password_hash=$1 WHERE email=$2', [hash, adminEmail]);
      console.log('updated admin password:', adminEmail);
    }
  } catch (e) {
    console.error('migration error', e);
  }
}

async function main() {
  validateEnv();
  await runMigrations();
  const port = parseInt(process.env.PORT || '3000', 10);
  const server = app.listen(port, () => {
    console.log(`cert-manager listening on ${port}`);
  });
  const shutdown = (sig: string) => {
    console.log(`received ${sig}, shutting down`);
    server.close(() => { pool.end().then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
