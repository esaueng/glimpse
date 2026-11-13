import { describe, expect, it } from "vitest";
import { customRangeError, readScope, scopeSearch, validScope } from "../web/ranges";
import { bucketLabel, eventLabel } from "../web/labels";
import { bytes, signed } from "../web/data";
import { readReport } from "../web/ReportInspector";
const now = new Date("2026-10-19T12:00:00Z");
describe("scope from the URL", () => {
  it("ignores keys the dashboard does not own", () => {
    expect(readScope("?app=openfea&range=7d&utm_source=x&cf_app=openzcad", now)).toEqual({
      scope: { app: "openfea", from: "2026-10-13", to: "2026-10-19", preset: "7d" },
      notice: "",
    });
    expect(readScope("?app=openzcad&from=2026-10-01&to=2026-10-10&view=issues&level=bogus", now).scope)
      .toEqual({ app: "openzcad", from: "2026-10-01", to: "2026-10-10" });
  });
  it("defaults to all apps and the past 30 days without a notice", () => {
    expect(readScope("", now)).toEqual({
      scope: { app: "all", from: "2026-09-20", to: "2026-10-19", preset: "30d" },
      notice: "",
    });
  });
  it("resets invalid ranges and apps with a notice, keeping what is valid", () => {
    const tooLong = readScope("?app=openfea&from=2026-01-01&to=2026-10-01", now);
    expect(tooLong.scope).toEqual({ app: "openfea", from: "2026-09-20", to: "2026-10-19", preset: "30d" });
    expect(tooLong.notice).toMatch(/reset to the past 30 days/);
    expect(readScope("?from=2026-13-40&to=bad", now).notice).toMatch(/not a valid range/);
    expect(readScope("?from=2026-10-01&to=2026-10-25", now).notice).not.toBe("");
    expect(readScope("?range=999d", now).notice).toMatch(/unknown/);
    const app = readScope("?app=nope&range=14d", now);
    expect(app.scope).toMatchObject({ app: "all", preset: "14d" });
    expect(app.notice).toMatch(/app/);
  });
  it("writes a canonical query and preserves foreign keys", () => {
    expect(
      scopeSearch({ app: "openfea", from: "a", to: "b", preset: "7d" }, "issues", "?utm_source=x&from=old&view=storage&cf_app=openzcad"),
    ).toBe("?app=openfea&range=7d&view=issues&utm_source=x&cf_app=openzcad");
    expect(scopeSearch({ app: "all", from: "2026-10-01", to: "2026-10-02" }, "overview")).toBe(
      "?app=all&from=2026-10-01&to=2026-10-02&view=overview",
    );
  });
  it("round-trips every scope it writes", () => {
    for (const search of ["?app=openfea&range=7d", "?app=openzcad&from=2026-08-01&to=2026-10-19"]) {
      const { scope } = readScope(search, now);
      expect(validScope(scope, now)).toBe(true);
      expect(readScope(scopeSearch(scope, "overview"), now)).toEqual({ scope, notice: "" });
    }
  });
});
describe("custom range validation", () => {
  it("allows up to 90 inclusive days ending by today", () => {
    expect(customRangeError("2026-07-22", "2026-10-19", now)).toBe("");
    expect(customRangeError("2026-07-21", "2026-10-19", now)).toMatch(/91 days/);
    expect(customRangeError("2026-10-10", "2026-10-01", now)).toMatch(/before/);
    expect(customRangeError("2026-10-10", "2026-10-20", now)).toMatch(/today/);
    expect(customRangeError("", "2026-10-01", now)).toMatch(/both/);
  });
});
describe("readable labels and formats", () => {
  it("names report codes and buckets", () => {
    expect(eventLabel("error_mesh")).toBe("Mesh error");
    expect(eventLabel("error_unresponsive")).toBe("Page unresponsive (5 s or more)");
    expect(eventLabel("error_gpu_lost")).toBe("GPU device lost");
    expect(eventLabel("error_out_of_memory")).toBe("Out of memory");
    expect(eventLabel("error_worker")).toBe("Background worker error");
    expect(eventLabel("mesh_latency")).toBe("Meshing time");
    expect(bucketLabel("mesh_latency", "1s_10s")).toBe("1–10 s");
    expect(bucketLabel("project_size", "gte_100mib")).toBe("≥100 MiB");
    expect(bucketLabel("feature_operation", "sketch.add")).toBe("Add sketch");
    expect(bucketLabel("solver_backend", "webgpu")).toBe("WebGPU");
    expect(bucketLabel("part_count", "2_10")).toBe("2–10 parts");
  });
  it("uses one byte precision and true minus signs", () => {
    expect(bytes(7 * 2 ** 30)).toBe("7.0 GiB");
    expect(bytes(6.94 * 2 ** 30)).toBe("6.9 GiB");
    expect(bytes(512 * 2 ** 20)).toBe("512 MiB");
    expect(signed(-3 * 2 ** 20, bytes)).toBe("−3.0 MiB");
    expect(signed(12)).toBe("+12");
  });
});
describe("report inspector parsing", () => {
  it("separates empty input, JSON syntax and schema errors", () => {
    expect(readReport("  ")).toEqual({ error: expect.stringMatching(/empty/) });
    expect(readReport("{bad")).toEqual({ error: expect.stringMatching(/not valid JSON/) });
    expect(readReport('{"schema":1}')).toEqual({ error: expect.stringMatching(/not a Glimpse v2 report/) });
    const ok = readReport(JSON.stringify({ schema: 2, app: "openfea", rows: [{ event: "error_mesh", bucket: "none", count: 7 }] }));
    expect("report" in ok && ok.report.rows).toHaveLength(1);
  });
});
