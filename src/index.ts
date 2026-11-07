import fs from 'fs';
import path from 'path';
import pool from './db';
import app from './server';

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
  } catch (e) {
    console.error('migration error', e);
  }
}

async function main() {
  await runMigrations();
  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => {
    console.log(`cert-manager listening on ${port}`);
  });
}

main();
