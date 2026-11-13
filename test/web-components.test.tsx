// @vitest-environment node
// Render paths of shared dashboard components, checked as static HTML so no
// DOM library is needed.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineChart, shortDay } from "../web/charts";
import { Panel, Tile } from "../web/ui";
import { CoverageTable } from "../web/cloudflare/tables";
import { AccountActivity, Issues, Overview, Storage } from "../web/views";
import { demoStats } from "../web/demo-data";
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

describe("AccountActivity", () => {
  const row = {
    day: "2026-11-12",
    app: "openzcad",
    generation: 9,
    accounts: 80,
    projects: 0,
    revisions: 0,
    storedBytes: 0,
    logicalBytes: 0,
    unknownArtifacts: 0,
    lt1mib: 0,
    mib1to10: 0,
    mib10to100: 0,
    gte100mib: 0,
  } as const;

  it("shows counts with their share, and withheld counts as withheld", () => {
    const out = html(
      <AccountActivity row={{ ...row, active7d: 20, active30d: 44, idle90d: null }} />,
    );
    expect(out).toContain("Saved in the last 7 days");
    expect(out).toContain('<span class="numeric big">20</span>');
    expect(out).toContain("25.0% of accounts");
    expect(out).toContain('<span class="gap-value">Withheld (fewer than 5)</span>');
    expect(out).not.toContain("Not collected");
    expect(out).not.toContain("—");
  });

  it("never shows a small stored value, even if one reaches the browser", () => {
    const out = html(
      <AccountActivity row={{ ...row, active7d: 3, active30d: 77, idle90d: 0 }} />,
    );
    expect(out.match(/Withheld \(fewer than 5\)/g)).toHaveLength(3);
    expect(out).not.toContain('<span class="numeric big">');
  });

  it("marks fields absent from the snapshot as not collected, naming a pending migration", () => {
    expect(html(<AccountActivity row={row} />).match(/Not collected/g)).toHaveLength(3);
    expect(html(<AccountActivity row={row} />)).toContain("Not sent by OpenZCAD");
    expect(html(<AccountActivity row={row} pending />)).toContain(
      "Glimpse migration 0005 not applied",
    );
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

// ADR 0001 Option B: OpenLattice3D's subset renders where it applies; the rest stays N/A.
describe("OpenLattice3D panels", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const load = (app: string) => {
    const range = { app, from: "2026-11-01", to: "2026-11-13" };
    return {
      basic: demoStats({ ...range, level: "basic" }, now),
      optional: demoStats({ ...range, level: "optional" }, now),
    };
  };
  /** Titles of panels collapsed to an N/A row. */
  const naPanels = (out: string) =>
    [
      ...out.matchAll(
        /class="panel panel-na[^"]*"><div class="panel-heading"><h[23]>([^<]+)</g,
      ),
    ].map((m) => m[1]);
  /** N/A rows inside a panel, as "title: owners". */
  const naRows = (out: string) =>
    [
      ...out.matchAll(
        /class="panel-foot inline na-row"><span class="muted small">([^<]+)<\/span><span class="panel-meta"><strong class="na">N\/A<\/strong> · ([^<]+)</g,
      ),
    ].map((m) => `${m[1]}: ${m[2]}`);

  it("shows feature categories and lattice cell counts for OpenLattice3D", () => {
    const out = html(<Overview data={load("openlattice3d")} app="openlattice3d" />);
    expect(naPanels(out)).toEqual(["Cloud growth", "Top CAD operations", "Simulation workflow"]);
    expect(naRows(out)).toEqual(["Parts per saved model: OpenZCAD and OpenFEA only"]);
    expect(out).toContain("Unit cells per generated lattice");
    expect(out).toContain("≥100k");
    expect(out).toContain("Edit, Mesh, Solve: not sent by OpenLattice3D.");
  });
  it("shows the lattice cell count as an N/A row for the other apps", () => {
    for (const app of ["openzcad", "openfea"]) {
      const out = html(<Overview data={load(app)} app={app} />);
      expect(naRows(out)).toEqual(["Unit cells per generated lattice: OpenLattice3D only"]);
      expect(out).not.toContain("not sent by");
    }
    const all = html(<Overview data={load("all")} app="all" />);
    expect(naRows(all)).toEqual([]);
    expect(all).toContain("Unit cells per generated lattice");
    expect(all).toContain("Parts per saved model");
  });
  it("lists OpenLattice3D diagnostics and export timing on Issues, not cloud or solver rows", () => {
    const out = html(<Issues data={load("openlattice3d")} app="openlattice3d" demo />);
    expect(naPanels(out)).toEqual(["Cloud request failures"]);
    expect(out).toMatch(/OpenLattice3D \d/);
    expect(out).toContain("Out of memory");
    expect(out).not.toContain(">Mesh<");
    expect(out).toContain("<span>Exports</span>");
    for (const row of ["Cloud saves", "Meshing · OpenFEA", "Solving · OpenFEA"])
      expect(out).not.toContain(`<span>${row}</span>`);
  });
  it("shows OpenLattice3D saved project sizes on Storage, with transfers N/A", () => {
    const out = html(<Storage data={load("openlattice3d")} app="openlattice3d" />);
    expect(naPanels(out)).toEqual(["Project sizes", "Snapshot history"]);
    expect(naRows(out)).toEqual([
      "Uploads, downloads and cloud saves: OpenZCAD and OpenFEA only",
    ]);
    expect(out).toContain("<span>Saved projects</span>");
    expect(out).not.toContain("<span>Uploads</span>");
  });
});
