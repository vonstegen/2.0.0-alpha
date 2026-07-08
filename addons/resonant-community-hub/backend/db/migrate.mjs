// Ordered migration loader.
//
// Migrations live as `NNNN_name.sql` files in ./migrations and are applied in
// lexical (== numeric) order. Keeping the ordering in one place means the seed
// CLI, the live Neon path, and the offline PGlite tests all apply the exact same
// schema — a new migration (e.g. 0002_moderation.sql) can never be silently
// missed by one path and present in another.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** Absolute paths of every `*.sql` migration, in apply order. */
export async function migrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

/** Concatenate all migrations (in order) into one DDL string. */
export async function readMigrations() {
  const files = await migrationFiles();
  const parts = [];
  for (const file of files) {
    parts.push(`-- ${path.basename(file)}\n${await readFile(file, "utf8")}`);
  }
  return parts.join("\n\n");
}

/**
 * Apply every migration in order against an injected executor exposing either
 * `exec(sql)` (PGlite) or `query(sql)` (Neon Pool / node-postgres).
 * @param {{ exec?: (sql: string) => Promise<any>, query?: (sql: string) => Promise<any> }} db
 */
export async function applyMigrations(db) {
  const run = typeof db.exec === "function" ? (sql) => db.exec(sql) : (sql) => db.query(sql);
  for (const file of await migrationFiles()) {
    await run(await readFile(file, "utf8"));
  }
}
