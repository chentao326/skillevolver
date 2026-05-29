export function isRetryableError(error: unknown): boolean {
  const err = error as Error & { status?: number; code?: string };
  if (err.status && [429, 500, 502, 503, 504].includes(err.status)) return true;
  if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(err.code)) return true;
  const msg = err.message?.toLowerCase() ?? '';
  return msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('overloaded');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); } catch (error) {
      if (attempt === maxRetries) throw error;
      if (isRetryableError(error)) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
      } else { throw error; }
    }
  }
  throw new Error('unreachable');
}
