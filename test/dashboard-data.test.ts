import { describe, expect, it } from "vitest";
import {
  bucketCounts,
  bytes,
  censusHistory,
  dailySeries,
  dailyTotals,
  diagnosticCount,
  errorCodes,
  latestCensus,
  percent,
  total,
} from "../web/data";
import { cloudStatusLabels, diagnosticLabels, operationLabels } from "../web/labels";
import { CAD_OPERATIONS, DIAGNOSTICS, EXPANDED, type CensusRow } from "../src/expanded";
import type { Row } from "../src/contract";
const row = (r: Partial<Row>): Row => ({
  day: "2026-10-15",
  app: "openzcad",
  level: "optional",
  event: "error_import",
  bucket: "none",
  count: 1,
  ...r,
});
describe("redesigned dashboard aggregates", () => {
  it("separates diagnostic codes from failed outcomes and keeps per-app sources", () => {
    const rows = [
      row({ event: "error_import", count: 3 }),
      row({ event: "error_import", app: "openfea", count: 2 }),
      row({ event: "error_mesh", app: "openfea", count: 1 }),
      row({ event: "export_failed", count: 9 }),
    ];
    expect(errorCodes(rows)).toEqual([
      { event: "error_import", count: 5, apps: ["openzcad", "openfea"] },
      { event: "error_mesh", count: 1, apps: ["openfea"] },
    ]);
    // The older combined count still includes failed outcomes for compatibility.
    expect(diagnosticCount(rows)).toBe(15);
  });
  it("counts buckets in the declared order and fills empty days with zero", () => {
    const rows = [
      row({ event: "save_latency", bucket: "gte_60s", count: 2 }),
      row({ event: "save_latency", bucket: "lt_100ms", count: 5, app: "openfea" }),
      row({ event: "api_error", level: "basic", day: "2026-10-14", count: 4 }),
    ];
    expect(bucketCounts(rows, "save_latency", ["lt_100ms", "100ms_1s", "gte_60s"])).toEqual([5, 0, 2]);
    expect(bucketCounts(rows, "save_latency", ["lt_100ms"], "openzcad")).toEqual([0]);
    expect(
      dailyTotals(
        {
          range: { app: "all", level: "basic", from: "2026-10-13", to: "2026-10-14" },
          rows,
          census: [],
          receivedAt: "",
        },
        "api_error",
      ),
    ).toEqual([
      { day: "2026-10-13", value: 0 },
      { day: "2026-10-14", value: 4 },
    ]);
  });
  it("orders snapshot history by day and keeps only the latest generation per day", () => {
    const a = { day: "2026-10-15", generation: 1, accounts: 1 } as CensusRow,
      b = { day: "2026-10-15", generation: 3, accounts: 2 } as CensusRow,
      c = { day: "2026-10-14", generation: 2, accounts: 5 } as CensusRow;
    expect(censusHistory([a, b, c])).toEqual([c, b]);
  });
  it("formats shares without dividing by zero", () => {
    expect(percent(1, 4)).toBe("25.0%");
    expect(percent(1, 0)).toBe("—");
  });
  it("has a display label for every allowlisted operation, diagnostic and cloud status", () => {
    expect(Object.keys(operationLabels).sort()).toEqual([...CAD_OPERATIONS].sort());
    expect(Object.keys(diagnosticLabels).sort()).toEqual([...DIAGNOSTICS].sort());
    expect(Object.keys(cloudStatusLabels).sort()).toEqual([...EXPANDED.cloud_status!].sort());
  });
});
describe("dashboard measurement semantics", () => {
  it("does not add latency observations into activity or diagnostic counts", () => {
    const rows = [
      {
        day: "2026-10-15",
        app: "openfea" as const,
        level: "optional" as const,
        event: "workspace_opened",
        bucket: "none",
        count: 4,
      },
      {
        day: "2026-10-15",
        app: "openfea" as const,
        level: "optional" as const,
        event: "solver_latency",
        bucket: "gte_60s",
        count: 10,
      },
      {
        day: "2026-10-15",
        app: "openfea" as const,
        level: "optional" as const,
        event: "error_solver",
        bucket: "none",
        count: 2,
      },
    ];
    expect(total(rows, "workspace_opened")).toBe(4);
    expect(diagnosticCount(rows)).toBe(2);
    expect(diagnosticCount(rows, "openzcad")).toBe(0);
    expect(
      dailySeries(
        {
          range: {
            app: "all",
            level: "optional",
            from: "2026-10-14",
            to: "2026-10-15",
          },
          rows,
          census: [],
          receivedAt: "",
        },
        "workspace_opened",
      ),
    ).toEqual([
      { day: "2026-10-14", openzcad: 0, openfea: 0, openlattice3d: 0 },
      { day: "2026-10-15", openzcad: 0, openfea: 4, openlattice3d: 0 },
    ]);
  });
  it("uses the latest snapshot without summing account or storage stocks across days", () => {
    const old = { day: "2026-10-14", generation: 1, accounts: 10 } as CensusRow;
    const current = {
      day: "2026-10-15",
      generation: 2,
      accounts: 7,
    } as CensusRow;
    expect(latestCensus([old, current])).toBe(current);
    expect(latestCensus([])).toBeUndefined();
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1048576)).toBe("1 MiB");
  });
});
