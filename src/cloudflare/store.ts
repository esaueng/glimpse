import {
  DAY,
  emptyData,
  isoDay,
  RETENTION_SOURCE,
  type App,
  type Charge,
  type CloudflareData,
  type Coverage,
  type Resource,
  type ResourceKind,
  type Subscription,
  type Usage,
} from "./model";
import type { MonitorEnv } from "./env";
export const configured = (env: MonitorEnv) =>
  env.CF_MONITOR_ENABLED === "true" &&
  /^[a-f0-9]{32}$/.test(env.CF_ACCOUNT_ID ?? "") &&
  !!env.CF_API_TOKEN;
export async function state<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db
    .prepare("SELECT value FROM cf_state WHERE key=?")
    .bind(key)
    .first<{ value: string }>();
  return row ? JSON.parse(row.value) : null;
}
export async function setState(db: D1Database, key: string, value: unknown) {
  await db
    .prepare(
      "INSERT INTO cf_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .bind(key, JSON.stringify(value))
    .run();
}
export async function coverage(
  db: D1Database,
  source: string,
  status: Coverage["status"],
  message: string,
  now: string,
) {
  await db
    .prepare(
      `INSERT INTO cf_coverage(source,status,message,checked_at,last_success) VALUES(?,?,?,?,?)
    ON CONFLICT(source) DO UPDATE SET status=excluded.status,message=excluded.message,checked_at=excluded.checked_at,
    last_success=COALESCE(excluded.last_success,cf_coverage.last_success)`,
    )
    .bind(source, status, message, now, status === "ok" ? now : null)
    .run();
}
export async function saveInventory(
  db: D1Database,
  kind: ResourceKind,
  resources: Resource[],
  now: string,
) {
  const statements = [
    db.prepare("UPDATE cf_resources SET active=0 WHERE kind=?").bind(kind),
  ];
  for (const r of resources)
    statements.push(
      db
        .prepare(
          `INSERT INTO cf_resources(id,native_id,name,kind,app,active,seen_at) VALUES(?,?,?,?,?,1,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=1,seen_at=excluded.seen_at,
    app=CASE WHEN cf_resources.manual=1 THEN cf_resources.app ELSE excluded.app END`,
        )
        .bind(r.id, r.nativeId, r.name, r.kind, r.app, now),
    );
  await db.batch(statements);
}
export async function saveUsage(
  db: D1Database,
  rows: Usage[],
  day: string,
  metrics: string[],
) {
  if (rows.length > 2500)
    throw new Error("Analytics dataset exceeds storage batch limit");
  await db.batch([
    ...[...new Set(rows.map((r) => r.resource))].map((id) => {
      const separator = id.indexOf(":"),
        nativeId = id.slice(separator + 1);
      return db
        .prepare(
          "INSERT INTO cf_resources(id,native_id,name,kind,app,active,seen_at) VALUES(?,?,?,?,'unassigned',0,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          id,
          nativeId,
          nativeId === "@account" ? "Account-level / unattributed" : nativeId,
          id.slice(0, separator),
          new Date().toISOString(),
        );
    }),
    db
      .prepare(
        `DELETE FROM cf_usage WHERE day=? AND metric IN (${metrics.map(() => "?").join(",")})`,
      )
      .bind(day, ...metrics),
    ...rows.map((u) =>
      db
        .prepare(
          "INSERT INTO cf_usage(day,resource,metric,value,unit,aggregation) VALUES(?,?,?,?,?,?)",
        )
        .bind(u.day, u.resource, u.metric, u.value, u.unit, u.aggregation),
    ),
  ]);
}
export async function saveCharges(
  db: D1Database,
  rows: Charge[],
  periods: { start: string; end: string }[],
) {
  if (rows.length > 2500)
    throw new Error("Billing dataset exceeds storage batch limit");
  // A completed response replaces its periods, including removed/corrected rows.
  await db.batch([
    ...periods.map((p) =>
      db.prepare("DELETE FROM cf_charges WHERE period_start=?").bind(p.start),
    ),
    ...rows.map((c) =>
      db
        .prepare(
          `INSERT INTO cf_charges(id,subscription,period_start,period_end,start,end,family,description,unit,quantity,cost,currency)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET period_end=excluded.period_end,quantity=excluded.quantity,cost=excluded.cost`,
        )
        .bind(
          c.id,
          c.subscription,
          c.periodStart,
          c.periodEnd,
          c.start,
          c.end,
          c.family,
          c.description,
          c.unit,
          c.quantity,
          c.cost,
          c.currency,
        ),
    ),
  ]);
}
export async function saveSubscriptions(db: D1Database, rows: Subscription[]) {
  await db.batch([
    db.prepare("DELETE FROM cf_subscriptions"),
    ...rows.map((s) =>
      db
        .prepare("INSERT INTO cf_subscriptions VALUES(?,?,?,?,?,?)")
        .bind(s.id, s.name, s.amount, s.currency, s.frequency, s.renews),
    ),
  ]);
}
const COVERAGE_SQL =
  "SELECT source,status,message,checked_at AS checkedAt,last_success AS lastSuccess FROM cf_coverage";
// Most-recent-first row budget for usage and charges. Older whole days beyond it are omitted
// (and reported in coverage) instead of failing the whole monitor response.
export const ROW_LIMIT = 100000;
async function boundedFrom(
  db: D1Database,
  sql: string,
  since: string,
  limit: number,
): Promise<{ from: string; truncated: boolean }> {
  const days = await db
    .prepare(sql)
    .bind(since)
    .all<{ day: string; n: number }>();
  let total = 0,
    from: string | null = null;
  for (const { day, n } of days.results) {
    total += n;
    if (total > limit)
      return {
        // If even the latest day exceeds the budget, return none of those rows.
        from: from ?? isoDay(new Date(Date.parse(day) + DAY)),
        truncated: true,
      };
    from = day;
  }
  return { from: since, truncated: false };
}
export type ReadOptions = {
  // First UTC day of usage and charges to return; defaults to the 400-day retention window.
  since?: string;
  now?: Date;
  // Row budget per table for usage and charges.
  limit?: number;
};
export async function readData(
  env: MonitorEnv,
  options: ReadOptions = {},
): Promise<CloudflareData> {
  const now = options.now ?? new Date();
  if (!configured(env)) {
    // Retention runs whether or not the monitor is configured; expose only its heartbeat.
    const data = emptyData(false, now);
    try {
      const heartbeat = await env.DB.prepare(`${COVERAGE_SQL} WHERE source=?`)
        .bind(RETENTION_SOURCE)
        .first<Coverage>();
      if (heartbeat) data.coverage.push(heartbeat);
    } catch {
      // Monitor tables are optional when the monitor is disabled.
    }
    return data;
  }
  const oldest = isoDay(new Date(now.getTime() - 399 * DAY));
  const since =
    options.since && options.since > oldest ? options.since : oldest;
  const limit = options.limit ?? ROW_LIMIT;
  const [usageFrom, chargesFrom] = await Promise.all([
    boundedFrom(
      env.DB,
      "SELECT day,COUNT(*) AS n FROM cf_usage WHERE day>=? GROUP BY day ORDER BY day DESC",
      since,
      limit,
    ),
    boundedFrom(
      env.DB,
      "SELECT substr(start,1,10) AS day,COUNT(*) AS n FROM cf_charges WHERE start>=? GROUP BY day ORDER BY day DESC",
      since,
      limit,
    ),
  ]);
  const results = await env.DB.batch([
    env.DB.prepare(
      "SELECT id,name,visibility,budget FROM cf_apps ORDER BY name",
    ),
    env.DB.prepare(
      "SELECT id,native_id AS nativeId,name,kind,app,active FROM cf_resources ORDER BY kind,name",
    ),
    env.DB.prepare(
      "SELECT day,resource,metric,value,unit,aggregation FROM cf_usage WHERE day>=? ORDER BY day",
    ).bind(usageFrom.from),
    env.DB.prepare(
      "SELECT id,subscription,period_start AS periodStart,period_end AS periodEnd,start,end,family,description,unit,quantity,cost,currency FROM cf_charges WHERE start>=? ORDER BY start",
    ).bind(chargesFrom.from),
    env.DB.prepare("SELECT * FROM cf_subscriptions ORDER BY name"),
    env.DB.prepare(`${COVERAGE_SQL} ORDER BY source`),
    // Billing periods come from all observed charges, independent of the requested range.
    env.DB.prepare(
      "SELECT DISTINCT period_start AS start,period_end AS end FROM cf_charges WHERE period_end<>''",
    ),
  ]);
  const [apps, resources, usage, charges, subscriptions, sources, observed] =
    results.map((r) => r.results);
  if ([apps, resources, subscriptions].some((r) => r!.length > ROW_LIMIT))
    throw new Error("Monitor response exceeds limit");
  const coverageRows = sources as Coverage[];
  for (const [label, bound] of [
    ["Usage history", usageFrom],
    ["Billing history", chargesFrom],
  ] as const)
    if (bound.truncated)
      coverageRows.push({
        source: label,
        status: "unavailable",
        message: `Rows before ${bound.from} omitted; response limit reached.`,
        checkedAt: now.toISOString(),
        lastSuccess: null,
      });
  const periods =
    (await state<CloudflareData["periods"]>(env.DB, "periods")) ?? [];
  // Historic periods come from observed billing rows; no pre-install history is invented.
  for (const p of observed as { start: string; end: string }[])
    if (!periods.some((known) => known.start === p.start)) periods.push(p);
  const paths: Record<ResourceKind, string> = {
    Workers: "workers/services/view/",
    Pages: "pages/view/",
    D1: "workers/d1/databases/",
    R2: "r2/default/buckets/",
    KV: "workers/kv/namespaces/",
    "Durable Objects": "workers/durable-objects/",
    Containers: "containers/applications/",
    Queues: "queues/",
    Zones: "",
  };
  return {
    ...emptyData(true, now),
    apps: apps as App[],
    resources: (resources as unknown as Resource[]).map((r) => ({
      ...r,
      active: !!r.active,
      ...(r.nativeId === "@account"
        ? {}
        : {
            dashboardUrl: `https://dash.cloudflare.com/${env.CF_ACCOUNT_ID}/${paths[r.kind]}${encodeURIComponent(r.nativeId)}${r.kind === "Workers" ? "/production" : ""}`,
          }),
    })),
    usage: usage as Usage[],
    charges: charges as Charge[],
    subscriptions: subscriptions as Subscription[],
    coverage: coverageRows,
    periods: periods.sort((a, b) => b.start.localeCompare(a.start)),
    budget: await state<number>(env.DB, "budget"),
  };
}
