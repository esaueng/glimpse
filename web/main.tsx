import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { dateRange, type App, type Row } from "../src/contract";
import { PARTS, SIZES } from "../src/expanded";
import { Activity, Histogram, Timing, sizeLabels } from "./charts";
import {
  appName,
  bytes,
  diagnosticCount,
  grouped,
  latestCensus,
  number,
  total,
  type Range,
  type Stats,
} from "./data";
import { ReportInspector } from "./ReportInspector";
import { useCompact } from "./useCompact";
import "./style.css";
const views = ["Overview", "Storage", "Diagnostics", "Privacy"] as const;
type View = (typeof views)[number];
const today = () => new Date().toISOString().slice(0, 10);
function readLocation(): { range: Range; view: View } {
  const query = new URLSearchParams(location.search),
    view = query.get("view");
  query.delete("view");
  if (!query.has("level")) query.set("level", "optional");
  const parsed = dateRange(query);
  return {
    range: parsed
      ? {
          app: parsed.app,
          level: parsed.level,
          from: parsed.from,
          to: parsed.to,
        }
      : {
          app: "all",
          level: "optional",
          from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
          to: today(),
        },
    view: views.find((v) => v.toLowerCase() === view) ?? "Overview",
  };
}
function Codes({ rows, limit }: { rows: Row[]; limit?: number }) {
  const values = grouped(rows, (r) => r.event.startsWith("error_")).slice(
    0,
    limit,
  );
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Diagnostic codes"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>App</th>
            <th>Count</th>
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
                <td className="numeric diagnostic-value">{number(r.count)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="empty-cell">
                No diagnostic codes received in this range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function EventTable({ rows }: { rows: Row[] }) {
  const values = grouped(rows, () => true);
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="All aggregate events"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>App</th>
            <th>Bucket</th>
            <th>Count</th>
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
function Dashboard() {
  const compact = useCompact();
  const [filtersOpen, setFiltersOpen] = useState(!compact);
  useEffect(() => setFiltersOpen(!compact), [compact]);
  const [initial] = useState(readLocation),
    [view, setView] = useState<View>(initial.view),
    [draft, setDraft] = useState(initial.range),
    [filter, setFilter] = useState(initial.range);
  const [data, setData] = useState<Stats | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const sequence = useRef(0);
  function apply(range: Range, nextView = view, push = true) {
    setDraft(range);
    setFilter({ ...range });
    setView(nextView);
    if (push)
      history.pushState(
        null,
        "",
        `?${new URLSearchParams({ ...range, view: nextView.toLowerCase() })}`,
      );
  }
  useEffect(() => {
    const restore = () => {
      const next = readLocation();
      apply(next.range, next.view, false);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    const current = ++sequence.current,
      controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/stats?${new URLSearchParams(filter)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? "Sign in through Cloudflare Access."
              : response.status === 400
                ? "Choose a valid UTC range of at most 90 days."
                : "Analytics unavailable. Try Refresh.",
          );
        if (
          !(response.headers.get("Content-Type") ?? "").includes(
            "application/json",
          )
        )
          throw new Error("Protected analytics API unavailable.");
        const result = (await response.json()) as Stats;
        if (current === sequence.current) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted && current === sequence.current)
          setError(e instanceof Error ? e.message : "Analytics unavailable.");
      })
      .finally(() => {
        if (current === sequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [filter]);
  const applied = data?.range ?? filter,
    optional = applied.level === "optional",
    rows = data?.rows ?? [],
    snapshot = latestCensus(data?.census ?? []);
  const activity = optional ? "workspace_opened" : "api_request",
    errors = optional ? diagnosticCount(rows) : total(rows, "api_error");
  const value = (n: number) => (data ? number(n) : "—");
  const cloudValues = snapshot
    ? [
        snapshot.lt1mib,
        snapshot.mib1to10,
        snapshot.mib10to100,
        snapshot.gte100mib,
      ]
    : [0, 0, 0, 0];
  const metrics = optional
    ? [
        [
          "Opted-in cloud accounts",
          snapshot
            ? number(snapshot.accounts)
            : applied.app === "openfea"
              ? "N/A"
              : "—",
        ],
        [
          "Cloud projects",
          snapshot
            ? number(snapshot.projects)
            : applied.app === "openfea"
              ? "N/A"
              : "—",
        ],
        [
          "Stored cloud data",
          snapshot
            ? bytes(snapshot.storedBytes)
            : applied.app === "openfea"
              ? "N/A"
              : "—",
        ],
        ["Diagnostic events", value(errors)],
      ]
    : [
        ["API requests", value(total(rows, "api_request"))],
        ["Server errors", value(errors)],
        ["Completed exports", "Opt-in only"],
        ["Solver runs", "Opt-in only"],
      ];
  const scopes = optional
    ? `Opted-in users only. No unique visitor tracking. ${applied.app === "openfea" ? "OpenFEA has no cloud account or project inventory." : snapshot ? `OpenZCAD cloud snapshot: ${snapshot.day} UTC.` : "No cloud snapshot received in this range."} Diagnostic counts are events.`
    : "Basic activity · backend requests, server errors and response times. Expanded local and cloud statistics require opt-in.";
  return (
    <>
      <header className="topbar">
        <a
          href="?"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            apply(filter, "Overview");
          }}
        >
          <span aria-hidden="true">G</span>Glimpse
        </a>
        <nav aria-label="Main navigation">
          {views.map((v) => (
            <button
              key={v}
              aria-current={view === v ? "page" : undefined}
              onClick={() =>
                apply(
                  {
                    ...filter,
                    level:
                      v === "Storage" || v === "Diagnostics"
                        ? "optional"
                        : filter.level,
                  },
                  v,
                )
              }
            >
              {v}
            </button>
          ))}
        </nav>
        <div className="access-label">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="1" />
            <path d="M5 7V4a3 3 0 0 1 6 0v3" />
          </svg>{" "}
          Cloudflare Access <span className="access-owner">Only you</span>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <h1>{view}</h1>
            <p>
              {view === "Overview"
                ? "Activity, capacity, and reliability."
                : view === "Storage"
                  ? "Consenting accounts and project capacity."
                  : view === "Diagnostics"
                    ? "Fixed diagnostic codes and operation distributions."
                    : "Collection boundaries and consent."}
            </p>
          </div>
          <div className="refresh">
            <button disabled={loading} onClick={() => setFilter({ ...filter })}>
              <span aria-hidden="true">↻</span> Refresh
            </button>
            <span>
              {data
                ? `Updated ${new Date(data.receivedAt).toISOString().slice(11, 19)} UTC`
                : "Awaiting data"}
            </span>
          </div>
        </div>
        <details
          className="filter-disclosure"
          open={filtersOpen}
          onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
        >
          <summary>
            Filters · {appName(filter.app)} ·{" "}
            {filter.level === "optional"
              ? "Opt-in analytics"
              : "Basic activity"}
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply(draft);
            }}
          >
            <label>
              App
              <select
                value={draft.app}
                onChange={(e) => setDraft({ ...draft, app: e.target.value })}
              >
                <option value="all">All apps</option>
                <option value="openzcad">OpenZCAD</option>
                <option value="openfea">OpenFEA</option>
              </select>
            </label>
            <label>
              Collection
              <select
                value={draft.level}
                onChange={(e) => setDraft({ ...draft, level: e.target.value })}
              >
                <option value="basic">Basic activity</option>
                <option value="optional">Opt-in analytics</option>
              </select>
            </label>
            <label>
              From (UTC)
              <input
                required
                type="date"
                value={draft.from}
                max={draft.to}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </label>
            <label>
              To (UTC)
              <input
                required
                type="date"
                value={draft.to}
                min={draft.from}
                max={today()}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </label>
            <button className="primary" disabled={loading}>
              Apply
            </button>
          </form>
        </details>
        <p className="scope-notice">{scopes} Applied: {appName(applied.app)} · {applied.from} to {applied.to} UTC.</p>
        <div
          className={`load-status ${error ? "error-message" : !loading ? "quiet" : ""}`}
          role="status"
          aria-live="polite"
        >
          {loading
            ? "Loading aggregates…"
            : error
              ? `${error}${data ? " Showing stale results for the last successful scope." : ""}`
              : `${appName(applied.app)} · ${applied.from} to ${applied.to} UTC`}
        </div>
        {view !== "Privacy" && (
          <section className="metric-strip" aria-label="Summary metrics">
            {metrics.map(([label, n]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </section>
        )}
        {view === "Overview" && (
          <>
            <div className="overview-grid">
              <div>
                {data ? (
                  <Activity data={data} event={activity} />
                ) : (
                  <section className="panel">
                    <h2>Daily activity</h2>
                    <p className="empty-cell">
                      {loading ? "Loading activity…" : "No data loaded."}
                    </p>
                  </section>
                )}
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Application totals</h2>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>App</th>
                      <th>Activity</th>
                      <th>Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["openzcad", "openfea"] as App[])
                      .filter((a) => applied.app === "all" || applied.app === a)
                      .map((a) => (
                        <tr key={a}>
                          <td>{appName(a)}</td>
                          <td className="numeric">
                            {value(total(rows, activity, a))}
                          </td>
                          <td className="numeric diagnostic-value">
                            {value(
                              optional
                                ? diagnosticCount(rows, a)
                                : total(rows, "api_error", a),
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="panel-note">
                  {optional
                    ? "Workspace opens and diagnostic signals. Repeated activity is counted repeatedly."
                    : "Backend API requests and HTTP 5xx outcomes."}
                </p>
                <p className="panel-note">
                  OpenFEA cloud accounts: not supported.
                </p>
              </section>
            </div>
            <div className="equal-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    Cloud document size <small>latest snapshot</small>
                  </h2>
                </div>
                {optional && snapshot ? (
                  <Histogram labels={sizeLabels} values={cloudValues} />
                ) : (
                  <p className="empty-cell">
                    {optional
                      ? "No opted-in OpenZCAD snapshot received."
                      : "Choose Opt-in analytics for cloud statistics."}
                  </p>
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    Diagnostics <small>top codes</small>
                  </h2>
                </div>
                {optional ? (
                  <Codes rows={rows} limit={5} />
                ) : (
                  <p className="empty-cell">
                    Diagnostic codes require opt-in analytics.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
        {view === "Storage" && !optional && (
          <p className="scope-notice">
            Choose Opt-in analytics to view expanded storage statistics.
          </p>
        )}
        {view === "Storage" && optional && (
          <>
            <div className="equal-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>Cloud document size</h2>
                </div>
                {snapshot ? (
                  <Histogram labels={sizeLabels} values={cloudValues} />
                ) : (
                  <p className="empty-cell">
                    No snapshot received in this range.
                  </p>
                )}
                <p className="panel-note">
                  OpenZCAD current document bytes only; external assets are
                  excluded from this distribution.
                </p>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Cloud storage accounting</h2>
                </div>
                <dl className="accounting">
                  <dt>Stored bytes</dt>
                  <dd>
                    {snapshot
                      ? bytes(snapshot.storedBytes)
                      : applied.app === "openfea"
                        ? "N/A"
                        : "—"}
                  </dd>
                  <dt>Logical bytes</dt>
                  <dd>{snapshot ? bytes(snapshot.logicalBytes) : "—"}</dd>
                  <dt>Artifacts with unknown size</dt>
                  <dd>{snapshot ? number(snapshot.unknownArtifacts) : "—"}</dd>
                  <dt>Retained revisions</dt>
                  <dd>{snapshot ? number(snapshot.revisions) : "—"}</dd>
                  <dt>Snapshot day (UTC)</dt>
                  <dd>{snapshot?.day ?? "Not received"}</dd>
                </dl>
                <p className="panel-note">
                  Owned projects including trash. Stored R2 metadata plus D1
                  documents without R2 pointers; excludes database overhead and
                  backups. Known byte metadata only; legacy artifacts with
                  unknown sizes are listed separately. Not billable disk usage.
                </p>
              </section>
            </div>
            <div className="equal-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>Saved project size observations</h2>
                </div>
                <Histogram
                  labels={sizeLabels}
                  values={SIZES.map((b) =>
                    rows
                      .filter(
                        (r) => r.event === "project_size" && r.bucket === b,
                      )
                      .reduce((n, r) => n + r.count, 0),
                  )}
                />
                <p className="panel-note">
                  OpenZCAD: cloud save payload envelopes. OpenFEA: saved local
                  files. Repeated saves count again.
                </p>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Part count observations</h2>
                </div>
                <Histogram
                  labels={["0", "1", "2–10", "11–100", "≥101"]}
                  values={PARTS.map((b) =>
                    rows
                      .filter((r) => r.event === "part_count" && r.bucket === b)
                      .reduce((n, r) => n + r.count, 0),
                  )}
                />
                <p className="panel-note">
                  CAD body nodes after edits; FEA display bodies on file saves.
                  No unique part inventory.
                </p>
              </section>
            </div>
            <div className="equal-grid">
              {(["transfer_upload", "transfer_download"] as const).map(
                (event) => (
                  <section className="panel" key={event}>
                    <div className="panel-heading">
                      <h2>
                        {event === "transfer_upload" ? "Upload" : "Download"}{" "}
                        size observations
                      </h2>
                    </div>
                    <Histogram
                      labels={sizeLabels}
                      values={SIZES.map((b) =>
                        rows
                          .filter((r) => r.event === event && r.bucket === b)
                          .reduce((n, r) => n + r.count, 0),
                      )}
                    />
                    <p className="panel-note">
                      Successful measured operations only; size ranges, not
                      total bandwidth. OpenFEA encrypted backups; OpenZCAD JSON
                      writes.
                    </p>
                  </section>
                ),
              )}
            </div>
            <section className="panel">
              <div className="panel-heading">
                <h2>Cloud snapshot history</h2>
              </div>
              <div
                className="table-scroll"
                role="region"
                aria-label="Cloud snapshot history"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>UTC day</th>
                      <th>Opted-in accounts</th>
                      <th>Projects</th>
                      <th>Stored bytes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.census?.length ? (
                      data.census.map((c) => (
                        <tr key={`${c.app}:${c.day}`}>
                          <td>{c.day}</td>
                          <td className="numeric">{number(c.accounts)}</td>
                          <td className="numeric">{number(c.projects)}</td>
                          <td className="numeric">{bytes(c.storedBytes)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="empty-cell">
                          No cloud snapshots. OpenFEA has no account census.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {view === "Diagnostics" && !optional && (
          <p className="scope-notice">
            Choose Opt-in analytics to view diagnostic codes.
          </p>
        )}
        {view === "Diagnostics" && optional && (
          <>
            <section className="panel">
              <div className="panel-heading">
                <h2>Diagnostic codes</h2>
              </div>
              <Codes rows={rows} />
              <p className="panel-note">
                Fixed failure categories, never raw error text or stacks. One
                problem can emit several signals. Counts are not distinct bugs
                or people.
              </p>
            </section>
            <details className="panel event-details" open>
              <summary>Feature operations and all event buckets</summary>
              <EventTable rows={rows} />
            </details>
          </>
        )}
        {view !== "Privacy" && (
          <>
            <details className="panel performance">
              <summary>
                <strong>Performance</strong>{" "}
                <span>coarse operation timings</span>
              </summary>
              <div className="equal-grid">
                {(optional
                  ? [
                      "operation_latency",
                      "mesh_latency",
                      "solver_latency",
                      "save_latency",
                      "export_latency",
                    ]
                  : ["api_latency"]
                ).map((event) => (
                  <section key={event}>
                    <h3>
                      <code>{event}</code>
                    </h3>
                    <Timing rows={rows} event={event} />
                  </section>
                ))}
              </div>
              <p className="panel-note">
                Counts are operations. No exact timings or percentiles are
                inferred from these coarse ranges.
              </p>
            </details>
            <ReportInspector />
          </>
        )}
        {view === "Privacy" && (
          <section className="panel privacy-content">
            <h2>Detailed aggregates. No individual timelines.</h2>
            <p>
              Basic collection measures backend API counts, errors and coarse
              latency. All expanded statistics require explicit opt-in, with a
              fresh choice for the expanded scope.
            </p>
            <h3>What is collected after opt-in</h3>
            <p>
              Allowlisted feature categories, CAD operation kinds, workflow
              steps, diagnostic codes, size and part-count ranges, coarse timing
              distributions and OpenFEA solver outcomes. Cloud totals have a
              separate OpenZCAD account permission that expires after 30 days.
            </p>
            <h3>What never enters Glimpse</h3>
            <p>
              Model contents, geometry, filenames, project names, emails,
              account or project IDs, URLs, raw messages or stacks, cookies,
              fingerprints, visitor IDs, sessions or individual histories. Data
              stays separate per app.
            </p>
            <h3>Withdrawal and reports</h3>
            <p>
              Withdraw browser collection in OpenZCAD Settings → Privacy or
              OpenFEA Storage. Revoke account statistics separately in OpenZCAD
              Settings → Privacy. Withdrawal stops future collection in its
              scope; already aggregated totals cannot be attributed to remove an
              individual contribution. Browser DNT/GPC suppresses browser
              sending, while the separate account permission remains until
              withdrawn or expired.
            </p>
            <p>
              Optional reports contain only counts from the current opted-in
              page. Users download and review them before choosing to share.
              Reports opened here stay in this page and are never uploaded or
              added to service statistics.
            </p>
            <h3>Interpretation and retention</h3>
            <p>
              90 UTC days of service aggregates. Snapshots represent consenting
              accounts at one point in time; operations can repeat, fail
              delivery or be spoofed. Unknown, not received and unsupported do
              not mean zero. No anonymous unique-user count exists. Combined
              views do not track people across apps.
            </p>
            <h3>Consent requirements</h3>
            <p>
              Cookieless collection is not automatically exempt from consent
              rules. The deployment needs an audience and jurisdiction review,
              notices and infrastructure retention review before activation.
              This dashboard does not certify legal compliance.
            </p>
          </section>
        )}
        <footer>
          <span>
            No model contents, names, visitor IDs, or individual timelines.
          </span>
          <span>Glimpse · private analytics</span>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
