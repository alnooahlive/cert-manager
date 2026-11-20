import pool from './db';
import { runMigrations } from './migration-runner';

runMigrations(pool)
  .then(() => pool.end())
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
