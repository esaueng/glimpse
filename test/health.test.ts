import { describe, expect, it } from "vitest";
import type { App, Row } from "../src/contract";
import type { Loaded } from "../web/data";
import { appHealth, attention } from "../web/health";

const from = "2026-11-01",
  to = "2026-11-07";
const row = (day: string, app: App, event: string, count: number, bucket = "none"): Row => ({
  day,
  app,
  level: event.startsWith("api_") ? "basic" : "optional",
  event,
  bucket,
  count,
});
const days = ["01", "02", "03", "04", "05", "06", "07"].map((d) => `2026-11-${d}`);
function loaded(basic: Row[], optional: Row[] = []): Loaded {
  const stats = (rows: Row[], level: string) => ({
    range: { app: "all", level, from, to },
    rows,
    census: [],
    receivedAt: "2026-11-07T12:00:00Z",
  });
  return { basic: stats(basic, "basic"), optional: stats(optional, "optional") };
}
/** 1,000 requests a day, all under 100 ms, with the given errors per day. */
const traffic = (app: App, errors: number[] = days.map(() => 0)) =>
  days.flatMap((day, i) => [
    row(day, app, "api_request", 1000),
    row(day, app, "api_latency", 1000, "lt_100ms"),
    ...(errors[i] ? [row(day, app, "api_error", errors[i]!)] : []),
  ]);

describe("appHealth", () => {
  it("is idle without requests and healthy with a low error rate", () => {
    expect(appHealth(loaded([]), "openzcad").status).toBe("idle");
    const h = appHealth(loaded(traffic("openzcad", [5, 5, 5, 5, 5, 5, 5])), "openzcad");
    expect(h.status).toBe("healthy");
    expect(h.errorRate).toBeCloseTo(0.005);
    expect(h.dailyRequests).toEqual(days.map(() => 1000));
    expect(h.lastDay).toBe("2026-11-07");
  });
  it("is degraded at 1% server errors and failing at 5%", () => {
    expect(appHealth(loaded(traffic("openfea", days.map(() => 10))), "openfea").status).toBe("degraded");
    expect(appHealth(loaded(traffic("openfea", days.map(() => 50))), "openfea").status).toBe("failing");
  });
  it("is degraded when 10% of timed requests take 1 s or more", () => {
    const rows = [...traffic("openlattice3d"), row(to, "openlattice3d", "api_latency", 800, "1s_10s")];
    const h = appHealth(loaded(rows), "openlattice3d");
    expect(h.slowShare).toBeCloseTo(800 / 7800);
    expect(h.status).toBe("degraded");
  });
  it("counts only the requested app", () => {
    const data = loaded([...traffic("openzcad", days.map(() => 100)), ...traffic("openfea")]);
    expect(appHealth(data, "openfea").status).toBe("healthy");
    expect(appHealth(data, "openzcad").status).toBe("failing");
  });
});

describe("attention", () => {
  it("is empty for healthy traffic", () => {
    expect(attention(loaded(traffic("openzcad")), "openzcad")).toEqual([]);
  });
  it("flags a failing error rate as critical before other signals", () => {
    const items = attention(
      loaded(traffic("openzcad", days.map(() => 60)), [row(to, "openzcad", "error_import", 4)]),
      "openzcad",
    );
    expect(items[0]).toMatchObject({ id: "openzcad:error-rate", severity: "critical", view: "issues" });
    expect(items.at(-1)).toMatchObject({ severity: "info", title: "Diagnostic · Import" });
  });
  it("flags a one-day error spike against the median day", () => {
    const items = attention(loaded(traffic("openzcad", [1, 2, 1, 40, 1, 2, 1])), "openzcad");
    expect(items.map((i) => i.id)).toContain("openzcad:spike");
    // Fewer than five errors on the worst day is noise.
    expect(attention(loaded(traffic("openzcad", [0, 0, 0, 4, 0, 0, 0])), "openzcad")).toEqual([]);
  });
  it("flags failure rates only with enough attempts", () => {
    const fails = (failed: number, completed: number) =>
      attention(
        loaded(traffic("openzcad"), [
          row(to, "openzcad", "export_failed", failed),
          row(to, "openzcad", "export_completed", completed),
        ]),
        "openzcad",
      ).map((i) => i.id);
    expect(fails(2, 8)).toContain("openzcad:export_failed");
    expect(fails(2, 2)).toEqual([]);
    expect(fails(1, 99)).toEqual([]);
  });
  it("notes apps with no requests and ignores apps outside the scope", () => {
    const data = loaded(traffic("openzcad"));
    expect(attention(data, "all").map((i) => i.id)).toEqual(["openfea:idle", "openlattice3d:idle"]);
    expect(attention(data, "openzcad")).toEqual([]);
  });
});
