import {
  emptyData,
  isoDay,
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
export async function readData(env: MonitorEnv): Promise<CloudflareData> {
  if (!configured(env)) return emptyData();
  const since = isoDay(new Date(Date.now() - 399 * 86400000));
  const results = await env.DB.batch([
    env.DB.prepare(
      "SELECT id,name,visibility,budget FROM cf_apps ORDER BY name",
    ),
    env.DB.prepare(
      "SELECT id,native_id AS nativeId,name,kind,app,active FROM cf_resources ORDER BY kind,name",
    ),
    env.DB.prepare(
      "SELECT * FROM cf_usage WHERE day>=? ORDER BY day LIMIT 100001",
    ).bind(since),
    env.DB.prepare(
      "SELECT id,subscription,period_start AS periodStart,period_end AS periodEnd,start,end,family,description,unit,quantity,cost,currency FROM cf_charges WHERE start>=? ORDER BY start LIMIT 100001",
    ).bind(since),
    env.DB.prepare("SELECT * FROM cf_subscriptions ORDER BY name"),
    env.DB.prepare(
      "SELECT source,status,message,checked_at AS checkedAt,last_success AS lastSuccess FROM cf_coverage ORDER BY source",
    ),
  ]);
  if (results.some((r) => r.results.length > 100000))
    throw new Error("Monitor response exceeds limit");
  const [apps, resources, usage, charges, subscriptions, sources] = results.map(
    (r) => r.results,
  );
  const periods =
    (await state<CloudflareData["periods"]>(env.DB, "periods")) ?? [];
  // Historic periods come from observed billing rows; no pre-install history is invented.
  for (const c of charges as Charge[])
    if (c.periodEnd && !periods.some((p) => p.start === c.periodStart))
      periods.push({ start: c.periodStart, end: c.periodEnd });
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
    ...emptyData(true),
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
    coverage: sources as Coverage[],
    periods: periods.sort((a, b) => b.start.localeCompare(a.start)),
    budget: await state<number>(env.DB, "budget"),
  };
}
