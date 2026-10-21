import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DB_PATH, MIGRATIONS_FOLDER } from "./paths.js";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema> & { close: () => void };

/** Opens (and migrates) the database. Pass ":memory:" in tests. */
export function createDb(file: string = DB_PATH): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return Object.assign(db, { close: () => sqlite.close() });
}
