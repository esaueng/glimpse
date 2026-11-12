// Pending-migration guard. Main deploys automatically while D1 migrations are applied by
// hand, so code can reach an environment before its schema. Authenticated API surfaces
// check Wrangler's migration ledger and fail with a clear 503 instead of a vague error.
// Ingestion RPC is deliberately not guarded: its behaviour is unchanged.

export type Surface = "stats" | "cloudflare";

// Every file in migrations/ must be listed here, mapped to the API surfaces whose schema
// depends on it; test/migrations.test.ts fails when a migration is added without this.
export const REQUIRED_MIGRATIONS = {
  "0001_aggregates.sql": ["stats"],
  "0002_openlattice3d.sql": ["stats"],
  "0003_census.sql": ["stats"],
  "0004_cloudflare.sql": ["cloudflare"],
} as const satisfies Record<string, readonly Surface[]>;

// Wrangler's default ledger table (wrangler.jsonc sets no `migrations_table`).
export const MIGRATIONS_TABLE = "d1_migrations";

export function requiredFor(surface: Surface): string[] {
  return Object.entries(REQUIRED_MIGRATIONS)
    .filter(([, surfaces]) => (surfaces as readonly Surface[]).includes(surface))
    .map(([name]) => name);
}

// Positive results only, per isolate: once a surface's schema is present it stays present,
// while a missing migration is re-checked on every request until it is applied.
const satisfied = new Set<Surface>();

/** Returns the required migrations not yet recorded in the ledger (empty when ready). */
export async function missingMigrations(
  db: D1Database,
  surface: Surface,
): Promise<string[]> {
  if (satisfied.has(surface)) return [];
  const required = requiredFor(surface);
  let applied: Set<string>;
  try {
    const { results } = await db
      .prepare(
        `SELECT name FROM ${MIGRATIONS_TABLE} WHERE name IN (${required.map(() => "?").join(",")})`,
      )
      .bind(...required)
      .all<{ name: string }>();
    applied = new Set(results.map((row) => row.name));
  } catch (error) {
    // No ledger at all means no migration was ever applied with Wrangler. Any other
    // failure (for example D1 unavailable) is left to the caller's error handling.
    if (!/no such table/i.test(error instanceof Error ? error.message : ""))
      throw error;
    applied = new Set();
  }
  const missing = required.filter((name) => !applied.has(name));
  if (missing.length === 0) satisfied.add(surface);
  return missing;
}

/** A data-free 503 naming the missing migrations (public file names only). */
export function migrationPending(missing: string[]): Response {
  console.error(`Required D1 migrations missing: ${missing.join(", ")}`);
  return Response.json(
    {
      error: `Database migration pending: ${missing.join(", ")}. Apply it with \`wrangler d1 migrations apply\` before using this page.`,
      missingMigrations: missing,
    },
    { status: 503, headers: { "Retry-After": "300" } },
  );
}
