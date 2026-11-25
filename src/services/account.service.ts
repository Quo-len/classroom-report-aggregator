import { createHash, randomBytes } from 'crypto';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { database } from './database.service';
import { encrypt, decrypt } from './token-crypto';
import { getWebEnv } from '../config/web-env';
import { accountContext } from '../core/account-context';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');

export function oauthClient(): OAuth2Client {
  const config = getWebEnv();
  return new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, `${new URL(config.APP_URL).origin}/auth/callback`);
}

export async function saveTokens(userId: string, tokens: Credentials): Promise<void> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT tokens FROM bird.users WHERE id = $1 FOR UPDATE', [userId]);
    if (!result.rows[0]) throw new Error('Account not found');
    const previous = result.rows[0].tokens ? decrypt<Credentials>(result.rows[0].tokens, userId) : {};
    const defined = Object.fromEntries(Object.entries(tokens).filter(([, value]) => value != null));
    await client.query('UPDATE bird.users SET tokens = $2 WHERE id = $1', [userId, encrypt({ ...previous, ...defined }, userId)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function withAccount<T>(userId: string, action: () => Promise<T>, dryRun = false, requireSettings = true): Promise<T> {
  const result = await database().query('SELECT u.tokens, s.value FROM bird.users u LEFT JOIN bird.settings s ON s.user_id = u.id WHERE u.id = $1', [userId]);
  const row = result.rows[0];
  if (!row?.tokens) throw new Error('Reconnect your Google account');
  if (requireSettings && !row.value) throw new Error('Complete account setup first');
  const auth = oauthClient();
  auth.setCredentials(decrypt<Credentials>(row.tokens, userId));
  let pending: Promise<void> = Promise.resolve();
  let saveError: unknown;
  auth.on('tokens', tokens => {
    pending = pending.then(() => saveTokens(userId, tokens)).catch(error => { saveError = error; });
  });
  try {
    await auth.getAccessToken();
    await pending;
    if (saveError) throw new Error('Unable to save refreshed authorization');
    return await accountContext.run({ userId, auth, settings: row.value || {}, dryRun }, action);
  } finally {
    await pending;
    if (saveError) console.error('Failed to persist refreshed Google authorization');
  }
}
