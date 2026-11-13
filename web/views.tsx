import { APPS, BUCKETS, type App, type Row } from "../src/contract";
import {
  ACTIVITY_MIN_COUNT,
  CELLS,
  EXPANDED,
  expandedMetric,
  PARTS,
  SIZES,
  TIMINGS,
  type ActivityField,
  type CensusRow,
} from "../src/expanded";
import {
  Columns,
  DataTable,
  Legend,
  LineChart,
  RankBars,
  Sparkline,
  StackBar,
  TableScroll,
  shortDay,
  sizeLabels,
  timingLabels,
  type Tone,
} from "./charts";
import {
  activityValue,
  appName,
  bucketCounts,
  bytes,
  censusHistory,
  dailyTotals,
  errorCodes,
  grouped,
  isErrorCode,
  number,
  percent,
  ratio,
  signed,
  total,
  type Loaded,
} from "./data";
import {
  capitalize,
  cellLabels,
  cloudStatusLabels,
  diagnosticHints,
  diagnosticLabels,
  label,
  operationLabels,
} from "./labels";
import { ReportInspector } from "./ReportInspector";
import { Panel, Tile } from "./ui";

const appTone: Record<App, Tone> = {
  openzcad: "accent",
  openfea: "fea",
  openlattice3d: "lattice",
};
const timingTones: Tone[] = ["accent", "tone-2", "tone-3", "warn", "error"];
const sizeTones: Tone[] = ["accent", "tone-2", "tone-3", "warn"];
const includes = (scope: string, app: App) => scope === "all" || scope === app;
/** "OpenZCAD only" or "OpenZCAD and OpenFEA only" when the app filter excludes every owner. */
const notApplicable = (scope: string, owners: App[]) =>
  owners.some((a) => includes(scope, a))
    ? undefined
    : `${owners.map(appName).join(" and ")} only`;
/**
 * Apps whose contract accepts an expanded event (src/expanded.ts), so N/A follows the
 * allowlist instead of a copy of it. OpenLattice3D has its own subset (ADR 0001).
 */
const owners = (event: string): App[] =>
  APPS.filter((a) =>
    (EXPANDED[event] ?? []).some((bucket) => expandedMetric(event, bucket, a)),
  );
/** One N/A line inside a panel, for a measure the app filter excludes. */
function NaRow({ title, na }: { title: string; na: string }) {
  return (
    <div className="panel-foot inline na-row">
      <span className="muted small">{title}</span>
      <span className="panel-meta">
        <strong className="na">N/A</strong> · {na}
      </span>
    </div>
  );
}

const OptIn = () => <span className="badge">Opted-in users</span>;

const activityRows: [ActivityField, string][] = [
  ["active7d", "Saved in the last 7 days"],
  ["active30d", "Saved in the last 30 days"],
  ["idle90d", "No save for 90 days or more"],
];
/**
 * Activity counts from the latest OpenZCAD snapshot. "Withheld" (k-threshold) and
 * "Not collected" (older OpenZCAD, or migration 0005 pending) stay distinct from "—".
 */
