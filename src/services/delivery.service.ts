import { accountContext } from '../core/account-context';
import { database, assertWorkflowLock } from './database.service';
import { hash } from './account.service';

export async function deliverOnce(key: string, send: () => Promise<unknown>): Promise<void> {
  const runId = accountContext.getStore()?.runId;
  if (!runId) { await send(); return; }
  await assertWorkflowLock();
  const deliveryKey = hash(key);
  const inserted = await database().query(`INSERT INTO bird.deliveries (run_id, delivery_key, status)
    VALUES ($1, $2, 'sending') ON CONFLICT DO NOTHING RETURNING status`, [runId, deliveryKey]);
  if (!inserted.rowCount) {
    const existing = await database().query('SELECT status FROM bird.deliveries WHERE run_id = $1 AND delivery_key = $2', [runId, deliveryKey]);
    if (existing.rows[0]?.status === 'sent') return;
    throw new Error('A previous notification has uncertain delivery; review it before retrying');
  }
  try {
    await send();
    await database().query("UPDATE bird.deliveries SET status = 'sent' WHERE run_id = $1 AND delivery_key = $2", [runId, deliveryKey]);
  } catch (error) {
    await database().query("UPDATE bird.deliveries SET status = 'uncertain' WHERE run_id = $1 AND delivery_key = $2", [runId, deliveryKey]);
    throw error;
  }
}
