export class AcquisitionError extends Error {
  readonly retryable: boolean;
  readonly provider?: string;

  constructor(message: string, options: { retryable?: boolean; provider?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider;
  }
}

export class BookNotFoundError extends AcquisitionError {}
export class ProviderUnavailableError extends AcquisitionError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, { retryable: true, provider, cause });
  }
}
export class MirrorUnavailableError extends AcquisitionError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, { retryable: true, provider, cause });
  }
}
export class RateLimitedError extends AcquisitionError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, { retryable: true, provider, cause });
  }
}
export class DownloadFailedError extends AcquisitionError {
  constructor(message: string, retryable = false, provider?: string, cause?: unknown) {
    super(message, { retryable, provider, cause });
  }
}
export class InvalidBookError extends AcquisitionError {}
export class UnsupportedFormatError extends AcquisitionError {}

export function isTransientError(error: unknown): boolean {
  if (error instanceof AcquisitionError) return error.retryable;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed? out|network|ECONNRESET|EAI_AGAIN/i.test(message);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { attempts: number; baseDelayMs?: number; shouldRetry?: (error: unknown) => boolean }
): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  const baseDelayMs = options.baseDelayMs ?? 300;
  const shouldRetry = options.shouldRetry ?? isTransientError;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !shouldRetry(error)) throw error;
      const jitter = Math.floor(Math.random() * baseDelayMs);
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, baseDelayMs * 2 ** attempt + jitter)));
    }
  }
  throw lastError;
}
