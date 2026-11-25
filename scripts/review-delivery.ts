import { database, closeDatabase, withAccountLock } from '../src/services/database.service';

async function main() {
  const [userId, runId, deliveryKey, decision] = process.argv.slice(2);
  if (!/^[\da-f-]{36}$/i.test(userId || '') || !/^[\da-f-]{36}$/i.test(runId || '') ||
    !/^[\da-f]{64}$/i.test(deliveryKey || '') || !['sent', 'retry'].includes(decision)) {
    throw new Error('Usage: npm run delivery:review -- USER_UUID RUN_UUID DELIVERY_KEY sent|retry');
  }
  await withAccountLock(userId, async () => {
    const client = await database().connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query('SELECT id FROM bird.runs WHERE id = $1 AND user_id = $2 FOR UPDATE', [runId, userId]);
      if (!owned.rowCount) throw new Error('Run not found for this account');
      const query = decision === 'sent'
        ? "UPDATE bird.deliveries SET status = 'sent' WHERE run_id = $1 AND delivery_key = $2 AND status != 'sent'"
        : "DELETE FROM bird.deliveries WHERE run_id = $1 AND delivery_key = $2 AND status != 'sent'";
      const result = await client.query(query, [runId, deliveryKey]);
      if (!result.rowCount) throw new Error('No uncertain delivery found');
      await client.query("UPDATE bird.runs SET status = 'failed', message = 'Delivery reviewed by administrator; ready to retry.' WHERE id = $1", [runId]);
      await client.query('COMMIT');
      console.log('Review saved. The next workflow attempt can resume after all uncertain deliveries are reviewed.');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Delivery review failed'); process.exitCode = 1; }).finally(closeDatabase);
