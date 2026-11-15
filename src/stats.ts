// Reads the daily aggregates for one scope. Shared by /api/stats and the MCP tools.
import type { App, Level, Row } from "./contract";
import { publicCensus } from "./expanded";
import { missingMigrations } from "./migrations";

export type StatsScope = { from: string; to: string; app: App | "all"; level: Level };

export async function readStats(db: D1Database, range: StatsScope) {
  const rows = await db
    .prepare(
      `SELECT day,app,level,event,bucket,count FROM daily_counts
      WHERE day>=? AND day<=? AND day>=date('now','-89 days') AND level=? AND (?='all' OR app=?)
      ORDER BY day,app,event,bucket`,
    )
    .bind(range.from, range.to, range.level, range.app, range.app)
    .all<Row>();
  // SELECT * follows the schema: without migration 0005 the activity columns are
  // simply absent, and publicCensus also drops them for snapshots that never sent them.
  const snapshots =
    range.level === "optional"
      ? await db
          .prepare(
            `SELECT * FROM daily_census WHERE day>=? AND day<=? AND day>=date('now','-89 days') AND (?='all' OR app=?) ORDER BY day DESC LIMIT 90`,
          )
          .bind(range.from, range.to, range.app, range.app)
          .all<Record<string, unknown>>()
      : { results: [] };
  // Optional schema: reported, never blocking (src/migrations.ts).
  const pendingMigrations =
    range.level === "optional" ? await missingMigrations(db, "census_activity") : [];
  return {
    range,
    rows: rows.results,
    census: snapshots.results.map(publicCensus),
    ...(pendingMigrations.length ? { pendingMigrations } : {}),
    receivedAt: new Date().toISOString(),
  };
}
