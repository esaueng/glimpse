import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BUCKETS, type Row } from "../src/contract";
import "./style.css";
const iso = (date: Date) => date.toISOString().slice(0, 10);
const today = iso(new Date()),
  monthAgo = iso(new Date(Date.now() - 29 * 86400000));
const names: Record<string, string> = {
  api_request: "API requests",
  api_error: "Server errors",
  api_latency: "API response time",
  workspace_opened: "Workspace opens",
  export_completed: "Completed exports",
  export_failed: "Failed exports",
  solver_completed: "Completed solver runs",
  solver_failed: "Failed solver runs",
  operation_latency: "Local operation time",
  feature_used: "Feature actions",
  workflow_model: "Model step",
  workflow_mesh: "Mesh step",
  workflow_setup: "Setup step",
  workflow_run: "Run step",
  workflow_results: "Results step",
};
const bucketLabels = ["<100 ms", "100 ms–1 s", "1–10 s", "10–60 s", "≥60 s"];
function Dashboard() {
  const [app, setApp] = useState("all"),
    [level, setLevel] = useState("basic");
  const [from, setFrom] = useState(monthAgo),
    [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    app: "all",
    level: "basic",
    from: monthAgo,
    to: today,
  });
  const [applied, setApplied] = useState(filter);
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current,
      controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/stats?${new URLSearchParams(filter)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            r.status === 401
              ? "Sign in through Cloudflare Access to view analytics."
              : r.status === 400
                ? "Choose a valid date range of at most 90 days."
                : "Analytics are unavailable. Try again.",
          );
        if (!(r.headers.get("Content-Type") ?? "").includes("application/json"))
          throw new Error(
            "Analytics are unavailable. Connect the protected API to load data.",
          );
        const data = (await r.json()) as { rows: Row[] };
        if (current === sequence.current) {
          setRows(data.rows);
          setApplied(filter);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted && current === sequence.current) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Analytics unavailable.");
        }
      })
      .finally(() => {
        if (current === sequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [filter]);
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.event, (counts.get(row.event) ?? 0) + row.count);
  const count = (event: string) => counts.get(event) ?? 0;
  const optional = applied.level === "optional";
  const activityEvent = optional ? "workspace_opened" : "api_request";
  const days: string[] = [];
  for (
    let date = Date.parse(applied.from);
    date <= Date.parse(applied.to);
    date += 86400000
  )
    days.push(iso(new Date(date)));
  const daily = days.map((day) =>
    rows
      .filter((r) => r.day === day && r.event === activityEvent)
      .reduce((n, r) => n + r.count, 0),
  );
  const max = Math.max(1, ...daily);
  const latency = BUCKETS.map((bucket) =>
    rows.filter((r) => r.bucket === bucket).reduce((n, r) => n + r.count, 0),
  );
  const latencyMax = Math.max(1, ...latency);
  const value = (n: number) => (loading || error ? "—" : n.toLocaleString());
  return (
    <>
      <header>
        <strong>Glimpse</strong>
        <span>Private analytics</span>
      </header>
      <main>
        <h1>A little insight. Less data.</h1>
        <p className="intro">Aggregate activity across OpenZCAD and OpenFEA.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ app, level, from, to });
          }}
        >
          <label>
            App
            <select value={app} onChange={(e) => setApp(e.target.value)}>
              <option value="all">All apps</option>
              <option value="openzcad">OpenZCAD</option>
              <option value="openfea">OpenFEA</option>
            </select>
          </label>
          <label>
            Collection
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="basic">Basic statistics</option>
              <option value="optional">Optional · opted-in users only</option>
            </select>
          </label>
          <label>
            Start date
            <input
              type="date"
              required
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              required
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button disabled={loading}>Apply</button>
        </form>
        <p className="scope">
          {optional
            ? "Optional analytics · opted-in users only. Local operations and workflow steps."
            : "Basic statistics · backend API activity only. Local exports and solves appear under optional analytics."}{" "}
          Dates are UTC.
        </p>
        <div
          role="status"
          aria-live="polite"
          className={error ? "status error" : "status"}
        >
          {loading
            ? "Loading aggregates…"
            : error ||
              `${applied.app === "all" ? "All apps" : applied.app === "openzcad" ? "OpenZCAD" : "OpenFEA"} · ${applied.from} to ${applied.to}`}
        </div>
        <section className="totals" aria-label="Totals">
          {[
            ["Activity", value(count(activityEvent))],
            [
              "Exports",
              optional ? value(count("export_completed")) : "Not collected",
            ],
            [
              "Solver runs",
              optional ? value(count("solver_completed")) : "Not collected",
            ],
            [
              "Errors",
              value(
                optional
                  ? count("export_failed") + count("solver_failed")
                  : count("api_error"),
              ),
            ],
          ].map(([label, n]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{n}</strong>
            </div>
          ))}
        </section>
        <section className="activity">
          <h2>
            Activity{" "}
            <small>{optional ? "workspace opens" : "API requests"}</small>
          </h2>
          <div
            className="plot"
            role="img"
            aria-label={`Daily ${optional ? "workspace opens" : "API requests"}. ${daily.map((n, i) => `${days[i]}: ${n}`).join(", ")}`}
          >
            <div className="bars">
              {daily.map((n, i) => (
                <div className="bar-slot" key={days[i]}>
                  <div
                    className="bar"
                    style={{ height: `${(n / max) * 100}%` }}
                    title={`${days[i]}: ${n}`}
                  />
                </div>
              ))}
            </div>
            {!loading && !error && daily.every((n) => !n) && (
              <p className="empty">No activity in this date range.</p>
            )}
          </div>
          <div className="axis">
            <span>{applied.from}</span>
            <span>{applied.to}</span>
          </div>
        </section>
        <div className="details">
          <section>
            <h2>Event counts</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>App / event</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    ["openzcad", "openfea"].flatMap((a) =>
                      [
                        ...new Set(
                          rows.filter((r) => r.app === a).map((r) => r.event),
                        ),
                      ]
                        .sort()
                        .map((event) => (
                          <tr key={`${a}-${event}`}>
                            <td>
                              <span className="app-name">
                                {a === "openzcad" ? "OpenZCAD" : "OpenFEA"}
                              </span>
                              {names[event] ?? event}
                            </td>
                            <td>
                              {rows
                                .filter((r) => r.app === a && r.event === event)
                                .reduce((n, r) => n + r.count, 0)
                                .toLocaleString()}
                            </td>
                          </tr>
                        )),
                    )
                  ) : (
                    <tr>
                      <td colSpan={2} className="table-empty">
                        {loading
                          ? "Loading…"
                          : error
                            ? "No data loaded."
                            : "No events in this date range."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2>
              Performance{" "}
              <small>
                {optional ? "local operation times" : "API response times"}
              </small>
            </h2>
            <div
              className="histogram"
              role="img"
              aria-label={latency
                .map((n, i) => `${bucketLabels[i]}: ${n}`)
                .join(", ")}
            >
              {BUCKETS.map((bucket, i) => (
                <div className="hist-row" key={bucket}>
                  <span>{bucketLabels[i]}</span>
                  <div>
                    <i
                      style={{ width: `${(latency[i] / latencyMax) * 100}%` }}
                    />
                  </div>
                  <b>{value(latency[i])}</b>
                </div>
              ))}
            </div>
            <p className="scope">
              Coarse timing buckets. Counts are operations, never people.
            </p>
          </section>
        </div>
      </main>
      <footer>
        Optional analytics represent opted-in users only. No visitors, sessions,
        or individual histories.
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
