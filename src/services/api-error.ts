export function apiError(error: unknown): string {
  // Google client errors can include request headers containing bearer credentials.
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? `Google API status ${status}` : 'Google API request failed';
}

/** An error whose message is safe and useful to show to the signed-in user. */
export class UserError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'UserError';
  }
}

export function googleStatus(error: unknown): number | undefined {
  const failure = error as { code?: unknown; response?: { status?: unknown } } | null;
  const status = failure?.response?.status ?? failure?.code;
  return typeof status === 'number' ? status : undefined;
}
