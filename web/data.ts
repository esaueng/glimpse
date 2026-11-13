import { APPS, APP_NAMES, type App, type Row } from "../src/contract";
import { withheld, type ActivityField, type CensusRow } from "../src/expanded";
export type Range = { app: string; level: string; from: string; to: string };
export type Stats = {
  range: Range;
  rows: Row[];
  census: CensusRow[];
  /** Optional-schema migrations not yet applied (never blocking), e.g. 0005_census_activity.sql. */
  pendingMigrations?: string[];
  receivedAt: string;
};
export type ActivityDisplay =
  | { state: "value"; value: number }
  | { state: "withheld" }
  | { state: "not-collected" };
/**
 * One activity count from the latest snapshot. A missing key is "Not collected" (an older
 * OpenZCAD, or migration 0005 pending); null is "Withheld" by the k-threshold. A number
 * is re-checked against the threshold here as well, so a small value is never shown.
 */
export function activityValue(row: CensusRow, key: ActivityField): ActivityDisplay {
  if (!Object.hasOwn(row, key)) return { state: "not-collected" };
  const value = row[key];
  return typeof value === "number" && !withheld(value, row.accounts)
    ? { state: "value", value }
    : { state: "withheld" };
}
export const appName = (app: string) =>
  APPS.includes(app as App) ? APP_NAMES[app as App] : "All apps";
// Formatters are created once; number() runs for every table cell and tick.
const integer = new Intl.NumberFormat(),
  fixed: Intl.NumberFormat[] = [0, 1, 2].map(
    (digits) =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
  ),
  upTo1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const number = (value: number) => integer.format(value);
/** Binary units with one fixed decimal below 100, so "7.0 GiB" sits beside "6.9 GiB". */
export function bytes(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude < 1024) return `${number(value)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(magnitude) / Math.log(1024)) - 1,
  );
  const scaled = value / 1024 ** (index + 1);
  return `${fixed[Math.abs(scaled) < 99.95 ? 1 : 0]!.format(scaled)} ${units[index]}`;
}
/** Signed change with a true minus sign, e.g. "+12" or "−1.2 GiB". */
export const signed = (n: number, format: (value: number) => string = number) =>
  `${n < 0 ? "−" : "+"}${format(Math.abs(n))}`;
export const ratio = (a: number, b: number) => (b ? upTo1.format(a / b) : "—");
export function total(rows: Row[], event: string, app?: App): number {
  return rows.reduce(
    (n, r) => n + (r.event === event && (!app || r.app === app) ? r.count : 0),
    0,
  );
}
export const isDiagnostic = (row: Row) =>
  row.event.startsWith("error_") ||
  ["export_failed", "solver_failed", "generation_failed"].includes(row.event);
export function diagnosticCount(rows: Row[], app?: App) {
  return rows.reduce(
    (n, r) => n + (isDiagnostic(r) && (!app || r.app === app) ? r.count : 0),
    0,
  );
}
export function grouped(rows: Row[], predicate: (row: Row) => boolean) {
  const values = new Map<
    string,
    { app: App; event: string; bucket: string; count: number }
  >();
  for (const r of rows.filter(predicate)) {
    const key = `${r.app}:${r.event}:${r.bucket}`;
    const prior = values.get(key);
    if (prior) prior.count += r.count;
    else
      values.set(key, {
        app: r.app,
        event: r.event,
        bucket: r.bucket,
        count: r.count,
      });
  }
  return [...values.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.event.localeCompare(b.event) ||
      a.app.localeCompare(b.app),
  );
}
export function dailySeries(data: Stats, event: string) {
  const days: string[] = [];
  for (
    let d = Date.parse(data.range.from);
    d <= Date.parse(data.range.to);
    d += 86400000
  )
    days.push(new Date(d).toISOString().slice(0, 10));
  const totals = new Map<string, number>();
  for (const row of data.rows)
    if (row.event === event)
      totals.set(
        `${row.day}:${row.app}`,
        (totals.get(`${row.day}:${row.app}`) ?? 0) + row.count,
      );
  return days.map((day) => ({
    day,
    openzcad: totals.get(`${day}:openzcad`) ?? 0,
    openfea: totals.get(`${day}:openfea`) ?? 0,
    openlattice3d: totals.get(`${day}:openlattice3d`) ?? 0,
  }));
}
export type Loaded = { basic: Stats; optional: Stats };
export const percent = (part: number, whole: number, digits = 1) =>
  whole
    ? `${(fixed[digits] ?? new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })).format((part / whole) * 100)}%`
    : "—";
export function bucketCounts(
  rows: Row[],
  event: string,
  buckets: readonly string[],
  app?: App,
) {
  return buckets.map((bucket) =>
    rows.reduce(
      (n, r) =>
        n +
        (r.event === event && r.bucket === bucket && (!app || r.app === app)
          ? r.count
          : 0),
      0,
    ),
  );
}
export const isErrorCode = (row: Row) => row.event.startsWith("error_");
export function errorCodes(rows: Row[]) {
  const codes = new Map<string, { event: string; count: number; apps: App[] }>();
  for (const r of rows.filter(isErrorCode)) {
    const code = codes.get(r.event) ?? { event: r.event, count: 0, apps: [] };
    code.count += r.count;
    if (!code.apps.includes(r.app)) code.apps.push(r.app);
    codes.set(r.event, code);
  }
  return [...codes.values()]
    .map((c) => ({ ...c, apps: APPS.filter((a) => c.apps.includes(a)) }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event));
}
export function dailyTotals(data: Stats, event: string | ((row: Row) => boolean)) {
  const match =
    typeof event === "string" ? (r: Row) => r.event === event : event;
  const totals = new Map<string, number>();
  for (const row of data.rows)
    if (match(row)) totals.set(row.day, (totals.get(row.day) ?? 0) + row.count);
  return dailySeries(data, "").map(({ day }) => ({
    day,
    value: totals.get(day) ?? 0,
  }));
}
// One snapshot per UTC day (latest generation), oldest first. Stocks, never summed.
export function censusHistory(rows: CensusRow[]): CensusRow[] {
  const days = new Map<string, CensusRow>();
  for (const row of rows) {
    const prior = days.get(row.day);
    if (!prior || row.generation > prior.generation) days.set(row.day, row);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
export function latestCensus(rows: CensusRow[]): CensusRow | undefined {
  return rows.reduce<CensusRow | undefined>(
    (latest, row) =>
      !latest ||
      row.day > latest.day ||
      (row.day === latest.day && row.generation > latest.generation)
        ? row
        : latest,
    undefined,
  );
}
