export function env(name: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
}

export function positiveEnvInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
