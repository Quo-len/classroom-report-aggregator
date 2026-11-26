import 'dotenv/config';
import { Telegraf } from 'telegraf';

async function main() {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_URL } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !APP_URL) throw new Error('Потрібні TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET та APP_URL');
  const url = new URL('/internal/telegram', APP_URL);
  if (url.protocol !== 'https:') throw new Error('Telegram потребує HTTPS');
  await new Telegraf(TELEGRAM_BOT_TOKEN).telegram.setWebhook(url.href, { secret_token: TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] });
  console.log('Telegram webhook налаштовано. Підключіть чат у налаштуваннях облікового запису.');
}
main().catch(() => { console.error('Не вдалося налаштувати Telegram webhook. Перевірте конфігурацію.'); process.exitCode = 1; });
