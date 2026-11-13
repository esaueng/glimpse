import type { App, CloudflareData } from "../../src/cloudflare/model";
import { formatUsage, metricNames } from "./format";

export function matchesProduct(kind: string, product: string) {
  return (
    product === "all" ||
    kind === product ||
    (product === "Workers KV" && kind === "KV")
  );
}

const priorities = [
  "workerRequests",
  "rowsWritten",
  "doDuration",
  "containerCpuSeconds",
  "queueOperations",
];
const rank = (metric: string) =>
  priorities.indexOf(metric) < 0 ? 99 : priorities.indexOf(metric);

/** The two most telling summed metrics for an app's usage rows. */
export function usageSummary(rows: CloudflareData["usage"]) {
  const sums = new Map<string, { value: number; unit: string }>();
  for (const row of rows)
    if (row.aggregation === "sum") {
      const prior = sums.get(row.metric);
      sums.set(row.metric, {
        value: (prior?.value ?? 0) + row.value,
        unit: row.unit,
      });
    }
  return (
    [...sums]
      .sort(([a], [b]) => rank(a) - rank(b))
      .slice(0, 2)
      .map(
        ([metric, v]) =>
          `${metricNames[metric] ?? metric}: ${formatUsage(v.value, v.unit)}`,
      )
      .join(" · ") ||
    (rows.length ? "Storage observations available" : "No usage received")
  );
}

/** Per-resource metric totals: sums add up, peaks keep the maximum. */
export function resourceMetrics(
  resource: string,
  usage: CloudflareData["usage"],
) {
  const values = new Map<string, { value: number; unit: string }>();
  for (const u of usage)
    if (u.resource === resource) {
      const prior = values.get(u.metric);
      values.set(u.metric, {
        unit: u.unit,
        value: prior
          ? u.aggregation === "sum"
            ? prior.value + u.value
            : Math.max(prior.value, u.value)
          : u.value,
      });
    }
  return values;
}

/** Demo mode keeps settings in memory, mirroring what the settings API stores. */
export function applyDemoSetting(
  current: CloudflareData,
  value: Record<string, unknown>,
): CloudflareData {
  if ("resource" in value)
    return {
      ...current,
      resources: current.resources.map((r) =>
        r.id === value.resource ? { ...r, app: String(value.app) } : r,
      ),
    };
  if ("id" in value) {
    const app: App = {
      id: String(value.id),
      name: String(value.name),
      visibility: value.visibility as App["visibility"],
      budget: value.budget as number | null,
    };
    return current.apps.some((a) => a.id === app.id)
      ? {
          ...current,
          apps: current.apps.map((a) => (a.id === app.id ? { ...a, ...app } : a)),
        }
      : { ...current, apps: [...current.apps, app] };
  }
  return { ...current, budget: value.budget as number | null };
}
