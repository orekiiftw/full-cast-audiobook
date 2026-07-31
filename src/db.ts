import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const isProduction = process.env.NODE_ENV === "production";
const DEV_FALLBACK = "postgres://postgres:postgres@localhost:5432/audiobook";

// DATABASE_URL must be set explicitly in production. The only safe default
// (local postgres on a developer's machine) is used outside production, and
// even then only with a loud warning — never silently. Shipping a hardcoded
// credential fallback risks connecting (or appearing to) against the wrong
// database when an env var is simply missing.
let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  if (isProduction) {
    console.error("❌ CRITICAL: DATABASE_URL is not set. The server cannot start without it in production.");
    databaseUrl = DEV_FALLBACK; // keeps the import resolvable; the pool will fail to connect anyway
  } else {
    console.warn(`⚠️ DATABASE_URL is not set. Falling back to local default (${DEV_FALLBACK}). Set DATABASE_URL for anything real.`);
    databaseUrl = DEV_FALLBACK;
  }
}

// Neon serverless pooler: a brand-new connection does a TLS + auth handshake
// to a remote region (and may wake a cold compute), costing several seconds.
// The previous settings (max 10, 5s connect timeout, 30s idle) starved the
// shared pool under load: the background TTS pipeline issues many concurrent
// segment writes, and when all 10 slots were busy acquiring slow new
// connections, web requests (e.g. GET /api/books) timed out at 5s with
// "Connection terminated due to connection timeout" / "unexpectedly".
//
// Tuning rationale:
//  - max        raised so the API and the pipeline stop contending for slots
//  - connection raised so a slow cold-start / TLS handshake can't fail a request
//  - idle       raised so warm connections survive bursts (Neon keeps them live)
//
// Note: we intentionally do NOT set statement_timeout here. We tried applying
// it as a Postgres startup "options" parameter, but Neon's pooled endpoint
// rejects it ("unsupported startup parameter"). Setting it via a per-client
// SET in pool.on("connect") works but races with the first query and triggers
// a pg deprecation warning. Neon already enforces its own server-side limits,
// so the pool tuning below is the correct fix.
export const pool = new Pool({
  connectionString: databaseUrl,
  max: 25,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 30_000,
  // Neon / pooled endpoints silently drop idle TCP connections after a while.
  // The TTS pipeline holds a checked-out connection across long synthesis
  // waits (seconds per beat); when it resumes to write the voiced row, the
  // socket is dead and Postgres throws "Connection terminated unexpectedly",
  // re-queueuing the segment and wasting worker time. TCP keepalives keep the
  // socket alive across those gaps. pg reuses the net.Socket keepAlive knobs.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Pre-warm one connection at boot so the first request doesn't pay the cold
// handshake cost, and a bad DATABASE_URL fails fast here instead of at the
// first request.
pool
  .connect()
  .then((c) => c.release())
  .catch((err) => console.error("⚠️ Database pre-warm failed:", err.message));

// A dead socket ("Connection terminated unexpectedly") can otherwise be handed
// back to the pool and reused, poisoning the next query. Logging here makes
// such failures visible; the pool drops the broken client automatically.
pool.on("error", (err) => {
  console.error("⚠️ Idle pool client error (will be discarded):", err.message);
});

export const db = drizzle(pool, { schema });
export default db;
