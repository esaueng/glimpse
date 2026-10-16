import { APPS, BUCKETS, dateRange, metric, type Row } from "../src/contract";
import {
  EXPANDED,
  SIZES,
  PARTS,
  TIMINGS,
  type CensusRow,
} from "../src/expanded";
import type { Range, Stats } from "./data";

// Entirely fictional, deterministic counts. No network, storage, or production imports.
export function demoStats(range: Range, now = new Date()): Stats {
  const parsed = dateRange(new URLSearchParams(range), now);
  if (!parsed) throw new Error("Choose a valid UTC range of at most 90 days.");
  const rows: Row[] = [],
    census: CensusRow[] = [];
  for (
    let time = Date.parse(parsed.from);
    time <= Date.parse(parsed.to);
    time += 86400000
  ) {
    const day = new Date(time).toISOString().slice(0, 10);
    const dayIndex = Math.floor(time / 86400000);
    for (const [index, app] of APPS.entries()) {
      if (parsed.app !== "all" && parsed.app !== app) continue;
      const scale = [1, 0.62, 0.38][index];
      const wave =
        1 +
        0.22 * Math.sin(dayIndex * 0.7 + index) +
        0.12 * Math.cos(dayIndex * 0.23);
      function add(event: string, bucket: string, base: number) {
        if (!metric({ level: parsed!.level, event, bucket }, app)) return;
        rows.push({
          day,
          app,
          level: parsed!.level,
          event,
          bucket,
          count: Math.max(1, Math.round(base * scale * wave)),
        });
      }
      if (parsed.level === "basic") {
        add("api_request", "none", 2400);
        add("api_error", "none", 9);
        BUCKETS.forEach((bucket, i) =>
          add("api_latency", bucket, [1700, 580, 105, 13, 2][i]),
        );
        continue;
      }
      for (const [event, base] of Object.entries({
        workspace_opened: 186,
        export_completed: 74,
        export_failed: 2,
        solver_completed: 82,
        solver_failed: 3,
        generation_completed: 218,
        generation_failed: 4,
        workflow_model: 158,
        workflow_mesh: 136,
        workflow_setup: 121,
        workflow_run: 96,
        workflow_results: 81,
        feature_used: 860,
      }))
        add(event, "none", base);
      TIMINGS.forEach((bucket, i) => {
        for (const event of [
          "operation_latency",
          "mesh_latency",
          "solver_latency",
          "save_latency",
          "export_latency",
        ])
          add(event, bucket, [240, 168, 68, 19, 4][i]);
      });
      for (const event of [
        "project_size",
        "transfer_upload",
        "transfer_download",
      ])
        SIZES.forEach((bucket, i) => add(event, bucket, [64, 43, 18, 3][i]));
      PARTS.forEach((bucket, i) =>
        add("part_count", bucket, [4, 35, 63, 22, 5][i]),
      );
      for (const [event, buckets] of Object.entries(EXPANDED)) {
        if (event.startsWith("error_"))
          add(event, "none", event === "error_import" ? 4 : 2);
        if (
          [
            "feature_operation",
            "feature_category",
            "cloud_status",
            "solver_backend",
          ].includes(event)
        )
          buckets.forEach((bucket, i) =>
            add(event, bucket, Math.max(2, 52 - i * 3)),
          );
      }
    }
    if (
      parsed.level === "optional" &&
      ["all", "openzcad"].includes(parsed.app)
    ) {
      const growth = dayIndex % 90;
      const lt1mib = 238 + growth,
        mib1to10 = 164 + growth,
        mib10to100 = 57,
        gte100mib = 12;
      census.push({
        day,
        app: "openzcad",
        generation: time,
        accounts: 84 + Math.floor(growth / 3),
        projects: lt1mib + mib1to10 + mib10to100 + gte100mib,
        revisions: 2400 + growth * 12,
        storedBytes: 8_300_000_000 + growth * 18_000_000,
        logicalBytes: 6_700_000_000 + growth * 12_000_000,
        unknownArtifacts: 3,
        lt1mib,
        mib1to10,
        mib10to100,
        gte100mib,
      });
    }
  }
  return {
    range: parsed,
    rows,
    census: census.reverse(),
    receivedAt: now.toISOString(),
  };
}

export async function loadDemoStats(range: Range): Promise<Stats> {
  return demoStats(range);
}
