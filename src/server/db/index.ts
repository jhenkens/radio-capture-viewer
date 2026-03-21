import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import fs from "fs";
import { getConfig } from "../config/index.js";
import * as schema from "./schema.js";

export type DB = ReturnType<typeof createDb>;

function createDb() {
  const config = getConfig();
  const url = config.db.url;

  // Strip the "file:" prefix for better-sqlite3
  const filePath = url.startsWith("file:") ? url.slice(5) : url;

  // Ensure directory exists
  const dir = path.dirname(path.resolve(filePath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  return db;
}

let _db: ReturnType<typeof createDb> | null = null;

export function getDb(): ReturnType<typeof createDb> {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

export async function runMigrations(): Promise<void> {
  const db = getDb();
  const migrationsFolder = path.resolve(__dirname, "migrations");
  if (fs.existsSync(migrationsFolder)) {
    migrate(db, { migrationsFolder });
    console.log("[db] Migrations applied");
  } else {
    console.warn("[db] No migrations folder found, skipping");
  }
}

export { schema };
