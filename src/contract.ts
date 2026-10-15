import { expandedMetric } from "./expanded";
// This vocabulary is the entire analytics schema. No free-text properties.
export const BUCKETS = [
  "lt_100ms",
  "100ms_1s",
  "1s_10s",
  "10s_60s",
  "gte_60s",
] as const;
export const BASIC = ["api_request", "api_error", "api_latency"] as const;
export const OPTIONAL = [
  "workspace_opened",
  "export_completed",
  "export_failed",
  "solver_completed",
  "solver_failed",
  "generation_completed",
  "generation_failed",
  "workflow_model",
  "workflow_mesh",
  "workflow_setup",
  "workflow_run",
  "workflow_results",
  "feature_used",
  "operation_latency",
] as const;
export const APPS = ["openzcad", "openfea", "openlattice3d"] as const;
export type App = (typeof APPS)[number];
export const APP_NAMES: Record<App, string> = {
  openzcad: "OpenZCAD",
  openfea: "OpenFEA",
  openlattice3d: "OpenLattice3D",
};
const LATTICE_OPTIONAL = [
  "workspace_opened",
  "export_completed",
  "export_failed",
  "generation_completed",
  "generation_failed",
  "operation_latency",
];
export type Level = "basic" | "optional";
export interface Metric {
  level: Level;
  event: string;
  bucket: string;
}
export interface Row extends Metric {
  day: string;
  app: App;
  count: number;
}
export function metric(value: unknown, app: App): Metric | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 3 ||
    Object.keys(v).some((k) => !["level", "event", "bucket"].includes(k))
  )
    return null;
  if (typeof v.event !== "string" || typeof v.bucket !== "string") return null;
  const allowed: readonly string[] =
    v.level === "basic" ? BASIC : v.level === "optional" ? OPTIONAL : [];
  if (!allowed.includes(v.event)) {
    return v.level === "optional" && expandedMetric(v.event, v.bucket, app)
      ? { level: "optional", event: v.event, bucket: v.bucket }
      : null;
  }
  if (
    (app === "openlattice3d" &&
      v.level === "optional" &&
      !LATTICE_OPTIONAL.includes(v.event)) ||
    (app !== "openlattice3d" && v.event.startsWith("generation_"))
  )
    return null;
  if (
    app === "openzcad" &&
    (v.event.startsWith("solver_") ||
      v.event === "workflow_mesh" ||
      v.event === "workflow_run" ||
      v.event === "workflow_results")
  )
    return null;
  if (
    v.event.endsWith("_latency")
      ? !(BUCKETS as readonly string[]).includes(v.bucket)
      : v.bucket !== "none"
  )
    return null;
  return { level: v.level as Level, event: v.event, bucket: v.bucket };
}
export function dateRange(
  params: URLSearchParams,
  today = new Date(),
): { from: string; to: string; app: App | "all"; level: Level } | null {
  if (
    [...params.keys()].some(
      (k) => !["from", "to", "app", "level"].includes(k),
    ) ||
    [...params.keys()].some((k) => params.getAll(k).length !== 1)
  )
    return null;
  const to = params.get("to") ?? today.toISOString().slice(0, 10);
  const from =
    params.get("from") ??
    new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  const app = params.get("app") ?? "all",
    level = params.get("level") ?? "basic";
  if (
    !valid(from) ||
    !valid(to) ||
    from > to ||
    to > today.toISOString().slice(0, 10) ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 89 ||
    !["all", ...APPS].includes(app) ||
    !["basic", "optional"].includes(level)
  )
    return null;
  return { from, to, app: app as App | "all", level: level as Level };
}
