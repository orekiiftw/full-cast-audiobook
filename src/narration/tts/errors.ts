export class TtsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class TtsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsInputError";
  }
}

export class TtsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsConfigError";
  }
}

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

export function isRetryableError(error: unknown): boolean {
  if (error instanceof TtsConfigError || error instanceof TtsInputError) return false;
  if (error instanceof TtsApiError) {
    return RETRYABLE_STATUSES.has(error.status) || error.status >= 500;
  }
  return true;
}
