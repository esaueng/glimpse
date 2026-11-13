// Mirrored in the app integrations. No free-form dimensions or diagnostic text.
export const TIMINGS = [
  "lt_100ms",
  "100ms_1s",
  "1s_10s",
  "10s_60s",
  "gte_60s",
] as const;
export const SIZES = ["lt_1mib", "1_10mib", "10_100mib", "gte_100mib"] as const;
export const PARTS = ["0", "1", "2_10", "11_100", "gte_101"] as const;
export const DIAGNOSTICS = [
  "error_runtime",
  "error_import",
  "error_export",
  "error_mesh",
  "error_solver",
  "error_cloud_save",
  "error_cloud_load",
  "error_storage",
  "error_feature",
  "error_render",
  // Privacy review approved 13 Nov 2026 (docs/PRIVACY.md). Accepted from OpenZCAD and OpenFEA
  // like the codes above; nothing is collected until an app adapter sends them.
  "error_unresponsive", // main thread blocked for 5 s or more
  "error_gpu_lost", // WebGPU/WebGL device or context lost
  "error_out_of_memory", // allocation failure or out-of-memory signal
  "error_worker", // a Web Worker failed or terminated unexpectedly
] as const;
export const CAD_OPERATIONS = [
  "transaction",
  "primitive.add",
  "sketch.add",
  "sketch.update",
  "sketch.translate",
  "sketch.object.add",
  "sketch.object.update",
  "sketch.object.delete",
  "sketch.constraint.add",
  "sketch.constraint.delete",
  "sketch.constraint.label-position",
  "reference-dimension.add",
  "reference-dimension.delete",
  "reference-dimension.label-position",
  "feature.extrude",
  "feature.revolve",
  "feature.loft",
  "feature.sweep",
  "feature.helical-sweep",
  "feature.boolean",
  "feature.transform",
  "feature.mirror",
  "feature.split",
  "feature.hole",
  "feature.shell",
  "feature.solid-offset",
  "feature.draft",
  "feature.thicken",
  "feature.direct-edit",
  "feature.fillet",
  "feature.chamfer",
  "feature.pattern",
  "feature.update",
  "feature.delete",
  "feature.reorder",
  "parameter.set",
  "parameter.configure-toggle",
  "parameter.expose",
  "parameter.describe",
  "parameter.rename",
  "parameter.delete",
  "import.mesh",
  "import.step",
  "import.shapr-guided",
  "node.rename",
  "node.metadata.set",
] as const;
export const EXPANDED: Readonly<Record<string, readonly string[]>> = {
  feature_operation: CAD_OPERATIONS,
  cloud_status: [
    "unauthorized",
    "forbidden",
    "conflict",
    "too_large",
    "rate_limited",
    "server",
    "network",
    "other",
  ],
  project_size: SIZES,
  part_count: PARTS,
  transfer_upload: SIZES,
  transfer_download: SIZES,
  mesh_latency: TIMINGS,
  solver_latency: TIMINGS,
  export_latency: TIMINGS,
  save_latency: TIMINGS,
  solver_backend: ["cpu", "webgpu", "unknown"],
  feature_category: [
    "create",
    "edit",
    "import",
    "export",
    "mesh",
    "solve",
    "measure",
    "other",
  ],
  ...Object.fromEntries(DIAGNOSTICS.map((event) => [event, ["none"]])),
};
export function expandedMetric(
  event: unknown,
  bucket: unknown,
  app: string,
): boolean {
  if (!["openzcad", "openfea"].includes(app)) return false;
  if (typeof event !== "string" || typeof bucket !== "string") return false;
  if (
    app === "openzcad" &&
    [
      "error_mesh",
      "error_solver",
      "mesh_latency",
      "solver_latency",
      "solver_backend",
    ].includes(event)
  )
    return false;
  if (
    app !== "openzcad" &&
    ["feature_operation", "cloud_status"].includes(event)
  )
    return false;
  return (
    Object.hasOwn(EXPANDED, event) &&
    (EXPANDED[event]?.includes(bucket) ?? false)
  );
}
export type Report = {
  schema: 2;
  app: "openzcad" | "openfea";
  rows: { event: string; bucket: string; count: number }[];
};
export function parseReport(value: unknown): Report | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !== "app,rows,schema" ||
    v.schema !== 2 ||
    typeof v.app !== "string" ||
    !["openzcad", "openfea"].includes(v.app) ||
    !Array.isArray(v.rows) ||
    v.rows.length > 128
  )
    return null;
  const seen = new Set<string>();
  for (const raw of v.rows as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (
      Object.keys(r).sort().join(",") !== "bucket,count,event" ||
      typeof r.event !== "string" ||
      typeof r.bucket !== "string" ||
      !expandedMetric(r.event, r.bucket, String(v.app)) ||
      typeof r.count !== "number" ||
      !Number.isSafeInteger(r.count) ||
      r.count < 1 ||
      r.count > 10000000
    )
      return null;
    const key = `${r.event}:${r.bucket}`;
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return v as Report;
}
export const CENSUS_FIELDS = [
  "accounts",
  "projects",
  "revisions",
  "storedBytes",
  "logicalBytes",
  "unknownArtifacts",
  "lt1mib",
  "mib1to10",
  "mib10to100",
  "gte100mib",
] as const;
// Optional account-activity counts (migration 0005). Privacy review approved 13 Nov 2026.
// All three arrive together or not at all, so older OpenZCAD versions keep working.
export const ACTIVITY_FIELDS = ["active7d", "active30d", "idle90d"] as const;
export type ActivityField = (typeof ACTIVITY_FIELDS)[number];
/**
 * Minimum count (k) for an activity field. A count below K, or one that leaves fewer
 * than K consenting accounts outside it (that complement is derivable from `accounts`),
 * is withheld: stored and served as null, never as the raw value. Migration 0005 also
 * rejects stored values below 5 in the database, so K may be raised here but not lowered
 * without a new migration and privacy review.
 */
