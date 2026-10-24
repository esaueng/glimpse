// Infrastructure metadata is independent of the consent-gated app analytics contract.
export type Visibility = "public" | "private" | "unknown";
export type ResourceKind =
  | "Workers"
  | "Pages"
  | "D1"
  | "R2"
  | "KV"
  | "Durable Objects"
  | "Containers"
  | "Queues"
  | "Zones";
export type App = {
  id: string;
  name: string;
  visibility: Visibility;
  budget: number | null;
};
export type Resource = {
  id: string;
  nativeId: string;
  name: string;
  kind: ResourceKind;
  app: string;
  active: boolean;
  dashboardUrl?: string;
};
export type Usage = {
  day: string;
  resource: string;
  metric: string;
  value: number;
  unit: string;
  aggregation: "sum" | "max" | "quantile";
};
export type Charge = {
  id: string;
  subscription: string;
  periodStart: string;
  periodEnd: string;
  start: string;
  end: string;
  family: string;
  description: string;
  unit: string;
  quantity: number;
  cost: number;
  currency: string;
};
export type Subscription = {
  id: string;
  name: string;
  amount: number | null;
  currency: string;
  frequency: string;
  renews: string | null;
};
export type Coverage = {
  source: string;
  status: "ok" | "unavailable" | "unsupported";
  message: string;
  checkedAt: string;
  lastSuccess: string | null;
};
export type CloudflareData = {
  configured: boolean;
  account: "Esau";
  apps: App[];
  resources: Resource[];
  usage: Usage[];
  charges: Charge[];
  subscriptions: Subscription[];
  coverage: Coverage[];
  periods: { start: string; end: string }[];
  budget: number | null;
  receivedAt: string;
};
export const DAY = 86400000;
export const isoDay = (date = new Date()) => date.toISOString().slice(0, 10);
export const resourceKey = (kind: string, id: string) => `${kind}:${id}`;
export const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    value / 1e6,
  );
export const micros = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e9
    ? Math.round(n * 1e6)
    : null;
export const finite = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
export const text = (s: unknown, max = 200): string =>
  typeof s === "string" ? s.slice(0, max) : "";
