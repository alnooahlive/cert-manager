import pool from './db';
import app from './server';
import { hashPassword } from './auth';
import { runMigrations } from './migration-runner';

// env validation
function validateEnv() {
  const required = ['DATABASE_URL', 'SESSION_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('missing env vars:', missing.join(', '));
    process.exit(1);
  }
}

async function bootstrap() {
  try {
    await runMigrations(pool);
    // Seed admin only when missing. Manual password changes survive deployments.
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@alnooah.pro';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!ChangeMe';
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
    if (existing.rows.length === 0) {
      const hash = await hashPassword(adminPassword);
      await pool.query('INSERT INTO users(email,password_hash) VALUES($1,$2)', [adminEmail, hash]);
      console.log('seeded admin:', adminEmail);
    }
    if (process.env.ADMIN_RESET_PASSWORD === 'true') {
      const hash = await hashPassword(adminPassword);
      await pool.query('UPDATE users SET password_hash=$1 WHERE email=$2', [hash, adminEmail]);
      console.log('admin password reset by env flag');
    }
  } catch (e) {
    console.error('bootstrap error', e);
  }
}

async function main() {
  validateEnv();
  await bootstrap();
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
