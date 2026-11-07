import fs from 'fs';
import path from 'path';
import pool from './db';

async function main() {
  const dir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log('running', f);
    await pool.query(sql);
  }
  await pool.end();
  console.log('migrations done');
}

main().catch(e => { console.error(e); process.exit(1); });
