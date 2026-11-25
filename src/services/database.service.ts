import { Pool } from 'pg';
import { getWebEnv } from '../config/web-env';

let pool: Pool | undefined;

export function database(): Pool {
  if (!pool) {
    const config = getWebEnv();
    const url = new URL(config.DATABASE_URL);
    // pg connection-string SSL options would override certificate verification below.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    pool = new Pool({
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: true, ...(config.DATABASE_CA ? { ca: config.DATABASE_CA.replace(/\\n/g, '\n') } : {}) },
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', () => console.error('PostgreSQL idle connection failed'));
  }
  return pool;
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
