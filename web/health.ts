// App health and "needs attention" signals for the Home page. Pure functions over the
// daily aggregates, so the thresholds are testable and stated in one place.
import { APPS, BUCKETS, type App, type Row } from "../src/contract";
import { appName, bucketCounts, diagnosticCount, errorCodes, number, percent, total, type Loaded } from "./data";
import { diagnosticLabels, label } from "./labels";

/** Server-error share of API requests at which an app is degraded, then failing. */
export const ERROR_RATE = { degraded: 0.01, failing: 0.05 } as const;
/** Share of API requests taking 1 s or more at which an app is degraded. */
export const SLOW_SHARE = 0.1;
/** A day is a spike when it has at least this many errors and this multiple of the median day. */
export const SPIKE = { min: 5, factor: 3 } as const;
/** Failure share of exports, solves or generations worth flagging, given enough attempts. */
export const FAILURE = { share: 0.1, minAttempts: 5 } as const;

export type Status = "healthy" | "degraded" | "failing" | "idle";
export const statusLabel: Record<Status, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failing: "Failing",
  idle: "No traffic",
};

export type AppHealth = {
  app: App;
  status: Status;
  requests: number;
  errors: number;
  /** Server errors per API request; null without requests. */
  errorRate: number | null;
  /** Share of timed API requests at 1 s or more; null without timings. */
  slowShare: number | null;
  diagnostics: number;
  workspaces: number;
  dailyRequests: number[];
  dailyErrors: number[];
  lastDay: string | null;
};

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = Date.parse(from); d <= Date.parse(to); d += 86400000)
    out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

function daily(rows: Row[], event: string, app: App, range: string[]): number[] {
  const byDay = new Map<string, number>();
  for (const r of rows)
    if (r.event === event && r.app === app) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.count);
  return range.map((day) => byDay.get(day) ?? 0);
}

export function appHealth(data: Loaded, app: App): AppHealth {
  const basic = data.basic.rows,
    optional = data.optional.rows,
    range = days(data.basic.range.from, data.basic.range.to);
  const requests = total(basic, "api_request", app),
    errors = total(basic, "api_error", app),
    latency = bucketCounts(basic, "api_latency", BUCKETS, app),
    timed = latency.reduce((n, v) => n + v, 0),
    // Buckets: <100 ms, 100 ms–1 s, 1–10 s, 10–60 s, ≥60 s.
    slow = latency.slice(2).reduce((n, v) => n + v, 0);
  const errorRate = requests ? errors / requests : null,
    slowShare = timed ? slow / timed : null;
  const status: Status = !requests
    ? "idle"
    : errorRate! >= ERROR_RATE.failing
      ? "failing"
      : errorRate! >= ERROR_RATE.degraded || (slowShare ?? 0) >= SLOW_SHARE
        ? "degraded"
        : "healthy";
  const seen = [...basic, ...optional].filter((r) => r.app === app).map((r) => r.day).sort();
  return {
    app,
    status,
    requests,
    errors,
    errorRate,
    slowShare,
    diagnostics: diagnosticCount(optional, app),
    workspaces: total(optional, "workspace_opened", app),
    dailyRequests: daily(basic, "api_request", app, range),
    dailyErrors: daily(basic, "api_error", app, range),
    lastDay: seen.at(-1) ?? null,
  };
}

export type Severity = "critical" | "warning" | "info";
export type Attention = {
  id: string;
  severity: Severity;
  app?: App;
  title: string;
  detail: string;
  /** The page that explains it. */
  view: "issues" | "performance" | "sources";
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

const shortDay = (day: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );

const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Signals worth a look, most severe first. Every item names its evidence. */
export function attention(data: Loaded, scope: string): Attention[] {
  const apps = APPS.filter((a) => scope === "all" || scope === a),
    optional = data.optional.rows,
    range = days(data.basic.range.from, data.basic.range.to),
    items: Attention[] = [];
  for (const app of apps) {
    const h = appHealth(data, app),
      name = appName(app);
    if (h.status === "failing" || h.status === "degraded") {
      if (h.errorRate !== null && h.errorRate >= ERROR_RATE.degraded)
        items.push({
          id: `${app}:error-rate`,
          severity: h.status === "failing" ? "critical" : "warning",
          app,
          title: `${percent(h.errors, h.requests)} of ${name} API requests failed`,
          detail: `${number(h.errors)} server errors (5xx) in ${number(h.requests)} requests · all users`,
          view: "issues",
        });
      if (h.slowShare !== null && h.slowShare >= SLOW_SHARE)
        items.push({
          id: `${app}:slow`,
          severity: "warning",
          app,
          title: `${percent(h.slowShare, 1)} of ${name} API requests took 1 s or more`,
          detail: "Response-time ranges · all users",
          view: "performance",
        });
    }
    if (h.status === "idle" && range.length > 1)
      items.push({
        id: `${app}:idle`,
        severity: "info",
        app,
        title: `No ${name} API requests received`,
        detail: "Check the app's service binding and collection switch",
        view: "sources",
      });
    // Spike: the worst day against the median day, so one bad day stands out in a calm month.
    const usual = median(h.dailyErrors),
      worst = h.dailyErrors.reduce((best, v, i, a) => (v > a[best]! ? i : best), 0),
      peak = h.dailyErrors[worst] ?? 0;
    if (range.length >= 3 && peak >= SPIKE.min && peak >= SPIKE.factor * Math.max(usual, 1))
      items.push({
        id: `${app}:spike`,
        severity: "warning",
        app,
        title: `${name} server errors spiked on ${shortDay(range[worst]!)}`,
        detail: `${number(peak)} errors that day; a typical day had ${number(usual)}`,
        view: "issues",
      });
    for (const [failed, completed, what] of [
      ["export_failed", "export_completed", "exports"],
      ["solver_failed", "solver_completed", "solver runs"],
      ["generation_failed", "generation_completed", "lattice generations"],
    ] as const) {
      const bad = total(optional, failed, app),
        attempts = bad + total(optional, completed, app);
      if (attempts >= FAILURE.minAttempts && bad / attempts >= FAILURE.share)
        items.push({
          id: `${app}:${failed}`,
          severity: "warning",
          app,
          title: `${percent(bad, attempts)} of ${name} ${what} failed`,
          detail: `${number(bad)} of ${number(attempts)} attempts · opted-in users`,
          view: "issues",
        });
    }
  }
  const codes = errorCodes(optional.filter((r) => apps.includes(r.app))).slice(0, 3);
  for (const code of codes)
    items.push({
      id: `code:${code.event}`,
      severity: "info",
      title: `Diagnostic · ${label(diagnosticLabels, code.event)}`,
      detail: `${number(code.count)} reports · ${code.apps.map(appName).join(", ")} · opted-in users`,
      view: "issues",
    });
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
