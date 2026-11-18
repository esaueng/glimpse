// Reads the daily aggregates for one scope. Shared by /api/stats and the MCP tools.
import type { AdoptionRow, App, Level, OpenZCADChannel, Row } from "./contract";
import { publicCensus } from "./expanded";
import { missingMigrations } from "./migrations";

export type StatsScope = {
  from: string;
  to: string;
  app: App | "all";
  level: Level;
  channel?: OpenZCADChannel;
};

export async function readStats(db: D1Database, range: StatsScope) {
  const { from, to, app, level, channel = "beta" } = range;
  const openzcad = app === "all" || app === "openzcad";
  const optional = level === "optional";
  const [channelsPending, activityPending] = await Promise.all([
    openzcad ? missingMigrations(db, "openzcad_channels") : [],
    optional ? missingMigrations(db, "census_activity") : [],
  ]);
  const channelsReady = openzcad && channelsPending.length === 0;
  const stable = channel === "stable";
  const counts = stable
    ? channelsReady
      ? "(SELECT * FROM daily_counts WHERE app<>'openzcad' UNION ALL SELECT * FROM daily_counts_stable)"
      : "(SELECT * FROM daily_counts WHERE app<>'openzcad')"
    : "daily_counts";
  const censusTable = stable ? "daily_census_stable" : "daily_census";
  const dates = "day>=? AND day<=? AND day>=date('now','-89 days')";
  const [rows, snapshots, adoption] = await Promise.all([
    db.prepare(
      `SELECT day,app,level,event,bucket,count FROM ${counts}
      WHERE ${dates} AND level=? AND (?='all' OR app=?)
      ORDER BY day,app,event,bucket`,
    ).bind(from, to, level, app, app).all<Row>(),
    // SELECT * permits older beta snapshots without the optional activity columns.
    optional && (!stable || channelsReady)
      ? db.prepare(
          `SELECT * FROM ${censusTable} WHERE ${dates} AND (?='all' OR app=?) ORDER BY day DESC LIMIT 90`,
        ).bind(from, to, app, app).all<Record<string, unknown>>()
      : { results: [] },
    !optional && channelsReady
      ? db.prepare(
          `SELECT day,accounts,signedInAccounts,signInSessions FROM daily_openzcad_adoption
          WHERE ${dates} AND channel=? ORDER BY day`,
        ).bind(from, to, channel).all<AdoptionRow>()
      : { results: [] },
  ]);
  const pendingMigrations = [...activityPending, ...channelsPending];
  return {
    range,
    rows: rows.results,
    census: snapshots.results.map(publicCensus),
    ...(adoption.results.length ? { adoption: adoption.results } : {}),
    ...(pendingMigrations.length ? { pendingMigrations } : {}),
    receivedAt: new Date().toISOString(),
  };
}
