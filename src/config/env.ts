import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { accountContext } from '../core/account-context';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  GOOGLE_CREDENTIALS_FILE: z.string().min(1, 'GOOGLE_CREDENTIALS_FILE is required').default('credentials.json'),
  GOOGLE_TOKEN_FILE: z.string().min(1, 'GOOGLE_TOKEN_FILE is required').default('token.json'),
  // Course is picked by name among active courses you teach; leave empty if you teach exactly one.
  CLASSROOM_COURSE_NAME: z.string().default(''),
  ASSIGNMENT_NAME: z.string().min(1, 'ASSIGNMENT_NAME is required').default('Інформація про науково-дослідну роботу'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  HEAD_OF_DEPT_CHAT_ID: z.string().min(1, 'HEAD_OF_DEPT_CHAT_ID is required'),
  HEAD_OF_DEPT_EMAIL: z.string().email('HEAD_OF_DEPT_EMAIL must be a valid email address'),
  SCI_DEPT_EMAIL: z.string().email('SCI_DEPT_EMAIL must be a valid email address'),
  // Root Drive folder holding the report subfolder and both plan sheets; created automatically when missing.
  WORKSPACE_FOLDER_NAME: z.string().default('Секретар кафедри'),
  GROQ_API_KEY: z.string().optional(),
});

/** Resolved at runtime by WorkspaceService (CLI) or from the account's workspace (hosted); never configured by hand. */
export interface ResolvedResources {
  CLASSROOM_COURSE_ID: string;
  STATIC_PLAN_SHEET_ID: string;
  STATIC_SCI_PLAN_SHEET_ID: string;
  MASTER_OUTPUT_FOLDER_ID: string;
}
const RESOURCE_KEYS = new Set<string>(['CLASSROOM_COURSE_ID', 'STATIC_PLAN_SHEET_ID', 'STATIC_SCI_PLAN_SHEET_ID', 'MASTER_OUTPUT_FOLDER_ID']);
let localResources: Partial<ResolvedResources> = {};

export function setLocalResources(resources: ResolvedResources): void {
  localResources = resources;
}

type Config = z.infer<typeof envSchema> & { credentialsPath: string; tokenPath: string };
let cachedConfig: Config | null = null;

export function getEnv(): Config {
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
    throw new Error('Environment configuration validation failed: ' + errorDetails);
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
export const env = new Proxy({} as Config & ResolvedResources, {
  get(_target, prop: string) {
    const account = accountContext.getStore();
    if (account) {
      if (prop === 'TELEGRAM_BOT_TOKEN' || prop === 'GROQ_API_KEY') return process.env[prop];
      return account.settings[prop];
    }
    if (RESOURCE_KEYS.has(prop)) return localResources[prop as keyof ResolvedResources];
    const config = getEnv();
    return (config as any)[prop];
  },
});
