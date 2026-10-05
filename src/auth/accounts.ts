import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../schema";
import { firstRow } from "../lib/query";

let dummyHashPromise: Promise<string> | null = null;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 128;
}

export async function insertUser(email: string, password: string) {
  try {
    return await firstRow(
      db
        .insert(users)
        .values({ email, passwordHash: await Bun.password.hash(password, { algorithm: "argon2id" }) })
        .returning({ id: users.id, email: users.email }),
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
}

export async function authenticateAccount(email: string, password: string) {
  const account = isValidEmail(email) ? await accountByEmail(email) : null;
  if (!account || account.disabled) {
    await verifyAgainstDummy(password);
    return null;
  }
  if (!(await Bun.password.verify(password, account.passwordHash, "argon2id"))) return null;
  return { id: account.id, email: account.email };
}

function accountByEmail(email: string) {
  return firstRow(db.select().from(users).where(eq(users.email, email)).limit(1));
}

function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHashPromise ??= Bun.password.hash("timing-equalization-dummy", { algorithm: "argon2id" });
  return dummyHashPromise.then((hash) => Bun.password.verify(password, hash, "argon2id")).catch(() => false);
}
