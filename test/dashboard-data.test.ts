import { describe, expect, it } from "vitest";
import {
  bytes,
  dailySeries,
  diagnosticCount,
  latestCensus,
  total,
} from "../web/data";
import type { CensusRow } from "../src/expanded";
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