export function validDay(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    isoDay(new Date(s)) === s
  );
}
export function validRange(from: string, to: string, now = new Date()) {
  return (
    validDay(from) &&
    validDay(to) &&
    from <= to &&
    to <= isoDay(now) &&
    Date.parse(to) - Date.parse(from) < 400 * DAY
  );
}
export function emptyData(
  configured = false,
  now = new Date(),
): CloudflareData {
  return {
    configured,
    account: "Esau",
    apps: [],
    resources: [],
    usage: [],
    charges: [],
    subscriptions: [],
    coverage: [],
    periods: [],
    budget: null,
    receivedAt: now.toISOString(),
  };
}
function nextAnchor(start: string, now: Date) {
  const anchor = new Date(start),
    day = anchor.getUTCDate();
  let month = now.getUTCMonth(),
    year = now.getUTCFullYear();
  const candidate = (y: number, m: number) =>
    new Date(
      Date.UTC(
        y,
        m,
        Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()),
      ),
    );
  if (candidate(year, month) > now) month--;
  const from = candidate(year, month),
    to = candidate(from.getUTCFullYear(), from.getUTCMonth() + 1);
  return { start: from.toISOString(), end: to.toISOString() };
}
export function billingPeriods(info: unknown, now = new Date()) {
  const v = info as {
    subscriptions?: {
      billing_cycle_anchor_timestamp?: string;
      start_timestamp?: string;
      end_timestamp?: string;
    }[];
  };
  const periods = (v?.subscriptions ?? [])
    .filter((s) => !s.end_timestamp || s.end_timestamp > now.toISOString())
    .flatMap((s) => {
      const anchor = s.billing_cycle_anchor_timestamp || s.start_timestamp;
      return anchor && !Number.isNaN(Date.parse(anchor))
        ? [nextAnchor(anchor, now)]
        : [];
    });
  return [...new Map(periods.map((p) => [p.start, p])).values()].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
}
export async function normalizeCharges(
  input: unknown,
  periods: { start: string; end: string }[],
): Promise<Charge[]> {
  if (!Array.isArray(input)) throw new Error("Invalid billing response");
  return Promise.all(
    input.map(async (v): Promise<Charge> => {
      const stamp = (value: unknown) =>
        typeof value === "string" && !Number.isNaN(Date.parse(value))
          ? new Date(value).toISOString()
          : "";
      const start = stamp(v.ChargePeriodStart),
        end = stamp(v.ChargePeriodEnd),
        periodStart = stamp(v.BillingPeriodStart);
      const cost = micros(v.ContractedCost ?? v.BilledCost),
        rawQuantity = v.ConsumedQuantity ?? v.PricingQuantity,
        quantity =
          typeof rawQuantity === "number" && Number.isFinite(rawQuantity)
            ? rawQuantity
            : null;
      const currency = text(v.BillingCurrency);
      if (
        ![start, end, periodStart].every(
          (s) => s && !Number.isNaN(Date.parse(s)),
        ) ||
        start >= end ||
        cost === null ||
        quantity === null ||
        !/^[A-Z]{3}$/.test(currency)
      )
        throw new Error("Incomplete billing row");
      const row = {
        subscription: text(v.SubscriptionId),
        periodStart,
        periodEnd:
          stamp(v.BillingPeriodEnd) ||
          periods.find((p) => p.start === periodStart)?.end ||
          "",
        start,
        end,
        family: text(v.ServiceFamilyName || v.ServiceName),
        description: text(v.ChargeDescription || v.ServiceName),
        unit: text(v.ConsumedUnit || v.PricingUnit) || "Count",
        quantity,
        cost,
        currency,
      };
      // Identity excludes mutable amounts. Reconciliation replaces a charge; cumulative totals are never added.
      const identity = [
        row.subscription,
        periodStart,
        start,
        end,
        text(v.ServiceName),
        row.description,
        row.unit,
        text(v.ZoneId),
        currency,
      ];
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(identity)),
      );
      return {
        id: [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join(""),
        ...row,
      };
    }),
  );
}
// Only allocate a charge when a matching usage dimension is available. CPU quantiles
// and storage high-water marks cannot be substituted for billable CPU/storage duration.
export function allocationMetric(charge: Charge): string | null {
  const s = `${charge.family} ${charge.description}`.toLowerCase();
  if (s.includes("d1") && /rows? writ/.test(s)) return "rowsWritten";
  if (s.includes("d1") && /rows? read/.test(s)) return "rowsRead";
  if (/worker/.test(s) && /request/.test(s) && !/cpu|duration|durable/.test(s))
    return "workerRequests";
  if (/worker/.test(s) && /cpu/.test(s) && !/durable/.test(s))
    return "workerCpuUs";
  if (/queues/.test(s) && /operation/.test(s)) return "queueOperations";
  if (/durable/.test(s) && /duration/.test(s)) return "doDuration";
  if (/durable/.test(s) && /request/.test(s)) return "doRequests";
  if (/container/.test(s) && /cpu/.test(s)) return "containerCpuSeconds";
  if (/container/.test(s) && /memory/.test(s)) return "containerMemory";
  if (/container/.test(s) && /disk/.test(s)) return "containerDisk";
  return null;
}
export function allocate(
  charges: Charge[],
  usage: Usage[],
  resources: Resource[],
) {
  const owners = new Map(resources.map((r) => [r.id, r.app]));
  const result = new Map<string, number>();
  for (const charge of charges) {
    const metric = allocationMetric(charge);
    const weights = new Map<string, number>();
    for (const u of usage)
      if (
        metric &&
        u.metric === metric &&
        u.aggregation === "sum" &&
        u.day >= charge.start.slice(0, 10) &&
        u.day < charge.end.slice(0, 10)
      ) {
        const app = owners.get(u.resource) ?? "unassigned";
        weights.set(app, (weights.get(app) ?? 0) + u.value);
      }
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    if (!total) {
      result.set("unassigned", (result.get("unassigned") ?? 0) + charge.cost);
      continue;
    }
    // Integer microcurrency with remainder assignment keeps allocations equal to the account charge.
    const sign = charge.cost < 0 ? -1 : 1,
      magnitude = Math.abs(charge.cost);
    const entries = [...weights.entries()]
      .map(([app, weight]) => {
        const exact = (magnitude * weight) / total;
        return {
          app,
          amount: Math.floor(exact),
          fraction: exact - Math.floor(exact),
        };
      })
      .sort((a, b) => b.fraction - a.fraction || a.app.localeCompare(b.app));
    let remainder = magnitude - entries.reduce((n, e) => n + e.amount, 0);
    for (const entry of entries) {
      if (remainder > 0) {
        entry.amount++;
        remainder--;
      }
      result.set(entry.app, (result.get(entry.app) ?? 0) + sign * entry.amount);
    }
  }
  return result;
}
export function forecast(
  charges: Charge[],
  period: { start: string; end: string },
  now = new Date(),
): number | null {
  const rows = charges.filter(
    (c) => c.periodStart === period.start && c.end <= now.toISOString(),
  );
  const last = Math.max(0, ...rows.map((c) => Date.parse(c.end)));
  const elapsed = (last - Date.parse(period.start)) / DAY;
  if (elapsed < 3 || !rows.length) return null;
  return Math.round(
    (rows.reduce((sum, c) => sum + c.cost, 0) / elapsed) *
      ((Date.parse(period.end) - Date.parse(period.start)) / DAY),
  );
}
export type MonitorAlert = {
  id: string;
  message: string;
  severity: "warning" | "error";
};
export function alerts(data: CloudflareData, now = new Date()): MonitorAlert[] {
  const output: MonitorAlert[] = [];
  for (const c of data.coverage) {
    const maxAge =
      c.source.includes(" usage") || c.source === "Esau connection"
        ? 3 * 3600000
        : 48 * 3600000;
    if (c.status !== "ok" || now.getTime() - Date.parse(c.checkedAt) > maxAge)
      output.push({
        id: `source:${c.source}:${isoDay(now)}`,
        message: `${c.source}: ${c.status !== "ok" ? c.message : "collection is stale."}`,
        severity: "warning",
      });
  }
  const period = data.periods.find(
    (p) => p.start <= now.toISOString() && p.end > now.toISOString(),
  );
  if (!period) return output;
  const charges = data.charges.filter(
    (c) => c.periodStart === period.start && c.currency === "USD",
  );
  const allocations = allocate(charges, data.usage, data.resources);
  for (const scope of [
    { id: "account", name: "Esau", budget: data.budget },
    ...data.apps,
  ]) {
    if (!scope.budget) continue;
    const spent =
      scope.id === "account"
        ? charges.reduce((n, c) => n + c.cost, 0)
        : (allocations.get(scope.id) ?? 0);
    const threshold =
      spent >= scope.budget ? 100 : spent >= scope.budget * 0.8 ? 80 : null;
    if (threshold)
      output.push({
        id: `budget:${period.start}:${scope.id}:${threshold}`,
        message: `${scope.name} has used ${threshold}% of its USD metered-usage budget (${money(spent)} of ${money(scope.budget)}).${scope.id === "account" ? "" : " Based on allocated estimates."}`,
        severity: threshold === 100 ? "error" : "warning",
      });
  }
  const projected = forecast(charges, period, now);
  if (data.budget && projected !== null && projected > data.budget)
    output.push({
      id: `forecast:${period.start}`,
      message: `Esau metered usage is projected to reach ${money(projected)}, above the ${money(data.budget)} budget.`,
      severity: "warning",
    });
  const daily = new Map<string, number>();
  for (const c of charges)
    if (c.end <= now.toISOString())
      daily.set(
        c.start.slice(0, 10),
        (daily.get(c.start.slice(0, 10)) ?? 0) + c.cost,
      );
  const days = [...daily].sort(([a], [b]) => a.localeCompare(b));
  const last = days.at(-1),
    previous = days.slice(-8, -1);
  if (last && previous.length >= 3) {
    const mean = previous.reduce((n, [, v]) => n + v, 0) / previous.length;
    if (last[1] > Math.max(5e6, mean * 2))
      output.push({
        id: `spike:${last[0]}`,
        message: `${last[0]} metered usage reached ${money(last[1])}, over twice the recent daily average.`,
        severity: "warning",
      });
  }
  return output;
}
