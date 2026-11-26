import { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { Telegraf } from 'telegraf';
import { database } from './database.service';
import { hash, secret } from './account.service';
import { audit } from './rbac.service';

export function registerTelegramBinding(server: FastifyInstance) {
  server.post('/api/telegram/connect', { config: { permission: 'settings:write' } }, async (request, reply) => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
      return reply.code(400).send({ error: 'Адміністратор ще не налаштував підключення Telegram.' });
    }
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const identity = await bot.telegram.getMe();
    const token = secret();
    await database().query(`INSERT INTO bird.telegram_bindings (user_id, token_hash, expires_at)
      VALUES ($1, $2, now() + interval '10 minutes') ON CONFLICT (user_id)
      DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at`, [request.accountSession!.user_id, hash(token)]);
    return { url: `https://t.me/${identity.username}?start=${token}` };
  });

  server.post<{ Body: { message?: { text?: string; chat?: { id: number; type: string } } } }>('/internal/telegram', async (request, reply) => {
    const actual = Buffer.from(String(request.headers['x-telegram-bot-api-secret-token'] || ''));
    const expected = Buffer.from(process.env.TELEGRAM_WEBHOOK_SECRET || '');
    if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(401).send({ error: 'Unauthorized' });
    const message = request.body?.message;
    const token = message?.text?.match(/^\/start(?:@\w+)? ([\w-]{43})$/)?.[1];
    if (!token || message?.chat?.type !== 'private') return { ok: true };
    const result = await database().query(`UPDATE bird.telegram_bindings SET chat_id = $2, token_hash = NULL, expires_at = NULL
      WHERE token_hash = $1 AND expires_at > now() RETURNING user_id`, [hash(token), String(message.chat.id)]);
    if (result.rows[0]) {
      const userId = result.rows[0].user_id;
      await database().query(`UPDATE bird.settings SET value = jsonb_set(value, '{HEAD_OF_DEPT_CHAT_ID}', to_jsonb($2::text)), updated_at = now() WHERE user_id = $1`, [userId, String(message.chat.id)]);
      await audit(userId, userId, 'telegram.connected');
    }
    return { ok: true };
  });
}
