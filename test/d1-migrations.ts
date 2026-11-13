import { readdirSync, readFileSync } from "node:fs";
import { MIGRATIONS_TABLE } from "../src/migrations";

// Applies migrations to a Miniflare D1 database the way `wrangler d1 migrations apply`
// does: the migration SQL, then a row in Wrangler's ledger table, which the Worker's
// pending-migration guard reads.
type Exec = { exec(sql: string): Promise<unknown> };

export const MIGRATION_FILES = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();

// Miniflare's exec runs one statement per line: drop comments and join lines.
export const migrationSql = (name: string) =>
  readFileSync(`migrations/${name}`, "utf8")
    .replace(/--[^\n]*/g, "")
    .replace(/\n/g, " ");

export async function recordMigration(db: Exec, name: string) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE}(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);`,
  );
  await db.exec(
    `INSERT INTO ${MIGRATIONS_TABLE}(name) VALUES('${name.replace(/'/g, "''")}');`,
  );
}

export async function applyMigration(db: Exec, name: string) {
  await db.exec(migrationSql(name));
  await recordMigration(db, name);
}

export async function applyMigrations(db: Exec, names = MIGRATION_FILES) {
  for (const name of names) await applyMigration(db, name);
}
