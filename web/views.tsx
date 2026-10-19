import type { ReactNode } from "react";
import { APPS, BUCKETS, type App, type Row } from "../src/contract";
import { EXPANDED, PARTS, SIZES, TIMINGS } from "../src/expanded";
import {
  Columns,
  LineChart,
  RankBars,
  Sparkline,
  StackBar,
  sizeLabels,
  timingLabels,
  type Tone,
} from "./charts";
import {
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
  total,
  type Loaded,
} from "./data";
import {
  capitalize,
  cloudStatusLabels,
  diagnosticLabels,
  label,
  operationLabels,
} from "./labels";
import { ReportInspector } from "./ReportInspector";

const appTone: Record<App, Tone> = {
  openzcad: "accent",
  openfea: "fea",
  openlattice3d: "lattice",
};
const timingTones: Tone[] = ["accent", "tone-2", "tone-3", "warn", "error"];
const sizeTones: Tone[] = ["accent", "tone-2", "tone-3", "warn"];
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const signed = (n: number) => `${n < 0 ? "−" : "+"}${number(Math.abs(n))}`;
const includes = (scope: string, app: App) => scope === "all" || scope === app;
const ratio = (a: number, b: number) =>
  b ? (a / b).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—";

function Tile({
  label,
  value,
  children,
  gap = false,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  gap?: boolean;
}) {
  return (
    <div className={gap ? "tile tile-gap" : "tile"}>
      <span className="tile-label">{label}</span>
      <strong className="tile-value">{value}</strong>
      {children && <span className="tile-note">{children}</span>}
    </div>
  );
}
function Panel({
  title,
  note,
  children,
  className = "",
  level = 2,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <Heading>{title}</Heading>
        {note && <span className="panel-meta">{note}</span>}
      </div>
      {children}
    </section>
  );
}
const OptIn = () => <span className="badge">Opted-in users</span>;

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
  const categories = EXPANDED.feature_category!.map((bucket) => ({
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
  const parts = bucketCounts(rows, "part_count", PARTS);
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
          <Tile label="Total users" value="—" gap>
            Not collected. Glimpse keeps no per-person data.
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
        >
          {!cloud ? (
            <p className="empty">Cloud snapshots exist for OpenZCAD only.</p>
          ) : !latest || !first ? (
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
                      label={`${name} per day`}
                      values={history.map((c) => c[key])}
                    />
                    <span className="numeric growth-range">
                      {format(first[key])} → {format(latest[key])}
                    </span>
                    <span className="numeric growth-change">
                      {key === "storedBytes"
                        ? `${latest[key] >= first[key] ? "+" : "−"}${bytes(Math.abs(latest[key] - first[key]))}`
                        : signed(latest[key] - first[key])}
                    </span>
                  </li>
                ))}
              </ul>
              <span className="muted small">
                {history.length} snapshot{history.length === 1 ? "" : "s"} ·{" "}
                {shortDay(first.day)} – {shortDay(latest.day)} · daily
                history on Storage
              </span>
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
          >
            {includes(app, "openzcad") ? (
              <>
                <RankBars items={operations.slice(0, 8)} />
                {operations.length > 8 && (
                  <details className="more">
                    <summary>All {operations.length} operations</summary>
                    <RankBars items={operations.slice(8)} />
                  </details>
                )}
              </>
            ) : (
              <p className="empty">CAD operations exist for OpenZCAD only.</p>
            )}
          </Panel>
          <Panel
            level={3}
            title="What people work on"
            note="Feature categories · OpenZCAD and OpenFEA"
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
          </Panel>
          <Panel
            level={3}
            title="Simulation workflow"
            note="OpenFEA · independent step counts"
          >
            {includes(app, "openfea") ? (
              <>
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
              </>
            ) : (
              <p className="empty">Simulation steps exist for OpenFEA only.</p>
            )}
          </Panel>
          <Panel
            level={3}
            title="Model complexity"
            note={`Parts per saved model · ${number(parts.reduce((n, v) => n + v, 0))} saves`}
          >
            <Columns
              show="share"
              items={["0 parts", "1", "2–10", "11–100", "101+"].map(
                (text, i) => ({ label: text, value: parts[i] ?? 0 }),
              )}
            />
          </Panel>
        </div>
      </section>
    </>
  );
}

