// @vitest-environment node
// Render paths of shared dashboard components, checked as static HTML so no
// DOM library is needed.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineChart, shortDay } from "../web/charts";
import { Panel, Tile } from "../web/ui";
import { CoverageTable } from "../web/cloudflare/tables";
import { RETENTION_SOURCE } from "../src/cloudflare/model";

const html = (node: ReactElement) => renderToStaticMarkup(node);

describe("Tile", () => {
  it("renders label, value and note", () => {
    const out = html(
      <Tile label="Saved revisions" value="1,204">
        3.1 per project
      </Tile>,
    );
    expect(out).toBe(
      '<div class="tile"><span class="tile-label">Saved revisions</span>' +
        '<strong class="tile-value">1,204</strong>' +
        '<span class="tile-note">3.1 per project</span></div>',
    );
  });

  it("marks figures that are deliberately not collected", () => {
    const out = html(
      <Tile label="Total users" value="Not collected" gap>
        Glimpse keeps no per-person data.
      </Tile>,
    );
    expect(out).toContain('class="tile tile-gap"');
    expect(out).toContain('<strong class="tile-value">Not collected</strong>');
    expect(out).toContain("Glimpse keeps no per-person data.");
  });

  it("omits the note when there is none", () => {
    const out = html(<Tile label="Projected metered cost" value="—" />);
    expect(out).not.toContain("tile-note");
    expect(out).toContain('class="tile"');
  });
});

describe("Panel", () => {
  it("shows its note and content", () => {
    const out = html(
      <Panel title="Cloud growth" note="Opted-in accounts">
        <p>chart</p>
      </Panel>,
    );
    expect(out).toContain('<section class="panel ">');
    expect(out).toContain("<h2>Cloud growth</h2>");
    expect(out).toContain('<span class="panel-meta">Opted-in accounts</span>');
    expect(out).toContain("<p>chart</p>");
  });

  it("collapses to a single N/A row when the app filter excludes its owner", () => {
    const out = html(
      <Panel title="CAD operations" level={3} className="wide" na="OpenZCAD only">
        <p>chart</p>
      </Panel>,
    );
    expect(out).toContain('class="panel panel-na wide"');
    expect(out).toContain("<h3>CAD operations</h3>");
    expect(out).toContain('<strong class="na">N/A</strong> · OpenZCAD only');
    expect(out).not.toContain("chart");
  });
});

describe("LineChart", () => {
  it("draws no line for a single UTC day and says so in text", () => {
    const out = html(
      <LineChart
        label="Requests"
        days={["2026-11-05"]}
        series={[{ name: "Requests", values: [42], tone: "accent" }]}
        peak
      />,
    );
    expect(out).toContain('class="chart-single"');
    expect(out).toContain(`Single day · ${shortDay("2026-11-05")} · Requests 42`);
    expect(out).toContain('class="point"');
    expect(out).not.toContain('class="series');
    expect(out).not.toContain('class="x-labels"');
    expect(out).not.toContain('class="peak');
    expect(out).toContain('aria-label="Requests. Requests 42. Exact values');
  });

  it("labels the peak of the first series", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
    const out = html(
      <LineChart
        label="Requests"
        days={days}
        series={[
          { name: "Requests", values: [3, 18, 7, 4], tone: "accent" },
          { name: "Errors", values: [50, 0, 0, 0], tone: "error" },
        ]}
        peak
      />,
    );
    expect(out).toContain(`Peak · ${shortDay("2026-11-02")} · 18`);
    expect(out).toContain('class="peak start"');
    expect(out).toContain('class="x-labels"');
    expect(out).not.toContain("chart-single");
    expect(out).toContain('aria-label="Requests. Requests from 3 to 4; Errors from 50 to 0.');
  });

  it("omits the peak label when every value is zero", () => {
    const out = html(
      <LineChart
        label="Requests"
        days={["2026-11-01", "2026-11-02"]}
        series={[{ name: "Requests", values: [0, 0], tone: "accent" }]}
        peak
      />,
    );
    expect(out).not.toContain("Peak ·");
    expect(out).toContain("No data in this range.");
  });
});

describe("CoverageTable", () => {
  it("renders the analytics retention heartbeat as a row", () => {
    const out = html(
      <CoverageTable
        coverage={[
          {
            source: RETENTION_SOURCE,
            status: "ok",
            message: "Deleted 3 expired daily rows.",
            checkedAt: "2026-11-12T03:10:00.000Z",
            lastSuccess: "2026-11-12T03:10:00.000Z",
          },
          {
            source: "Billing",
            status: "unavailable",
            message: "Token lacks billing read.",
            checkedAt: "2026-11-12T03:10:00.000Z",
            lastSuccess: null,
          },
        ]}
      />,
    );
    expect(RETENTION_SOURCE).toBe("Analytics retention");
    expect(out).toContain("Analytics retention");
    expect(out).toContain("Deleted 3 expired daily rows.");
    expect(out).toMatch(/Nov 12, 2026,? 03:10/);
    // A failing source is highlighted and shows it never succeeded.
    expect(out).toContain("Never");
    expect(out).toMatch(
      /<td role="cell" class="warn-text">(?:(?!<\/td>).)*>unavailable</,
    );
    // A healthy heartbeat is not highlighted.
    expect(out).toMatch(/>Analytics retention<\/div><\/td><td role="cell"><span/);
  });
});
