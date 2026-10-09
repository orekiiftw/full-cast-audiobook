import { drizzle } from "drizzle-orm/node-postgres";
import { lt } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";
import { sessions } from "./schema";

const isProduction = process.env.NODE_ENV === "production";
const DEV_FALLBACK = "postgres://postgres:postgres@localhost:5432/audiobook";

let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  if (isProduction) {
    throw new Error("CRITICAL: DATABASE_URL is not set. The server cannot start without it in production.");
  }
  console.warn(`⚠️ DATABASE_URL is not set. Falling back to local default (${DEV_FALLBACK}). Set DATABASE_URL for anything real.`);
  databaseUrl = DEV_FALLBACK;
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 25,
  idleTimeoutMillis: 10 * 60_000,
  connectionTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool
  .connect()
  .then((client) => client.release())
  .catch((err) => console.error("⚠️ Database pre-warm failed:", err.message));

pool.on("error", (err) => {
  console.error("⚠️ Idle pool client error (will be discarded):", err.message);
});

export const db = drizzle(pool, { schema });

setInterval(
  () => {
    db.delete(sessions)
      .where(lt(sessions.expiresAt, new Date()))
      .catch((err) => console.warn("Periodic session sweep failed:", err));
  },
  60 * 60 * 1000,
).unref?.();
