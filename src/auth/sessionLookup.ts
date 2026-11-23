import { and, eq, gt, gte } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../schema";
import { firstRow } from "../lib/query";
import type { AuthUser } from "./sessions";

export async function findUserByTokenHash(tokenHash: string, minCreatedAt: Date): Promise<AuthUser | null> {
  const row = await firstRow(
    db
      .select({ id: users.id, email: users.email })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
          gte(sessions.createdAt, minCreatedAt),
          eq(users.disabled, false),
        ),
      )
      .limit(1),
  );

  return row ?? null;
}
