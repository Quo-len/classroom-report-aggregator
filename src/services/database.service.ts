import { Pool } from 'pg';
import { getWebEnv } from '../config/web-env';
import { AsyncLocalStorage } from 'async_hooks';

let pool: Pool | undefined;
let locks: Pool | undefined;
const activeLock = new AsyncLocalStorage<() => Promise<void>>();

export function database(): Pool {
  if (!pool) {
    const config = getWebEnv();
    const url = new URL(config.DATABASE_URL);
    // pg connection-string SSL options would override certificate verification below.
    for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
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
  await locks?.end();
  locks = undefined;
  await pool?.end();
  pool = undefined;
}

export async function withAccountLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  // Dedicated connections prevent long-running locks from exhausting the query pool.
  if (!locks) {
    const options = database().options;
    locks = new Pool({ ...options, max: 2 });
    locks.on('error', () => console.error('Workflow lock connection failed'));
  }
  const client = await locks.connect();
  let locked = false;
  let connectionLost = false;
  const onError = () => { connectionLost = true; };
  client.on('error', onError);
  try {
    const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key]);
    locked = result.rows[0].locked;
    if (!locked) throw Object.assign(new Error('Account already has a running operation'), { statusCode: 409 });
    return await activeLock.run(async () => {
      if (connectionLost) throw new Error('Workflow lock connection was lost');
      await client.query('SELECT 1');
    }, action);
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]); }
    finally { client.removeListener('error', onError); client.release(connectionLost); }
  }
}

export async function assertWorkflowLock(): Promise<void> {
  await activeLock.getStore()?.();
}
