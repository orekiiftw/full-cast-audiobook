import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import config from "../drizzle.config";

const MIGRATION_LOCK_KEY = 7_412_093_355;

const client = new Client({ connectionString: databaseUrl() });
await client.connect();
try {
  await acquireMigrationLock();
  await migrate(drizzle(client), {
    migrationsFolder: config.out ?? "drizzle",
    migrationsTable: config.migrations?.table,
    migrationsSchema: config.migrations?.schema,
  });
  console.log("✅ Database migrations are up to date.");
} finally {
  await client.end();
}

function databaseUrl(): string {
  if ("dbCredentials" in config && config.dbCredentials && "url" in config.dbCredentials) return config.dbCredentials.url;
  throw new Error("drizzle.config.ts must define dbCredentials.url");
}

async function acquireMigrationLock(): Promise<void> {
  const { rows } = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [MIGRATION_LOCK_KEY]);
  if (rows[0]?.acquired) return;
  console.log("⏳ Another instance is applying migrations; waiting for it to finish...");
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
}
