import { APPS, APP_NAMES, type App, type Row } from "../src/contract";
import type { CensusRow } from "../src/expanded";
export type Range = { app: string; level: string; from: string; to: string };
export type Stats = {
  range: Range;
  rows: Row[];
  census: CensusRow[];
  receivedAt: string;
};
export const appName = (app: string) =>
  APPS.includes(app as App) ? APP_NAMES[app as App] : "All apps";
export const number = (value: number) => value.toLocaleString();
export function bytes(value: number): string {
  if (value < 1024) return `${number(value)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)) - 1,
  );
  return `${(value / 1024 ** (index + 1)).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[index]}`;
}
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
