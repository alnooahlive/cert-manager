import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';

// Tracked migrations: each file runs once, and only again if its content changes.
export async function runMigrations(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      filename TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const dir = path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const hash = crypto.createHash('sha256').update(sql).digest('hex');
    const row: any = await pool.query('SELECT hash FROM applied_migrations WHERE filename=$1', [f]);
    const prev = row.rows[0];
    if (prev && prev.hash === hash) continue;
    console.log(prev ? '[migrate] re-applying changed' : '[migrate] applying', f);
    await pool.query(sql);
    await pool.query(
      `INSERT INTO applied_migrations(filename,hash) VALUES($1,$2)
       ON CONFLICT (filename) DO UPDATE SET hash=$2, applied_at=now()`,
      [f, hash]
    );
  }
  console.log('[migrate] done');
}
