export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

export function fileNotFoundError(key: string): Error {
  return new Error(`File not found: ${key}`);
}

export function downloadLimitExceededError(key: string): Error {
  return new Error(`Object exceeds the ${MAX_DOWNLOAD_BYTES / (1024 * 1024)}MB download limit: ${key}`);
}
