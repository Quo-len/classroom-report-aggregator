export function apiError(error: unknown): string {
  // Google client errors can include request headers containing bearer credentials.
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? `Google API status ${status}` : 'Google API request failed';
}
