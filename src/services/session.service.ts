import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CodeChallengeMethod, Credentials } from 'google-auth-library';
import { SCOPES } from './auth.service';
import { database } from './database.service';
import { hash, secret, oauthClient, saveTokens } from './account.service';
import { decrypt } from './token-crypto';
import { getWebEnv } from '../config/web-env';

export interface Session { user_id: string; name: string; email: string; csrf_token: string; connected: boolean; }

export function cookie(request: FastifyRequest, name: string): string {
  return (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

function setCookie(reply: FastifyReply, name: string, value: string, seconds: number) {
  const secure = getWebEnv().APP_URL.startsWith('https:') ? '; Secure' : '';
  reply.header('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`);
}

export async function getSession(request: FastifyRequest): Promise<Session | null> {
  const token = cookie(request, 'bird_session');
  if (!/^[\w-]{43}$/.test(token)) return null;
  const result = await database().query(`SELECT s.user_id, s.csrf_token, u.name, u.email, (u.tokens IS NOT NULL) AS connected
    FROM bird.sessions s JOIN bird.users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash(token)]);
  return result.rows[0] || null;
}

export function registerAuth(server: FastifyInstance) {
  server.get('/auth/login', async (_request, reply) => {
    const state = secret(), binding = secret(), verifier = secret(), nonce = secret();
    await database().query('DELETE FROM bird.oauth_attempts WHERE expires_at < now()');
    await database().query(`INSERT INTO bird.oauth_attempts (state_hash, binding_hash, verifier, nonce, expires_at)
      VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`, [hash(state), hash(binding), verifier, nonce]);
    setCookie(reply, 'bird_oauth', binding, 600);
    return reply.redirect(oauthClient().generateAuthUrl({
      scope: ['openid', 'email', 'profile', ...SCOPES], access_type: 'offline', prompt: 'consent',
      state, nonce, code_challenge: Buffer.from(hash(verifier), 'hex').toString('base64url'), code_challenge_method: CodeChallengeMethod.S256,
    }));
  });

  server.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/auth/callback', async (request, reply) => {
    try {
      const { state, code, error } = request.query;
      if (!state || !code || error) throw new Error('Authorization denied');
      const attempt = await database().query(`DELETE FROM bird.oauth_attempts WHERE state_hash = $1 AND binding_hash = $2
        AND expires_at > now() RETURNING verifier, nonce`, [hash(state), hash(cookie(request, 'bird_oauth'))]);
      if (!attempt.rows[0]) throw new Error('Expired authorization');
      const auth = oauthClient();
      const { tokens } = await auth.getToken({ code, codeVerifier: attempt.rows[0].verifier });
      if (!tokens.id_token) throw new Error('Missing Google identity');
      const ticket = await auth.verifyIdToken({ idToken: tokens.id_token, audience: getWebEnv().GOOGLE_CLIENT_ID });
      const identity = ticket.getPayload();
      if (!identity?.sub || !identity.email || !identity.email_verified || (identity as any).nonce !== attempt.rows[0].nonce) throw new Error('Invalid Google identity');
      const user = await database().query(`INSERT INTO bird.users (google_sub, email, name) VALUES ($1, $2, $3)
        ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name RETURNING id, tokens`,
        [identity.sub, identity.email, identity.name || identity.email]);
      const userId = user.rows[0].id;
      const previous = user.rows[0].tokens ? decrypt<Credentials>(user.rows[0].tokens, userId) : {};
      if (!tokens.refresh_token && !previous.refresh_token) throw new Error('Offline access was not granted');
      await saveTokens(userId, tokens);
      await database().query('DELETE FROM bird.sessions WHERE token_hash = $1 OR expires_at < now()', [hash(cookie(request, 'bird_session'))]);
      const token = secret();
      await database().query(`INSERT INTO bird.sessions (token_hash, user_id, csrf_token, expires_at)
        VALUES ($1, $2, $3, now() + interval '7 days')`, [hash(token), userId, secret()]);
      setCookie(reply, 'bird_session', token, 7 * 86400);
      return reply.redirect('/');
    } catch {
      return reply.redirect('/?login=failed');
    }
  });

  server.post('/api/logout', async (request, reply) => {
    await database().query('DELETE FROM bird.sessions WHERE token_hash = $1', [hash(cookie(request, 'bird_session'))]);
    setCookie(reply, 'bird_session', '', 0);
    return { ok: true };
  });
}