export function AccountActivity({ row, pending = false }: { row: CensusRow; pending?: boolean }) {
  return (
    <div className="panel-foot">
      <span className="muted small">
        Account activity · consenting accounts · snapshot{" "}
        <span className="nowrap">{row.day} UTC</span>
      </span>
      <ul className="category-grid activity-grid">
        {activityRows.map(([key, name]) => {
          const shown = activityValue(row, key);
          return (
            <li key={key}>
              <span className="muted small">{name}</span>
              {shown.state === "value" ? (
                <>
                  <span className="numeric big">{number(shown.value)}</span>
                  <span className="muted small">
                    {percent(shown.value, row.accounts)} of accounts
                  </span>
                </>
              ) : shown.state === "withheld" ? (
                <>
                  <span className="gap-value">
                    Withheld (fewer than {ACTIVITY_MIN_COUNT})
                  </span>
                  <span className="muted small">
                    Too few accounts in or outside this count
                  </span>
                </>
              ) : (
                <>
                  <span className="gap-value">Not collected</span>
                  <span className="muted small">
                    {pending
                      ? "Glimpse migration 0005 not applied"
                      : "Not sent by OpenZCAD for this snapshot"}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Overview({ data, app }: { data: Loaded; app: string }) {
  const rows = data.optional.rows,
    basic = data.basic.rows,
    history = censusHistory(data.optional.census),
    first = history[0],
    latest = history.at(-1),
    cloud = includes(app, "openzcad"),
    apps = APPS.filter((a) => includes(app, a));
  const census = (key: "accounts" | "projects" | "revisions") =>
    latest ? number(latest[key]) : cloud ? "—" : "N/A";
  const change = (key: "accounts" | "projects" | "revisions") =>
    latest && first && history.length > 1
      ? `${signed(latest[key] - first[key])} since ${shortDay(first.day)}`
      : cloud
        ? "No snapshot change in this range"
        : "OpenZCAD only";
  const operations = grouped(
    rows,
    (r) => r.event === "feature_operation" && r.app === "openzcad",
  ).map((r) => ({
    label: label(operationLabels, r.bucket),
    value: r.count,
    title: r.bucket,
  }));
  // Only categories an app in scope can send: OpenLattice3D has no edit, mesh or solve.
  const categoryBuckets = EXPANDED.feature_category!.filter((bucket) =>
      apps.some((a) => expandedMetric("feature_category", bucket, a)),
    ),
    missingCategories = EXPANDED.feature_category!.filter(
      (bucket) => !categoryBuckets.includes(bucket),
    );
  const categories = categoryBuckets.map((bucket) => ({
    bucket,
    value: total(
      rows.filter((r) => r.bucket === bucket),
      "feature_category",
    ),
  }));
  const categoryTotal = categories.reduce((n, c) => n + c.value, 0);
  const steps = ["model", "mesh", "setup", "run", "results"].map((step) => ({
    label: capitalize(step),
    value: total(rows, `workflow_${step}`, "openfea"),
    tone: "fea" as Tone,
  }));
  const backends = bucketCounts(
    rows,
    "solver_backend",
    EXPANDED.solver_backend!,
    "openfea",
  );
  const complexity = [
    {
      key: "part_count",
      title: "Parts per saved model",
      unit: "saves",
      labels: ["0 parts", "1", "2–10", "11–100", "101+"],
      values: bucketCounts(rows, "part_count", PARTS),
      tone: "accent" as Tone,
      empty: "No part counts in this range.",
    },
    {
      key: "lattice_cells",
      title: "Unit cells per generated lattice",
      unit: "lattices",
      labels: CELLS.map((bucket) => cellLabels[bucket]),
      values: bucketCounts(rows, "lattice_cells", CELLS),
      tone: "lattice" as Tone,
      // Accepted by Glimpse; OpenLattice3D sends cell counts only after its adapter ships.
      empty:
        "No lattice sizes in this range. OpenLattice3D sends them only after its analytics update.",
    },
  ]
    .map((c) => ({ ...c, na: notApplicable(app, owners(c.key)) }))
    // N/A rows follow the measures that apply, as collapsed panels do.
    .sort((a, b) => Number(!!a.na) - Number(!!b.na));
  const outputs: Record<App, [string, string][]> = {
    openzcad: [
      ["feature_used", "features used"],
      ["export_completed", "exports"],
    ],
    openfea: [
      ["solver_completed", "solver runs"],
      ["export_completed", "exports"],
    ],
    openlattice3d: [
      ["generation_completed", "lattices generated"],
      ["export_completed", "exports"],
    ],
  };
  return (
    <>
      <section className="section" aria-labelledby="people-heading">
        <h2 id="people-heading" className="section-title">
          People and accounts
        </h2>
        <div className="strip">
          <Tile label="Total users" value="Not collected" gap>
            Glimpse keeps no per-person data.
          </Tile>
          <Tile label="Opted-in cloud accounts" value={census("accounts")}>
            {change("accounts")}
          </Tile>
          <Tile label="Cloud projects" value={census("projects")}>
            {latest
              ? `${ratio(latest.projects, latest.accounts)} per account`
              : change("projects")}
          </Tile>
          <Tile label="Saved revisions" value={census("revisions")}>
            {latest
              ? `${ratio(latest.revisions, latest.projects)} per project`
              : change("revisions")}
          </Tile>
          <Tile
            label="Workspaces opened"
            value={number(total(rows, "workspace_opened"))}
          >
            Opted-in users
          </Tile>
        </div>
      </section>

      <div className="split">
        <Panel
          title="Cloud growth"
          note="Daily OpenZCAD snapshots"
          className="wide"
          na={notApplicable(app, ["openzcad"])}
        >
          {!latest || !first ? (
            <p className="empty">No snapshot received in this range.</p>
          ) : (
            <>
              <ul className="growth">
                {(
                  [
                    ["Accounts", "accounts", number],
                    ["Projects", "projects", number],
                    ["Revisions", "revisions", number],
                    ["Stored", "storedBytes", bytes],
                  ] as const
                ).map(([name, key, format]) => (
                  <li key={key}>
                    <span className="growth-name">{name}</span>
                    <Sparkline
                      label={`${name} trend`}
                      values={history.map((c) => c[key])}
                      format={format}
                    />
                    <span className="numeric growth-range">
                      {format(first[key])} → {format(latest[key])}
                    </span>
                    <span className="numeric growth-change">
                      {signed(latest[key] - first[key], format)}
                    </span>
                  </li>
                ))}
              </ul>
              <span className="muted small">
                {history.length} snapshot{history.length === 1 ? "" : "s"} ·{" "}
                {shortDay(first.day)} – {shortDay(latest.day)} · daily
                history on Storage
              </span>
              <AccountActivity
                row={latest}
                pending={(data.optional.pendingMigrations ?? []).includes(
                  "0005_census_activity.sql",
                )}
              />
            </>
          )}
        </Panel>
        <Panel title="Activity by app" note={<OptIn />} className="narrow">
          <ul className="app-activity">
            {apps.map((a) => (
              <li key={a}>
                <div className="app-row">
                  <span className="app-name">
                    <span className={`swatch ${a}`} />
                    {appName(a)}
                  </span>
                  <span className="muted">
                    <span className="numeric strong">
                      {number(total(rows, "workspace_opened", a))}
                    </span>{" "}
                    workspaces
                  </span>
                </div>
                <div className="app-outputs">
                  {outputs[a].map(([event, text]) => (
                    <span key={event}>
                      <span className="numeric big">
                        {number(total(rows, event, a))}
                      </span>{" "}
                      {text}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {apps.length > 1 && (
            <div className="panel-foot">
              <span className="muted small">
                Share of API requests · all users
              </span>
              <StackBar
                label="Share of API requests"
                segments={apps.map((a) => ({
                  name: appName(a),
                  value: total(basic, "api_request", a),
                  tone: appTone[a],
                }))}
              />
            </div>
          )}
        </Panel>
      </div>

      <section className="section" aria-labelledby="usage-heading">
        <div className="section-heading">
          <h2 id="usage-heading" className="section-title">
            How the apps are used
          </h2>
          <OptIn />
        </div>
        <div className="grid-2">
          <Panel
            level={3}
            title="Top CAD operations"
            note={`OpenZCAD · ${number(operations.length)} kinds seen`}
            na={notApplicable(app, ["openzcad"])}
          >
            <RankBars items={operations.slice(0, 8)} />
            {operations.length > 8 && (
              <details className="more">
                <summary>All {operations.length} operations</summary>
                <RankBars items={operations.slice(8)} />
              </details>
            )}
          </Panel>
          <Panel
            level={3}
            title="What people work on"
            note="Feature categories"
          >
            {categoryTotal ? (
              <ul className="category-grid">
                {categories.map((c) => (
                  <li key={c.bucket}>
                    <span className="muted small">{capitalize(c.bucket)}</span>
                    <span className="numeric big">{number(c.value)}</span>
                    <span className="muted small">
                      {percent(c.value, categoryTotal)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No feature categories in this range.</p>
            )}
            {missingCategories.length > 0 && (
              <p className="panel-note">
                {missingCategories.map(capitalize).join(", ")}: not sent by{" "}
                {appName(app)}.
              </p>
            )}
          </Panel>
          <Panel
            level={3}
            title="Simulation workflow"
            note="OpenFEA · independent step counts"
            na={notApplicable(app, ["openfea"])}
          >
            <Columns items={steps} tone="fea" />
            <div className="panel-foot">
              <span className="muted small">
                Solver backend ·{" "}
                {number(backends.reduce((n, v) => n + v, 0))} runs
              </span>
              <StackBar
                label="Solver backend"
                segments={[
                  { name: "CPU", value: backends[0] ?? 0, tone: "fea" },
                  { name: "WebGPU", value: backends[1] ?? 0, tone: "accent" },
                  { name: "Unknown", value: backends[2] ?? 0, tone: "tone-3" },
                ]}
              />
            </div>
          </Panel>
          <Panel
            level={3}
            title="Model complexity"
            note="Coarse ranges · share of observations"
          >
            {complexity.map((c, i) =>
              c.na ? (
                <NaRow key={c.key} title={c.title} na={c.na} />
              ) : (
                <div key={c.key} className={i ? "panel-foot" : "measure"}>
                  <div className="chart-title">
                    <span>{c.title}</span>
                    <span>
                      <span className="numeric">
                        {number(c.values.reduce((n, v) => n + v, 0))}
                      </span>{" "}
                      {c.unit}
                    </span>
                  </div>
                  <Columns
                    show="share"
                    tone={c.tone}
                    empty={c.empty}
                    items={c.labels.map((text, j) => ({
                      label: text,
                      value: c.values[j] ?? 0,
                    }))}
                  />
                </div>
              ),
            )}
          </Panel>
        </div>
      </section>
    </>
  );
}

// The fourth entry, when present, lists the apps that send the event.
const latencyRows: [string, "basic" | "optional", string, App[]?][] = [
  ["API requests", "basic", "api_latency"],
  ["Cloud saves", "optional", "save_latency", owners("save_latency")],
  ["Exports", "optional", "export_latency"],
  ["Meshing · OpenFEA", "optional", "mesh_latency", owners("mesh_latency")],
  ["Solving · OpenFEA", "optional", "solver_latency", owners("solver_latency")],
  ["In-app operations", "optional", "operation_latency"],
];
function rate(failed: number, completed: number) {
  return failed + completed
    ? `${percent(failed, failed + completed)} of ${number(failed + completed)} attempts`
    : "No attempts in this range";
}
function EventTable({ rows }: { rows: Row[] }) {
  const values = grouped(rows, () => true);
  return (
    <TableScroll label="All opt-in event buckets" className="wide">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>App</th>
            <th>Bucket</th>
            <th className="numeric">Count</th>
          </tr>
        </thead>
        <tbody>
          {values.length ? (
            values.map((r) => (
              <tr key={`${r.app}:${r.event}:${r.bucket}`}>
                <td>
                  <code>{r.event}</code>
                </td>
                <td>{appName(r.app)}</td>
                <td>{r.bucket}</td>
                <td className="numeric">{number(r.count)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="empty-cell" colSpan={4}>
                No events received in this range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </TableScroll>
  );
}
export function Issues({
  data,
  app,
  demo,
}: {
  data: Loaded;
  app: string;
  demo: boolean;
}) {
  const rows = data.optional.rows,
    basic = data.basic.rows,
    requests = total(basic, "api_request"),
    serverErrors = total(basic, "api_error"),
    codes = errorCodes(rows),
    codeTotal = codes.reduce((n, c) => n + c.count, 0),
    statuses = EXPANDED.cloud_status!.map((bucket) => ({
      label: label(cloudStatusLabels, bucket),
      value: bucketCounts(rows, "cloud_status", [bucket])[0] ?? 0,
    })),
    cloudFailures = statuses.reduce((n, s) => n + s.value, 0);
  const serverDaily = dailyTotals(data.basic, "api_error"),
    codeDaily = dailyTotals(data.optional, isErrorCode);
  const maxCode = Math.max(1, ...codes.map((c) => c.count));
  const timings = latencyRows
    .filter(([, , , only]) => !only || !notApplicable(app, only))
    .map(([name, level, event]) => {
      const values = bucketCounts(level === "basic" ? basic : rows, event, level === "basic" ? BUCKETS : TIMINGS);
      return {
        name,
        event,
        values,
        sum: values.reduce((n, v) => n + v, 0),
        slow: (values[3] ?? 0) + (values[4] ?? 0),
      };
    });
  return (
    <>
      <section className="strip" aria-label="Issue summary">
        <Tile label="Server errors (5xx)" value={number(serverErrors)}>
          {percent(serverErrors, requests, 2)} of requests · all users
        </Tile>
        <Tile label="App diagnostics" value={number(codeTotal)}>
          {APPS.filter((a) => includes(app, a))
            .map(
              (a) =>
                `${appName(a)} ${number(rows.reduce((n, r) => n + (isErrorCode(r) && r.app === a ? r.count : 0), 0))}`,
            )
            .join(" · ")}
        </Tile>
        <Tile label="Failed exports" value={number(total(rows, "export_failed"))}>
          {rate(total(rows, "export_failed"), total(rows, "export_completed"))}
        </Tile>
        <Tile
          label="Failed solver runs"
          value={includes(app, "openfea") ? number(total(rows, "solver_failed")) : "N/A"}
        >
          {includes(app, "openfea")
            ? `${rate(total(rows, "solver_failed"), total(rows, "solver_completed"))} · OpenFEA`
            : "OpenFEA only"}
        </Tile>
        <Tile
          label="Failed generations"
          value={includes(app, "openlattice3d") ? number(total(rows, "generation_failed")) : "N/A"}
        >
          {includes(app, "openlattice3d")
            ? `${rate(total(rows, "generation_failed"), total(rows, "generation_completed"))} · OpenLattice3D`
            : "OpenLattice3D only"}
        </Tile>
        <Tile
          label="Cloud request failures"
          value={includes(app, "openzcad") ? number(cloudFailures) : "N/A"}
        >
          OpenZCAD · by status below
        </Tile>
      </section>

      <Panel title="Issues per day">
        <div className="grid-2 charts">
          <div>
            <div className="chart-title">
              <span>Server errors · all users</span>
            </div>
            <LineChart
              label="Server errors per day"
              days={serverDaily.map((d) => d.day)}
              series={[
                {
                  name: "Server errors",
                  values: serverDaily.map((d) => d.value),
                  tone: "error",
                },
              ]}
              height={150}
              peak
            />
          </div>
          <div>
            <div className="chart-title">
              <span>App diagnostics · opted-in users</span>
            </div>
            <LineChart
              label="App diagnostics per day"
              days={codeDaily.map((d) => d.day)}
              series={[
                {
                  name: "Diagnostics",
                  values: codeDaily.map((d) => d.value),
                  tone: "warn",
                },
              ]}
              height={150}
              peak
            />
          </div>
        </div>
      </Panel>

      <div className="split">
        <Panel
          title="Diagnostic codes"
          note="Opted-in users · fixed codes, never error text"
          className="wide"
        >
          <TableScroll label="Diagnostic codes">
            <table>
              <thead>
                <tr>
                  <th>Where it failed</th>
                  <th>Apps</th>
                  <th className="numeric">Count</th>
                  <th className="share-col">Share</th>
                </tr>
              </thead>
              <tbody>
                {codes.length ? (
                  codes.map((c) => (
                    <tr key={c.event}>
                      <td title={c.event}>
                        {label(diagnosticLabels, c.event)}
                        {c.event in diagnosticHints && (
                          <span className="cell-hint">
                            {diagnosticHints[c.event as keyof typeof diagnosticHints]}
                          </span>
                        )}
                      </td>
                      <td className="muted">{c.apps.map(appName).join(" · ")}</td>
                      <td className="numeric">{number(c.count)}</td>
                      <td>
                        <span className="track">
                          <i style={{ width: `${(c.count / maxCode) * 100}%`, background: "var(--warn)" }} />
                        </span>
                        <span className="sr-only">{percent(c.count, codeTotal)}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      No diagnostic codes received in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
        <Panel
          title="Cloud request failures"
          note="OpenZCAD · by status"
          className="narrow"
          na={notApplicable(app, ["openzcad"])}
        >
          <RankBars
            tone="error"
            items={statuses}
            empty="No failed cloud requests in this range."
          />
        </Panel>
      </div>

      <Panel
        title="Slow operations"
        note={
          <Legend
            label="Timing ranges"
            items={timingLabels.map((name, i) => ({ name, tone: timingTones[i]! }))}
          />
        }
        className="slow"
      >
        <ul className="slow-list">
          {timings.map(({ name, event, values, sum, slow }) => (
            <li key={event}>
              <span>{name}</span>
              <StackBar
                legend={false}
                label={`${name} timing`}
                segments={values.map((value, i) => ({ name: timingLabels[i]!, value, tone: timingTones[i]! }))}
              />
              <span className="slow-share">
                <span className="numeric">{sum ? percent(slow, sum) : "—"}</span>{" "}
                <span className="muted small">≥10 s</span>
              </span>
            </li>
          ))}
        </ul>
        <DataTable label="Slow operations">
          <table>
            <thead>
              <tr>
                <th>Operation</th>
                {timingLabels.map((name) => (
                  <th key={name} className="numeric">
                    {name}
                  </th>
                ))}
                <th className="numeric">≥10 s share</th>
              </tr>
            </thead>
            <tbody>
              {timings.map(({ name, event, values, sum, slow }) => (
                <tr key={event}>
                  <td>{name}</td>
                  {values.map((value, i) => (
                    <td key={i} className="numeric">
                      {number(value)}
                    </td>
                  ))}
                  <td className="numeric">{sum ? percent(slow, sum) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
        <p className="panel-note">
          Counts are operations in coarse ranges. No exact timings or percentiles are inferred.
        </p>
      </Panel>

      <ReportInspector demo={demo} app={app} />

      <details className="panel more-panel">
        <summary>All opt-in event buckets</summary>
        <EventTable rows={rows} />
      </details>
    </>
  );
}

export function Storage({ data, app }: { data: Loaded; app: string }) {
  const rows = data.optional.rows,
    history = censusHistory(data.optional.census),
    first = history[0],
    latest = history.at(-1),
    cloud = includes(app, "openzcad");
  const sizes = latest
    ? [latest.lt1mib, latest.mib1to10, latest.mib10to100, latest.gte100mib]
    : [0, 0, 0, 0];
  const observed = (event: string) =>
    bucketCounts(rows, event, SIZES).map((value, i) => ({
      name: sizeLabels[i]!,
      value,
      tone: sizeTones[i]!,
    }));
  // Saved project sizes come from every app; transfers and cloud saves from OpenZCAD and OpenFEA.
  const transfersNa = notApplicable(app, owners("transfer_upload"));
  const observations = (
    [
      ["Saved projects", "project_size"],
      ["Uploads", "transfer_upload"],
      ["Downloads", "transfer_download"],
    ] as const
  )
    .filter(([, event]) => !notApplicable(app, owners(event)))
    .map(([name, event]) => {
    const segments = observed(event);
    return { name, event, segments, sum: segments.reduce((n, s) => n + s.value, 0) };
  });
  const saves = bucketCounts(rows, "save_latency", TIMINGS),
    saveTotal = saves.reduce((n, v) => n + v, 0);
  return (
    <>
      {cloud && latest ? (
        <section className="hero" aria-label="Storage summary">
          <div className="hero-figures">
            <div className="hero-main">
              <span className="muted">Stored in the cloud</span>
              <strong className="hero-value">{bytes(latest.storedBytes)}</strong>
              <span className="muted small">
                {first && history.length > 1
                  ? `${signed(latest.storedBytes - first.storedBytes, bytes)} since ${shortDay(first.day)} · snapshot `
                  : "Snapshot "}
                <span className="nowrap">{latest.day} UTC</span>
              </span>
            </div>
            <dl className="hero-stats">
              <div>
                <dt>Project data</dt>
                <dd>{bytes(latest.logicalBytes)}</dd>
              </div>
              <div>
                <dt>Storage overhead</dt>
                <dd>{percent(latest.storedBytes - latest.logicalBytes, latest.logicalBytes)}</dd>
              </div>
              <div>
                <dt>Per project</dt>
                <dd>{latest.projects ? bytes(Math.round(latest.storedBytes / latest.projects)) : "—"}</dd>
              </div>
              <div>
                <dt>Per account</dt>
                <dd>{latest.accounts ? bytes(Math.round(latest.storedBytes / latest.accounts)) : "—"}</dd>
              </div>
              <div>
                <dt>Revisions</dt>
                <dd>{number(latest.revisions)}</dd>
              </div>
              <div>
                <dt>Unknown-size artifacts</dt>
                <dd className={latest.unknownArtifacts ? "warn-text" : undefined}>
                  {number(latest.unknownArtifacts)}
                </dd>
              </div>
            </dl>
          </div>
          <div className="hero-chart">
            <div className="chart-title">
              <h2>Storage over time</h2>
              <Legend
                items={[
                  { name: "Stored", tone: "accent" },
                  { name: "Project data", tone: "fea", dashed: true },
                ]}
              />
            </div>
            <LineChart
              label="Stored and project data over time"
              days={history.map((c) => c.day)}
              series={[
                { name: "Stored", values: history.map((c) => c.storedBytes), tone: "accent" },
                { name: "Project data", values: history.map((c) => c.logicalBytes), tone: "fea", dashed: true },
              ]}
              format={bytes}
              unit={2 ** 30}
              area
              height={240}
            />
          </div>
        </section>
      ) : (
        <p className="notice">
          {cloud
            ? "No OpenZCAD cloud snapshot received in this range."
            : "Cloud storage snapshots exist for OpenZCAD only. Opt-in size observations below include the selected app."}
        </p>
      )}

      <div className="grid-2">
        <Panel
          title="Project sizes"
          note={latest ? `${number(latest.projects)} cloud projects · latest snapshot` : "Latest snapshot"}
          na={notApplicable(app, ["openzcad"])}
        >
          {latest ? (
            <Columns
              items={sizeLabels.map((text, i) => ({
                label: text,
                value: sizes[i] ?? 0,
                tone: i === 3 ? "warn" : "accent",
              }))}
            />
          ) : (
            <p className="empty">No snapshot received.</p>
          )}
          <p className="panel-note">
            Current document bytes per OpenZCAD project. External assets are excluded.
          </p>
        </Panel>
        <Panel title="Size observations" note={<OptIn />}>
          <Legend
            label="Size ranges"
            items={sizeLabels.map((name, i) => ({ name, tone: sizeTones[i]! }))}
          />
          <div className="stack-group">
            {observations.map(({ name, event, segments, sum }) => (
              <div key={event}>
                <div className="chart-title">
                  <span>{name}</span>
                  <span className="numeric">{number(sum)}</span>
                </div>
                <StackBar label={name} segments={segments} legend={false} />
              </div>
            ))}
          </div>
          <DataTable label="Size observations">
            <table>
              <thead>
                <tr>
                  <th>Operation</th>
                  {sizeLabels.map((name) => (
                    <th key={name} className="numeric">
                      {name}
                    </th>
                  ))}
                  <th className="numeric">Total</th>
                </tr>
              </thead>
              <tbody>
                {observations.map(({ name, event, segments, sum }) => (
                  <tr key={event}>
                    <td>{name}</td>
                    {segments.map((s) => (
                      <td key={s.name} className="numeric">
                        {number(s.value)}
                      </td>
                    ))}
                    <td className="numeric">{number(sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
          {transfersNa ? (
            <NaRow title="Uploads, downloads and cloud saves" na={transfersNa} />
          ) : (
            <div className="panel-foot inline">
              <span className="muted">Cloud saves under 1 s</span>
              <span className="numeric">
                {saveTotal ? percent((saves[0] ?? 0) + (saves[1] ?? 0), saveTotal) : "—"}
              </span>
            </div>
          )}
          <p className="panel-note">
            Ranges per operation, not bandwidth. Repeated saves count again.
          </p>
        </Panel>
      </div>

      <Panel
        title="Snapshot history"
        note="Daily · latest first"
        na={notApplicable(app, ["openzcad"])}
      >
        <TableScroll label="Snapshot history" className="tall wide">
          <table>
            <thead>
              <tr>
                <th>UTC day</th>
                <th className="numeric">Accounts</th>
                <th className="numeric">Projects</th>
                <th className="numeric">Revisions</th>
                <th className="numeric">Project data</th>
                <th className="numeric">Stored</th>
              </tr>
            </thead>
            <tbody>
              {history.length ? (
                [...history].reverse().map((c) => (
                  <tr key={c.day}>
                    <td className="nowrap">{c.day}</td>
                    <td className="numeric">{number(c.accounts)}</td>
                    <td className="numeric">{number(c.projects)}</td>
                    <td className="numeric">{number(c.revisions)}</td>
                    <td className="numeric">{bytes(c.logicalBytes)}</td>
                    <td className="numeric">{bytes(c.storedBytes)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No cloud snapshots. Only OpenZCAD has an account census.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
        <p className="panel-note">
          Consenting accounts only. Owned projects including trash; stored R2 metadata plus D1
          documents without R2 pointers. Excludes database overhead and backups. Not billable disk
          usage.
        </p>
      </Panel>
    </>
  );
}
