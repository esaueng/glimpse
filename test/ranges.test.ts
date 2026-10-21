import { describe, expect, it } from "vitest";
import { dateRange } from "../src/contract";
import { formatRange, presetIds, presetRange, refreshedTimeframe, spanDays } from "../web/ranges";
// Monday 19 October 2026, late in the UTC day.
const now = new Date("2026-10-19T23:30:00Z");
describe("timeframe presets", () => {
  it("resolves rolling and calendar presets to inclusive UTC days", () => {
    expect(presetRange("today", now)).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(presetRange("yesterday", now)).toEqual({ from: "2026-10-18", to: "2026-10-18" });
    expect(presetRange("7d", now)).toEqual({ from: "2026-10-13", to: "2026-10-19" });
    expect(presetRange("90d", now)).toEqual({ from: "2026-07-22", to: "2026-10-19" });
    expect(presetRange("this-week", now)).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(presetRange("prev-week", now)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(presetRange("this-month", now)).toEqual({ from: "2026-10-01", to: "2026-10-19" });
    expect(presetRange("prev-month", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("prev-month", new Date("2026-01-10T00:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
  it("only produces ranges the stats API accepts", () => {
    for (const id of presetIds) {
      const range = presetRange(id, now);
      expect(dateRange(new URLSearchParams(range), now), id).not.toBeNull();
    }
    expect(spanDays("2026-07-22", "2026-10-19")).toBe(90);
  });
  it("formats ranges compactly", () => {
    expect(formatRange("2026-10-19", "2026-10-19")).toMatch(/2026/);
    expect(formatRange("2025-12-20", "2026-01-05")).toMatch(/2025.*2026/);
  });
  it("refreshes Today and rolling days after UTC midnight", () => {
    const later = new Date("2026-10-20T00:05:00Z");
    expect(refreshedTimeframe({ from: "2026-10-19", to: "2026-10-19", preset: "today" }, later))
      .toEqual({ from: "2026-10-20", to: "2026-10-20", preset: "today" });
    expect(refreshedTimeframe({ from: "2026-10-13", to: "2026-10-19", preset: "7d" }, later))
      .toEqual({ from: "2026-10-14", to: "2026-10-20", preset: "7d" });
  });
  it("refreshes calendar presets across month and year boundaries", () => {
    expect(refreshedTimeframe({ from: "2026-12-01", to: "2026-12-31", preset: "this-month" }, new Date("2027-01-01T00:05:00Z")))
      .toEqual({ from: "2027-01-01", to: "2027-01-01", preset: "this-month" });
    expect(refreshedTimeframe({ from: "2026-11-01", to: "2026-11-30", preset: "prev-month" }, new Date("2027-01-01T00:05:00Z")))
      .toEqual({ from: "2026-12-01", to: "2026-12-31", preset: "prev-month" });
  });
  it("keeps a custom range fixed when refreshing on a later date", () => {
    const custom = { from: "2026-10-01", to: "2026-10-19" };
    expect(refreshedTimeframe(custom, new Date("2026-10-20T00:05:00Z"))).toEqual(custom);
    expect(custom).toEqual({ from: "2026-10-01", to: "2026-10-19" });
  });
});
