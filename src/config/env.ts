import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { accountContext } from '../core/account-context';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  GOOGLE_CREDENTIALS_FILE: z.string().min(1, 'GOOGLE_CREDENTIALS_FILE is required').default('credentials.json'),
  GOOGLE_TOKEN_FILE: z.string().min(1, 'GOOGLE_TOKEN_FILE is required').default('token.json'),
  CLASSROOM_COURSE_ID: z.string().min(1, 'CLASSROOM_COURSE_ID is required'),
  ASSIGNMENT_NAME: z.string().min(1, 'ASSIGNMENT_NAME is required').default('Інформація про науково-дослідну роботу'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  HEAD_OF_DEPT_CHAT_ID: z.string().min(1, 'HEAD_OF_DEPT_CHAT_ID is required'),
  HEAD_OF_DEPT_EMAIL: z.string().email('HEAD_OF_DEPT_EMAIL must be a valid email address'),
  SCI_DEPT_EMAIL: z.string().email('SCI_DEPT_EMAIL must be a valid email address'),
  STATIC_PLAN_SHEET_ID: z.string().min(1, 'STATIC_PLAN_SHEET_ID is required'),
  STATIC_SCI_PLAN_SHEET_ID: z.string().min(1, 'STATIC_SCI_PLAN_SHEET_ID is required'),
  MASTER_OUTPUT_FOLDER_ID: z.string().min(1, 'MASTER_OUTPUT_FOLDER_ID is required'),
  GROQ_API_KEY: z.string().optional(),
});

let cachedConfig: (z.infer<typeof envSchema> & { credentialsPath: string; tokenPath: string }) | null = null;

export function getEnv(): z.infer<typeof envSchema> & { credentialsPath: string; tokenPath: string } {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - [${err.path.join('.')}] ${err.message}`)
      .join('\n');
    
    console.error('❌ Environment configuration validation failed:\n' + errorDetails);
    console.error('\nPlease check your .env file or copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  cachedConfig = {
    ...result.data,
    credentialsPath: path.isAbsolute(result.data.GOOGLE_CREDENTIALS_FILE)
      ? result.data.GOOGLE_CREDENTIALS_FILE
      : path.resolve(process.cwd(), result.data.GOOGLE_CREDENTIALS_FILE),
    tokenPath: path.isAbsolute(result.data.GOOGLE_TOKEN_FILE)
      ? result.data.GOOGLE_TOKEN_FILE
      : path.resolve(process.cwd(), result.data.GOOGLE_TOKEN_FILE),
  };

  return cachedConfig;
}

// Proxy export for transparent usage: env.VARIABLE_NAME
export const env = new Proxy({} as ReturnType<typeof getEnv>, {
  get(_target, prop: string) {
    const account = accountContext.getStore();
    if (account) {
      if (prop === 'TELEGRAM_BOT_TOKEN' || prop === 'GROQ_API_KEY') return process.env[prop];
      return account.settings[prop];
    }
    const config = getEnv();
    return (config as any)[prop];
  },
});
