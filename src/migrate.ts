import fs from 'fs/promises';
import path from 'path';
import { database, closeDatabase } from './services/database.service';

export async function migrate(directory = path.resolve('migrations')) {
  const client = await database().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('schema-migrations', 0))");
    await client.query('CREATE SCHEMA IF NOT EXISTS bird');
    await client.query('CREATE TABLE IF NOT EXISTS bird.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await fs.readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      if ((await client.query('SELECT 1 FROM bird.schema_migrations WHERE name = $1', [name])).rows.length) continue;
      const sql = (await fs.readFile(path.join(directory, name), 'utf8')).replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO bird.schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtextextended('schema-migrations', 0))"); }
    finally { client.release(); }
  }
}

if (require.main === module) {
  migrate().catch(() => { console.error('Database migration failed; check connection and schema permissions.'); process.exitCode = 1; }).finally(closeDatabase);
}
