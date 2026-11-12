import { APP_NAMES, type App } from "../contract";
import { logFailure } from "../errors";
import {
  ApiError,
  CloudflareClient,
  analyticsSelection,
  datasets,
  inventories,
  isRecord,
  usageRows,
  type Row,
} from "./client";
import {
  ACCOUNT_NAME,
  billingPeriods,
  CONNECTION_SOURCE,
  DAY,
  isoDay,
  micros,
  normalizeCharges,
  resourceKey,
  text,
  type Coverage,
  type Resource,
  type Subscription,
} from "./model";
import {
  configured,
  coverage,
  readData,
  saveCharges,
  saveInventory,
  saveSubscriptions,
  saveUsage,
  setState,
  state,
} from "./store";
import { alerts } from "./model";
import type { MonitorEnv } from "./env";
// Known public apps share the analytics contract's display names.
const publicApp = (id: string): string | undefined =>
  Object.hasOwn(APP_NAMES, id) ? APP_NAMES[id as App] : undefined;
type Status = Coverage["status"];
function failure(error: unknown) {
  if (error instanceof ApiError)
    return error.status === 401 || error.status === 403
      ? "Permission unavailable or token expired."
      : error.status === 422
        ? "Analytics dataset unavailable for this connection."
        : `Cloudflare request failed (${error.status || "network"}).`;
  return "Collection failed; previous results retained.";
}
async function attempt(
  db: D1Database,
  source: string,
  now: string,
  run: () => Promise<void>,
  { canBeUnsupported = true } = {},
): Promise<Status> {
  try {
    await run();
    await coverage(db, source, "ok", "Available", now);
    return "ok";
  } catch (e) {
    const status: Status =
      canBeUnsupported && e instanceof ApiError && e.status === 422
        ? "unsupported"
        : "unavailable";
    await coverage(db, source, status, failure(e), now);
    return status;
  }
}
// "unsupported" is a settled answer for this account: progress markers advance past it.
const settled = (status: Status) => status !== "unavailable";
export async function discover(
  client: CloudflareClient,
  db: D1Database,
  now: string,
) {
  const found = new Map<
    string,
    { definition: (typeof inventories)[number]; rows: Row[] }
  >();
  for (const definition of inventories)
    await attempt(db, `${definition.kind} inventory`, now, async () => {
      const rows = await client.list(definition.path, definition.nested);
      if (
        rows.length > 2000 ||
        rows.some((r) => !text(r[definition.id]) || !text(r[definition.name]))
      )
        throw new Error("Invalid inventory");
      found.set(definition.kind, { definition, rows });
    });
  const workers = found.get("Workers")?.rows ?? [];
  const pages = found.get("Pages")?.rows ?? [];
  const apps = [
    ...workers.map((w) => ({ id: text(w.id), name: text(w.id) })),
    ...pages.map((w) => ({ id: `pages:${text(w.name)}`, name: text(w.name) })),
  ];
  if (apps.length)
    await db.batch(
      apps.map((a) =>
        db
          .prepare(
            "INSERT INTO cf_apps(id,name,visibility) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(
            a.id,
            publicApp(a.id) ?? a.name,
            publicApp(a.id) ? "public" : "unknown",
          ),
      ),
    );
  const owners = new Map<string, Set<string>>();
  const own = (key: string, app: string) => {
    const set = owners.get(key) ?? new Set();
    set.add(app);
    owners.set(key, set);
  };
  const bindingStatus = (await attempt(db, "Worker bindings", now, async () => {
    // Read only binding references. Discard plaintext variables, secrets, source code and logs.
    for (const worker of workers) {
      const settings = await client.accountRequest(
        `/workers/scripts/${encodeURIComponent(text(worker.id))}/settings`,
      );
      const bindings = isRecord(settings.result)
        ? settings.result.bindings
        : undefined;
      if (!Array.isArray(bindings)) throw new Error("Bindings missing");
      for (const b of bindings.filter(isRecord)) {
        const key =
          b.type === "d1"
            ? resourceKey("D1", text(b.id))
            : b.type === "r2_bucket"
              ? resourceKey("R2", text(b.bucket_name))
              : b.type === "kv_namespace"
                ? resourceKey("KV", text(b.namespace_id))
                : b.type === "durable_object_namespace"
                  ? resourceKey("Durable Objects", text(b.namespace_id))
                  : b.type === "queue"
                    ? resourceKey("Queues", text(b.queue_name))
                    : "";
        if (key && !key.endsWith(":")) own(key, text(worker.id));
      }
    }
  })) === "ok";
  const previous = await db
    .prepare("SELECT id,app FROM cf_resources")
    .all<{ id: string; app: string }>();
  const previousOwners = new Map(previous.results.map((r) => [r.id, r.app]));
  for (const { definition: d, rows } of found.values()) {
    const resources: Resource[] = rows.map((r) => {
      const nativeId = text(r[d.id]),
        name = text(r[d.name]),
        id = resourceKey(d.kind, nativeId);
      const script = text(r.script);
      if (d.kind === "Durable Objects" && apps.some((a) => a.id === script))
        own(id, script);
      const bindings = owners.get(
        d.kind === "Queues" ? resourceKey("Queues", name) : id,
      );
      const matches = apps.filter(
        (a) =>
          name === a.name ||
          name.startsWith(`${a.name}-`) ||
          name.startsWith(`${a.name}_`),
      );
      let app = bindings?.size
        ? bindings.size > 1
          ? "shared"
          : [...bindings][0]!
        : matches.length === 1
          ? matches[0]!.id
          : "unassigned";
      if (d.kind === "Workers") app = nativeId;
      if (d.kind === "Pages") app = `pages:${nativeId}`;
      if (
        !bindingStatus &&
        previousOwners.has(id) &&
        d.kind !== "Workers" &&
        d.kind !== "Pages"
      )
        app = previousOwners.get(id)!;
      return { id, nativeId, name, kind: d.kind, app, active: true };
    });
    await saveInventory(db, d.kind, resources, now);
  }
}
export async function collectBilling(
  client: CloudflareClient,
  db: D1Database,
  now: Date,
) {
  const info = await client.accountRequest("/billable-usage/info");
  if (!isRecord(info.result) || info.result.covered !== true)
    throw new ApiError(422);
  const periods = billingPeriods(info.result, now);
  if (!periods.length) throw new Error("Billing period missing");
  // Query the full cycle including its anchor. Arbitrary date filters can return no rows.
  const rows: unknown[] = [];
  const starts = [...new Set(periods.map((p) => p.start.slice(0, 10)))];
  for (const from of starts) {
    const json = await client.accountRequest(
      `/billable-usage?from=${from}&to=${isoDay(now)}`,
    );
    if (!Array.isArray(json.result)) throw new Error("Billing rows missing");
    rows.push(...json.result);
  }
  const charges = await normalizeCharges(rows, periods);
  const unique = [...new Map(charges.map((c) => [c.id, c])).values()];
  await saveCharges(db, unique, periods);
  await setState(db, "periods", periods);
}
export async function collectSubscriptions(
  client: CloudflareClient,
  db: D1Database,
) {
  const raw = await client.list("/subscriptions");
  const rows: Subscription[] = raw.map((s) => {
    const plan = isRecord(s.rate_plan) ? s.rate_plan : {},
      product = isRecord(s.product) ? s.product : {};
    const currency = text(s.currency ?? plan.currency);
    if (!text(s.id) || !/^[A-Z]{3}$/.test(currency))
      throw new Error("Invalid subscription");
    return {
      id: text(s.id),
      name: text(plan.public_name || product.public_name) || "Subscription",
      amount: micros(s.price),
      currency,
      frequency: text(s.frequency),
      renews: text(s.current_period_end) || null,
    };
  });
  await saveSubscriptions(db, rows);
}
// Collection proper. Runs only after the account identity pin has been verified.
async function collectAll(
  client: CloudflareClient,
  db: D1Database,
  now: Date,
  timestamp: string,
) {
  const day = isoDay(now);
  if ((await state<string>(db, "discovered")) !== day) {
    await discover(client, db, timestamp);
    // Only advance the daily marker when inventory and bindings all settled.
    const failed = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM cf_coverage WHERE (source LIKE '% inventory' OR source='Worker bindings') AND status NOT IN ('ok','unsupported')",
      )
      .first<{ n: number }>();
    if (!failed?.n) await setState(db, "discovered", day);
  }
  if (
    (await state<string>(db, "billed")) !== day &&
    settled(
      await attempt(db, "Billing", timestamp, () =>
        collectBilling(client, db, now),
      ),
    )
  )
    await setState(db, "billed", day);
  if (
    (await state<string>(db, "subscribed")) !== day &&
    settled(
      await attempt(db, "Subscriptions", timestamp, () =>
        collectSubscriptions(client, db),
      ),
    )
  )
    await setState(db, "subscribed", day);
  // Backfill one additional day per invocation within upstream retention, tracked per
  // dataset so one failing or unsupported dataset never stalls the others.
  const legacyAge = (await state<number>(db, "backfillAge")) ?? 2;
  for (const d of datasets) {
    const key = `backfillAge:${d.name}`;
    const age = (await state<number>(db, key)) ?? legacyAge;
    const days = [isoDay(new Date(now.getTime() - DAY)), day];
    if (age < 30) days.push(isoDay(new Date(now.getTime() - age * DAY)));
    const status = await attempt(
      db,
      `${d.kind} usage · ${d.name}`,
      timestamp,
      async () => {
        for (const date of days) {
          const values = usageRows(
            d,
            await client.graphql(analyticsSelection(d), date),
            date,
          );
          await saveUsage(
            db,
            values,
            date,
            d.fields.map((f) => f.metric),
          );
        }
      },
    );
    if (settled(status) && age < 30) await setState(db, key, age + 1);
  }
  await setState(db, "lastCollected", timestamp);
}
async function deliverAlerts(
  env: MonitorEnv,
  now: Date,
  timestamp: string,
  transport?: typeof fetch,
) {
  const webhook = env.CF_ALERT_WEBHOOK;
  if (!webhook) return;
  const db = env.DB;
  await attempt(db, "Alert delivery", timestamp, async () => {
    const target = new URL(webhook);
    if (target.protocol !== "https:" || target.username || target.password)
      throw new Error("Invalid webhook");
    // Alerts only need the current billing period and recent days, not the full history.
    const data = await readData(env, {
      since: isoDay(new Date(now.getTime() - 40 * DAY)),
      now,
    });
    for (const alert of alerts(data, now)) {
      if (alert.id.startsWith("source:Alert delivery")) continue;
      if (
        await db
          .prepare("SELECT id FROM cf_alerts WHERE id=?")
          .bind(alert.id)
          .first()
      )
        continue;
      const response = await (transport ?? fetch)(target.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `Glimpse · ${alert.message}` }),
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Webhook failed");
      await db
        .prepare(
          "INSERT INTO cf_alerts(id,delivered_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(alert.id, timestamp)
        .run();
    }
  });
}
export async function collect(
  env: MonitorEnv,
  now = new Date(),
  transport?: typeof fetch,
) {
  if (!configured(env)) return;
  const db = env.DB,
    timestamp = now.toISOString(),
    owner = crypto.randomUUID();
  const lease = await db
    .prepare(
      "INSERT INTO cf_leases(key,expires,owner) VALUES('collector',?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires,owner=excluded.owner WHERE cf_leases.expires<?",
    )
    .bind(now.getTime() + 14 * 60000, owner, now.getTime())
    .run();
  if (!lease.meta.changes) return;
  const errors: unknown[] = [];
  // Phases are isolated: an identity or collection failure must still run local retention
  // and deliver alerts (an expired or revoked token is the most likely failure).
  const phase = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      logFailure(`Monitor ${name} failed`, error);
      errors.push(error);
    }
  };
  try {
    await phase("collection", async () => {
      const client = new CloudflareClient(
        env.CF_ACCOUNT_ID!,
        env.CF_API_TOKEN!,
        transport,
      );
      const identity = await attempt(
        db,
        CONNECTION_SOURCE,
        timestamp,
        async () => {
          const account = await client.accountRequest("");
          if (!isRecord(account.result) || account.result.name !== ACCOUNT_NAME)
            throw new Error("Account mismatch");
        },
        // A connection is never "unsupported": every identity failure must alert.
        { canBeUnsupported: false },
      );
      if (identity === "ok") await collectAll(client, db, now, timestamp);
    });
    await phase("retention", async () => {
      const cutoff = isoDay(new Date(now.getTime() - 399 * DAY));
      await db.batch([
        db.prepare("DELETE FROM cf_usage WHERE day<?").bind(cutoff),
        db.prepare("DELETE FROM cf_charges WHERE end<?").bind(cutoff),
        db.prepare("DELETE FROM cf_alerts WHERE delivered_at<?").bind(cutoff),
      ]);
    });
    await phase("alerts", () => deliverAlerts(env, now, timestamp, transport));
  } finally {
    await db
      .prepare("DELETE FROM cf_leases WHERE key='collector' AND owner=?")
      .bind(owner)
      .run();
  }
  if (errors.length) throw errors[0];
}