export const ACTIVITY_MIN_COUNT = 5;
/**
 * Present (all three keys) when the snapshot carried activity counts; null means withheld.
 * Absent means not collected: an older OpenZCAD, or migration 0005 not yet applied.
 */
export type Activity = Record<ActivityField, number | null>;
export type Census = Record<(typeof CENSUS_FIELDS)[number], number> & {
  generation: number;
} & Partial<Activity>;
export type CensusRow = Census & { day: string; app: "openzcad" };
const isCount = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 1000000000000000;
export function census(value: unknown, app: string): Census | null {
  if (
    app !== "openzcad" ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return null;
  const v = value as Record<string, unknown>;
  const base = ["generation", ...CENSUS_FIELDS] as const;
  const activity = ACTIVITY_FIELDS.some((k) => Object.hasOwn(v, k));
  const keys: readonly string[] = activity ? [...base, ...ACTIVITY_FIELDS] : base;
  if (
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k)) ||
    base.some((k) => !isCount(v[k]))
  )
    return null;
  const c = Object.fromEntries(base.map((k) => [k, v[k]])) as Census;
  if (
    c.generation < 1 ||
    c.projects !== c.lt1mib + c.mib1to10 + c.mib10to100 + c.gte100mib ||
    (c.accounts === 0 && CENSUS_FIELDS.some((k) => c[k] !== 0))
  )
    return null;
  if (!activity) return c;
  // The app may already withhold a field (null). Numbers are bounded by the consenting
  // account total and must be consistent: a 7-day saver is also a 30-day saver, and an
  // account with a save in the last 30 days has not gone 90 days without one.
  const a = {} as Activity;
  for (const k of ACTIVITY_FIELDS) {
    const n = v[k];
    if (n !== null && !(isCount(n) && n <= c.accounts)) return null;
    a[k] = n;
  }
  if (
    (a.active7d !== null && a.active30d !== null && a.active7d > a.active30d) ||
    (a.active30d !== null &&
      a.idle90d !== null &&
      a.active30d + a.idle90d > c.accounts)
  )
    return null;
  return { ...c, ...a };
}
/** The k-threshold for one activity count against its snapshot's consenting-account total. */
export function withheld(value: number, accounts: number): boolean {
  return value < ACTIVITY_MIN_COUNT || accounts - value < ACTIVITY_MIN_COUNT;
}
/**
 * Applies the k-threshold to a validated snapshot (at ingest) and to a stored row (at
 * read time, defensively). A field that is not a safe integer stays withheld (null). A
 * snapshot without activity fields is returned unchanged.
 */
export function thresholdActivity<T extends Partial<Activity> & { accounts: number }>(
  row: T,
): T {
  if (!ACTIVITY_FIELDS.some((k) => Object.hasOwn(row, k))) return row;
  const result = { ...row };
  for (const k of ACTIVITY_FIELDS) {
    const n = row[k];
    result[k] = (
      typeof n === "number" && Number.isSafeInteger(n) && !withheld(n, row.accounts)
        ? n
        : null
    ) as T[typeof k];
  }
  return result;
}
/**
 * Shapes a stored `daily_census` row for /api/stats. `activityReported` marks rows whose
 * snapshot carried activity counts. Without it (older snapshots, or migration 0005 not
 * applied) the activity keys are dropped, which the dashboard shows as "Not collected".
 */
export function publicCensus(row: Record<string, unknown>): CensusRow {
  const { activityReported, ...rest } = row;
  if (activityReported !== 1) {
    for (const k of ACTIVITY_FIELDS) delete rest[k];
    return rest as CensusRow;
  }
  return thresholdActivity(rest as CensusRow);
}
