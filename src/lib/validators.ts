const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function requireUuid(value: unknown, field = "id"): string {
  if (!isUuid(value)) {
    throw new ValidationError(`Invalid ${field}: must be a UUID`);
  }
  return value;
}

export function requireString(obj: Record<string, unknown>, key: string): string {
  const value = requireField<unknown>(obj, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Field ${key} must be a non-empty string`);
  }
  return value;
}

export function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = requireField<unknown>(obj, key);
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ValidationError(`Field ${key} must be a number`);
  }
  return value;
}

export function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ValidationError(`Field ${key} must be a string`);
  return value;
}

export function boundedString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ValidationError(`${name} must be a string of ${maxLength} characters or fewer`);
  }
  return value.trim() || undefined;
}

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function requireField<T>(obj: Record<string, unknown>, key: string): T {
  if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
    throw new ValidationError(`Missing required field: ${key}`);
  }
  return obj[key] as T;
}
