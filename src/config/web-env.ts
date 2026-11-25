import './env';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_CA: z.string().optional(),
  APP_URL: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  }, 'Use HTTPS except on localhost'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Use a random 32-byte hex key'),
  CRON_SECRET: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Comma-separated Google emails that always receive the admin role. When empty, the first account becomes admin.
  ADMIN_EMAILS: z.string().optional().transform(value =>
    (value || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)),
  // Role for newly registered accounts; use "viewer" to require admin approval before users can change anything.
  DEFAULT_ROLE: z.enum(['editor', 'viewer']).default('editor'),
});

export function getWebEnv() {
  return schema.parse(process.env);
}
