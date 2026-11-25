import { database, closeDatabase } from '../src/services/database.service';
import { getWebEnv } from '../src/config/web-env';

async function main() {
  const config = getWebEnv();
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const namespaces = await client.query("SELECT to_regnamespace('cron') AS cron, to_regnamespace('net') AS net, to_regnamespace('vault') AS vault");
    if (!namespaces.rows[0].cron || !namespaces.rows[0].net || !namespaces.rows[0].vault) {
      throw new Error('Enable pg_cron, pg_net and Vault in Supabase first.');
    }
    for (const [name, value] of [
      ['bird_app_url', new URL(config.APP_URL).origin], ['bird_cron_secret', config.CRON_SECRET],
    ]) {
      const existing = await client.query('SELECT id FROM vault.secrets WHERE name = $1', [name]);
      if (existing.rows[0]) await client.query('SELECT vault.update_secret($1::uuid, $2::text, $3::text, $4::text)', [existing.rows[0].id, value, name, 'Bird scheduler']);
      else await client.query('SELECT vault.create_secret($1, $2, $3)', [value, name, 'Bird scheduler']);
    }
    await client.query(`SELECT cron.schedule('bird-account-workflows', '0 * * * *', $1)`, [`
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bird_app_url') || '/internal/scheduled',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
          'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bird_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    `]);
    await client.query('COMMIT');
    console.log('Hourly scheduler configured. Only accounts with automation enabled will run.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
main().catch(() => {
  console.error('Scheduler setup failed. Check the Supabase connection, extensions and administrator permissions.');
  process.exitCode = 1;
}).finally(closeDatabase);
