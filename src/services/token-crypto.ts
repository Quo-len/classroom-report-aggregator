import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getWebEnv } from '../config/web-env';

export function encrypt(value: unknown, owner: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(getWebEnv().TOKEN_ENCRYPTION_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
}

export function decrypt<T>(value: string, owner: string): T {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted token');
  const [iv, tag, data] = parts.map(part => Buffer.from(part, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(getWebEnv().TOKEN_ENCRYPTION_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')) as T;
}
