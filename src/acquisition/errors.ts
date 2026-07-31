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
