import { Database } from "bun:sqlite";
import { getTableConfig, type ForeignKey, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { drizzle, type PgRemoteDatabase } from "drizzle-orm/pg-proxy";

type QueryHook = (query: string) => void | Promise<void>;

export interface PipelineDatabase {
  sqlite: Database;
  db: PgRemoteDatabase;
  hooks: { beforeQuery: QueryHook };
}

// Postgres stand-in for harnesses that replace ../db: drizzle's pg-proxy driver renders the real queries and an
// in-memory SQLite database runs them. A beforeQuery hook can observe, fail, or hold any statement.
export function createPipelineDatabase(tables: PgTable[], { foreignKeys = false } = {}): PipelineDatabase {
  const sqlite = new Database(":memory:");
  if (foreignKeys) sqlite.exec("PRAGMA foreign_keys = ON");
  const tableNames = new Set(tables.map((table) => getTableConfig(table).name));
  for (const table of tables) {
    const { name, columns, uniqueConstraints, foreignKeys: references } = getTableConfig(table);
    const uniques = uniqueConstraints.map((unique) => `UNIQUE (${columnList(unique.columns)})`);
    const constraints = foreignKeys ? references.flatMap((reference) => foreignKeyClause(reference, tableNames)) : [];
    sqlite.exec(`CREATE TABLE "${name}" (${[...columns.map(sqliteColumn), ...uniques, ...constraints].join(", ")})`);
  }

  const hooks: PipelineDatabase["hooks"] = { beforeQuery: () => {} };
  const db = drizzle(async (query, params) => {
    const held = hooks.beforeQuery(query);
    if (held) await held;
    return { rows: sqlite.query(toSqliteDialect(query)).values(...params) };
  });
  // pg-proxy has no transactions. Every statement shares the one SQLite connection, so BEGIN/COMMIT around the
  // callback makes its statements atomic, and the callback's tx is the database itself.
  Object.assign(db, {
    transaction: async <T>(run: (tx: PgRemoteDatabase) => Promise<T>): Promise<T> => {
      sqlite.exec("BEGIN");
      try {
        const result = await run(db);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  });
  return { sqlite, db, hooks };
}

function sqliteColumn(column: PgColumn): string {
  if (column.primary) return `"${column.name}" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))`;
  const type = column.getSQLType() === "integer" ? "INTEGER" : "TEXT";
  if (!column.notNull || (typeof column.default !== "number" && typeof column.default !== "string")) return `"${column.name}" ${type}`;
  // Postgres's DEFAULT keyword reaches SQLite as NULL; REPLACE turns that NULL back into the column default.
  const fallback = typeof column.default === "string" ? `'${column.default}'` : column.default;
  return `"${column.name}" ${type} NOT NULL ON CONFLICT REPLACE DEFAULT ${fallback}`;
}

function foreignKeyClause(reference: ForeignKey, tableNames: Set<string>): string[] {
  const { columns, foreignColumns, foreignTable } = reference.reference();
  const target = getTableConfig(foreignTable).name;
  if (!tableNames.has(target)) return [];
  const onDelete = (reference.onDelete ?? "no action").toUpperCase();
  return [`FOREIGN KEY (${columnList(columns)}) REFERENCES "${target}" (${columnList(foreignColumns)}) ON DELETE ${onDelete}`];
}

function columnList(columns: PgColumn[]): string {
  return columns.map((column) => `"${column.name}"`).join(", ");
}

function toSqliteDialect(query: string): string {
  return query
    .replace(/\$\d+/g, "?")
    .replace(/::int\b/g, "")
    .replace(/\bUPDATE (\w+) (\w+)\s+SET\b/g, "UPDATE $1 AS $2 SET")
    .replace(/\(default,/g, "(lower(hex(randomblob(16))),")
    .replace(/\bdefault\b/g, "NULL");
}
