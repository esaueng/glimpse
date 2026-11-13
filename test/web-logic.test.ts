// @vitest-environment node
// Pure display logic behind the dashboard: report parsing, Cloudflare URL
// filters and unit formatting.
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeSearch } from "../web/hooks";
import { readReport } from "../web/ReportInspector";
import {
  defaultFilters,
  readFilters,
  sameFilters,
  sanitizeFilters,
} from "../web/cloudflare/filters";
import {
  formatDuration,
  formatMoney,
  formatQuantity,
  formatUsage,
  isCurrency,
} from "../web/cloudflare/format";
import { cloudflareDemo } from "../web/cloudflare-demo";

describe("readReport", () => {
  const valid = JSON.stringify({
    schema: 2,
    app: "openfea",
    rows: [{ event: "error_mesh", bucket: "none", count: 7 }],
  });

  it("accepts a Glimpse v2 report", () => {
    const result = readReport(valid);
    expect("report" in result && result.report.app).toBe("openfea");
  });

  it("describes empty input", () => {
    for (const text of ["", "   \n\t"]) {
      const result = readReport(text);
      expect("error" in result && result.error).toMatch(/this one is empty/);
    }
  });

  it("describes JSON syntax errors separately", () => {
    const result = readReport("{bad json");
    expect("error" in result && result.error).toMatch(
      /^Report rejected: this is not valid JSON.*Check that the whole file was pasted\.$/,
    );
  });

  it("describes valid JSON that is not a report", () => {
    for (const text of ['{"schema":1}', "[]", "42", '{"schema":2,"app":"nope","rows":[]}']) {
      const result = readReport(text);
      expect("error" in result && result.error).toMatch(
        /the JSON is valid but is not a Glimpse v2 report/,
      );
    }
  });

  it("rejects oversized reports before parsing", () => {
    const result = readReport(`"${"x".repeat(65536)}"`);
    expect("error" in result && result.error).toMatch(/maximum size is 64 KiB/);
  });
});

describe("Cloudflare URL filters", () => {
  const now = new Date("2026-11-12T12:00:00Z"),
    data = cloudflareDemo(now),
    current = data.periods[0]!.start,
    previous = data.periods[1]!.start;

  it("reads cf_* parameters and ignores the dashboard's own", () => {
    expect(readFilters("?view=cloudflare&app=openfea&range=7d")).toEqual(
      defaultFilters,
    );
    expect(
      readFilters("?cf_app=openfea&cf_currency=EUR&cf_period=custom&cf_from=2026-10-01"),
    ).toEqual({
      ...defaultFilters,
      app: "openfea",
      currency: "EUR",
      period: "custom",
      from: "2026-10-01",
    });
  });

  it("normalises values the loaded data cannot show", () => {
    const requested = readFilters(
      "?cf_currency=bogus&cf_app=nope&cf_visibility=secret&cf_product=Pages" +
        "&cf_period=1999-01-01T00:00:00.000Z&cf_from=2026-13-40&cf_to=bad",
    );
    const shown = sanitizeFilters(requested, data, current);
    expect(shown).toEqual(defaultFilters);
    expect(sameFilters(shown, requested)).toBe(false);
  });

  it("rejects well-formed currencies with no data, and lowercase codes", () => {
    for (const currency of ["EUR", "usd", "<script>"])
      expect(
        sanitizeFilters({ ...defaultFilters, currency }, data, current).currency,
      ).toBe("USD");
  });

  it("keeps values present in the data", () => {
    const requested = {
      app: "sample-status",
      visibility: "private",
      product: "D1",
      period: previous,
      from: "2026-10-01",
      to: "2026-10-31",
      currency: "USD",
    };
    const shown = sanitizeFilters(requested, data, current);
    expect(shown).toEqual(requested);
    expect(sameFilters(shown, requested)).toBe(true);
  });

  it("canonicalises the current period to 'current'", () => {
    expect(
      sanitizeFilters({ ...defaultFilters, period: current }, data, current).period,
    ).toBe("current");
    expect(
      sanitizeFilters({ ...defaultFilters, period: "custom" }, data, current).period,
    ).toBe("custom");
  });
});

describe("Cloudflare formatting", () => {
  it("formats micro-units of money and never throws on a bad code", () => {
    expect(formatMoney(1_500_000, "USD")).toMatch(/\$1\.50/);
    expect(formatMoney(12_345_670_000)).toMatch(/\$12,345\.67/);
    expect(formatMoney(2_000_000, "bogus")).toBe("2 bogus");
    expect(formatMoney(2_500_000, "usd")).toBe("2.5 usd");
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("usd")).toBe(false);
    expect(isCurrency("US")).toBe(false);
  });

  it("formats durations by magnitude", () => {
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(1_908_000)).toBe("31.8 min");
    expect(formatDuration(1_907_280_000)).toBe("529.8 h");
  });

  it("formats usage by the collector's unit names", () => {
    expect(formatUsage(12 * 2 ** 30, "bytes")).toMatch(/^12(\.0)? GiB$/);
    expect(formatUsage(90_000_000, "microseconds")).toBe("1.5 min");
    expect(formatUsage(2500, "ms")).toBe("2.5 s");
    expect(formatUsage(120, "seconds")).toBe("2 min");
    expect(formatUsage(2 ** 30 * 3600 * 2, "byte-seconds")).toBe("2 GiB-hours");
    expect(formatUsage(1234.5, "requests")).toBe("1,234.5 requests");
  });

  it("reads generic billing quantities from the charge description", () => {
    expect(formatQuantity(5000, "Count", "Workers Standard CPU time")).toBe("5 s");
    expect(formatQuantity(1200, "Count", "Workers Standard requests")).toBe(
      "1,200 requests",
    );
    expect(formatQuantity(30, "Count", "D1 Rows Written")).toBe("30 rows");
    expect(formatQuantity(7, "", "Queue operations")).toBe("7 operations");
    expect(formatQuantity(0.4, "GB-month", "R2 Storage")).toBe("0.4 GB-month");
    expect(formatQuantity(3, "Count", "Something else")).toBe("3");
  });
});

describe("writeSearch", () => {
  afterEach(() => vi.unstubAllGlobals());
  function stub(search: string) {
    const history = { state: null, pushState: vi.fn(), replaceState: vi.fn() };
    vi.stubGlobal("location", { search });
    vi.stubGlobal("history", history);
    return history;
  }

  it("pushes page changes and replaces filter tweaks", () => {
    const pushed = stub("?view=overview");
    writeSearch("?view=issues", "push");
    expect(pushed.pushState).toHaveBeenCalledWith(null, "", "?view=issues");
    expect(pushed.replaceState).not.toHaveBeenCalled();
    const replaced = stub("?view=cloudflare");
    writeSearch("?view=cloudflare&cf_app=openfea", "replace");
    expect(replaced.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "?view=cloudflare&cf_app=openfea",
    );
    expect(replaced.pushState).not.toHaveBeenCalled();
  });

  it("leaves an unchanged URL alone", () => {
    const history = stub("?view=storage");
    writeSearch("?view=storage", "push");
    writeSearch("?view=storage", "replace");
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
