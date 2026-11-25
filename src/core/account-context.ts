import { AsyncLocalStorage } from 'async_hooks';
import { OAuth2Client } from 'google-auth-library';

export interface AccountContext {
  userId: string;
  auth: OAuth2Client;
  settings: Record<string, string | undefined>;
  dryRun: boolean;
  assignmentId?: string;
  runId?: string;
}

// Async context preserves account ownership through existing parser/service calls.
export const accountContext = new AsyncLocalStorage<AccountContext>();
