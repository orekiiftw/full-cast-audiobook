export function env(name: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
}
