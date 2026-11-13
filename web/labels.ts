import { CAD_OPERATIONS, CELLS, DIAGNOSTICS, PARTS, SIZES, TIMINGS } from "../src/expanded";
// Display names only. The allowlisted event and bucket vocabulary stays in src/.
export const operationLabels: Record<(typeof CAD_OPERATIONS)[number], string> = {
  transaction: "Transaction",
  "primitive.add": "Add primitive",
  "sketch.add": "Add sketch",
  "sketch.update": "Update sketch",
  "sketch.translate": "Move sketch",
  "sketch.object.add": "Add sketch object",
  "sketch.object.update": "Edit sketch object",
  "sketch.object.delete": "Delete sketch object",
  "sketch.constraint.add": "Add constraint",
  "sketch.constraint.delete": "Delete constraint",
  "sketch.constraint.label-position": "Move constraint label",
  "reference-dimension.add": "Add reference dimension",
  "reference-dimension.delete": "Delete reference dimension",
  "reference-dimension.label-position": "Move dimension label",
  "feature.extrude": "Extrude",
  "feature.revolve": "Revolve",
  "feature.loft": "Loft",
  "feature.sweep": "Sweep",
  "feature.helical-sweep": "Helical sweep",
  "feature.boolean": "Boolean",
  "feature.transform": "Transform",
  "feature.mirror": "Mirror",
  "feature.split": "Split",
  "feature.hole": "Hole",
  "feature.shell": "Shell",
  "feature.solid-offset": "Solid offset",
  "feature.draft": "Draft",
  "feature.thicken": "Thicken",
  "feature.direct-edit": "Direct edit",
  "feature.fillet": "Fillet",
  "feature.chamfer": "Chamfer",
  "feature.pattern": "Pattern",
  "feature.update": "Update feature",
  "feature.delete": "Delete feature",
  "feature.reorder": "Reorder features",
  "parameter.set": "Set parameter",
  "parameter.configure-toggle": "Configure parameter toggle",
  "parameter.expose": "Expose parameter",
  "parameter.describe": "Describe parameter",
  "parameter.rename": "Rename parameter",
  "parameter.delete": "Delete parameter",
  "import.mesh": "Import mesh",
  "import.step": "Import STEP",
  "import.shapr-guided": "Guided Shapr import",
  "node.rename": "Rename node",
  "node.metadata.set": "Set node metadata",
};
export const diagnosticLabels: Record<(typeof DIAGNOSTICS)[number], string> = {
  error_runtime: "Runtime",
  error_import: "Import",
  error_export: "Export",
  error_mesh: "Mesh",
  error_solver: "Solver",
  error_cloud_save: "Cloud save",
  error_cloud_load: "Cloud load",
  error_storage: "Local storage",
  error_feature: "Feature",
  error_render: "Render",
  error_unresponsive: "Unresponsive page",
  error_gpu_lost: "GPU device lost",
  error_out_of_memory: "Out of memory",
  error_worker: "Background worker",
};
// Event names where "<label> error" would read badly.
const diagnosticEventLabels: Partial<Record<(typeof DIAGNOSTICS)[number], string>> = {
  error_unresponsive: "Page unresponsive (5 s or more)",
  error_gpu_lost: "GPU device lost",
  error_out_of_memory: "Out of memory",
};
/** What each diagnostic code means, for the title tooltip and the report inspector. */
export const diagnosticHints: Partial<Record<(typeof DIAGNOSTICS)[number], string>> = {
  error_unresponsive: "Main thread blocked for 5 s or more",
  error_gpu_lost: "WebGPU or WebGL device or context lost",
  error_out_of_memory: "Allocation failure or out-of-memory signal",
  error_worker: "A Web Worker failed or stopped unexpectedly",
};
export const cloudStatusLabels: Record<string, string> = {
  unauthorized: "Unauthorized",
  forbidden: "Forbidden",
  conflict: "Conflict",
  too_large: "Too large",
  rate_limited: "Rate limited",
  server: "Server",
  network: "Network",
  other: "Other",
};
export const label = (labels: Record<string, string>, key: string) =>
  labels[key] ?? key;
export const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);
export const timingLabels = [
  "<100 ms",
  "100 ms–1 s",
  "1–10 s",
  "10–60 s",
  "≥60 s",
];
export const sizeLabels = ["<1 MiB", "1–10 MiB", "10–100 MiB", "≥100 MiB"];
export const partLabels = ["0 parts", "1 part", "2–10 parts", "11–100 parts", "101+ parts"];
/** Short labels for `CELLS` (unit cells per generated lattice), in the same order. */
export const cellLabels: Record<(typeof CELLS)[number], string> = {
  lt_1k: "<1k",
  "1k_10k": "1k–10k",
  "10k_100k": "10k–100k",
  gte_100k: "≥100k",
};
const eventLabels: Record<string, string> = {
  feature_operation: "CAD operation",
  feature_category: "Feature category",
  cloud_status: "Cloud request failure",
  project_size: "Saved project size",
  part_count: "Parts per saved model",
  lattice_cells: "Cells per generated lattice",
  transfer_upload: "Upload size",
  transfer_download: "Download size",
  mesh_latency: "Meshing time",
  solver_latency: "Solving time",
  export_latency: "Export time",
  save_latency: "Cloud save time",
  operation_latency: "In-app operation time",
  api_latency: "API request time",
  solver_backend: "Solver backend",
};
const bucketLabels: Record<string, string> = {
  ...Object.fromEntries(TIMINGS.map((b, i) => [b, timingLabels[i]!])),
  ...Object.fromEntries(SIZES.map((b, i) => [b, sizeLabels[i]!])),
  cpu: "CPU",
  webgpu: "WebGPU",
  unknown: "Unknown",
  none: "Total",
};
/** Readable name for an allowlisted event code, e.g. error_mesh → "Mesh error". */
export function eventLabel(event: string): string {
  if (event in diagnosticLabels) {
    const code = event as keyof typeof diagnosticLabels;
    return diagnosticEventLabels[code] ?? `${diagnosticLabels[code]} error`;
  }
  return eventLabels[event] ?? event;
}
/** Readable name for a bucket of an event, e.g. 1s_10s → "1–10 s". */
export function bucketLabel(event: string, bucket: string): string {
  if (event === "feature_operation") return label(operationLabels, bucket);
  if (event === "cloud_status") return label(cloudStatusLabels, bucket);
  if (event === "feature_category") return capitalize(bucket);
  if (event === "lattice_cells")
    return bucket in cellLabels
      ? `${cellLabels[bucket as keyof typeof cellLabels]} cells`
      : bucket;
  if (event === "part_count") {
    const i = (PARTS as readonly string[]).indexOf(bucket);
    return i >= 0 ? partLabels[i]! : bucket;
  }
  return bucketLabels[bucket] ?? bucket;
}