const latencyRows: [string, "basic" | "optional", string, App?][] = [
  ["API requests", "basic", "api_latency"],
  ["Cloud saves", "optional", "save_latency"],
  ["Exports", "optional", "export_latency"],
  ["Meshing · OpenFEA", "optional", "mesh_latency", "openfea"],
  ["Solving · OpenFEA", "optional", "solver_latency", "openfea"],
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
    <div className="table-scroll" role="region" aria-label="All opt-in event buckets" tabIndex={0}>
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
    </div>
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
  return (
    <>
      <section className="strip" aria-label="Issue summary">
        <Tile label="Server errors (5xx)" value={number(serverErrors)}>
          {percent(serverErrors, requests, 2)} of requests · all users
        </Tile>
        <Tile label="App diagnostics" value={number(codeTotal)}>
          {APPS.filter((a) => includes(app, a) && a !== "openlattice3d")
            .map(
              (a) =>
                `${appName(a)} ${number(rows.reduce((n, r) => n + (isErrorCode(r) && r.app === a ? r.count : 0), 0))}`,
            )
            .join(" · ") || "OpenZCAD and OpenFEA only"}
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
          <div className="table-scroll" role="region" aria-label="Diagnostic codes" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Where it failed</th>
                  <th>Apps</th>
                  <th className="share-col">Share</th>
                  <th className="numeric">Count</th>
                </tr>
              </thead>
              <tbody>
                {codes.length ? (
                  codes.map((c) => (
                    <tr key={c.event}>
                      <td title={c.event}>{label(diagnosticLabels, c.event)}</td>
                      <td className="muted">{c.apps.map(appName).join(" · ")}</td>
                      <td>
                        <span className="track">
                          <i style={{ width: `${(c.count / maxCode) * 100}%`, background: "var(--warn)" }} />
                        </span>
                      </td>
                      <td className="numeric">{number(c.count)}</td>
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
          </div>
        </Panel>
        <Panel title="Cloud request failures" note="OpenZCAD · by status" className="narrow">
          {includes(app, "openzcad") ? (
            <RankBars
              tone="error"
              items={statuses}
              empty="No failed cloud requests in this range."
            />
          ) : (
            <p className="empty">Cloud status exists for OpenZCAD only.</p>
          )}
        </Panel>
      </div>

      <Panel
        title="Slow operations"
        note={
          <ul className="legend" aria-hidden="true">
            {timingLabels.map((name, i) => (
              <li key={name}>
                <span className="swatch" style={{ background: `var(--${timingTones[i]})` }} />
                {name}
              </li>
            ))}
          </ul>
        }
        className="slow"
      >
        <ul className="slow-list">
          {latencyRows.map(([name, level, event, only]) => {
            const values = bucketCounts(level === "basic" ? basic : rows, event, level === "basic" ? BUCKETS : TIMINGS),
              sum = values.reduce((n, v) => n + v, 0),
              slow = (values[3] ?? 0) + (values[4] ?? 0);
            if (only && !includes(app, only)) return null;
            return (
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
            );
          })}
        </ul>
        <p className="panel-note">
          Counts are operations in coarse ranges. No exact timings or percentiles are inferred.
        </p>
      </Panel>

      <ReportInspector demo={demo} />

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
                  ? `${latest.storedBytes >= first.storedBytes ? "+" : "−"}${bytes(Math.abs(latest.storedBytes - first.storedBytes))} since ${shortDay(first.day)} · snapshot ${latest.day} UTC`
                  : `Snapshot ${latest.day} UTC`}
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
              <ul className="legend" aria-hidden="true">
                <li><span className="swatch" style={{ background: "var(--accent)" }} />Stored</li>
                <li><span className="swatch dashed" style={{ background: "var(--fea)" }} />Project data</li>
              </ul>
            </div>
            <LineChart
              label="Stored bytes and project data"
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
          <div className="stack-group">
            {(
              [
                ["Saved projects", "project_size"],
                ["Uploads", "transfer_upload"],
                ["Downloads", "transfer_download"],
              ] as const
            ).map(([name, event]) => {
              const segments = observed(event);
              return (
                <div key={event}>
                  <div className="chart-title">
                    <span>{name}</span>
                    <span className="numeric">{number(segments.reduce((n, s) => n + s.value, 0))}</span>
                  </div>
                  <StackBar label={name} segments={segments} legend={event === "transfer_download"} />
                </div>
              );
            })}
          </div>
          <div className="panel-foot inline">
            <span className="muted">Cloud saves under 1 s</span>
            <span className="numeric">
              {saveTotal ? percent((saves[0] ?? 0) + (saves[1] ?? 0), saveTotal) : "—"}
            </span>
          </div>
          <p className="panel-note">
            Ranges per operation, not bandwidth. Repeated saves count again.
          </p>
        </Panel>
      </div>

      <Panel title="Snapshot history" note="Daily · latest first">
        <div className="table-scroll tall" role="region" aria-label="Snapshot history" tabIndex={0}>
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
                    <td>{c.day}</td>
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
        </div>
        <p className="panel-note">
          Consenting accounts only. Owned projects including trash; stored R2 metadata plus D1
          documents without R2 pointers. Excludes database overhead and backups. Not billable disk
          usage.
        </p>
      </Panel>
    </>
  );
}
