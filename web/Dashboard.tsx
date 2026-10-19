import { useEffect, useRef, useState } from "react";
import { dateRange } from "../src/contract";
import { appName, type Loaded, type Range, type Stats } from "./data";
import { useCompact } from "./useCompact";
import { Issues, Overview, Storage } from "./views";
import "./style.css";
const views = ["Overview", "Issues", "Storage", "Privacy"] as const;
type View = (typeof views)[number];
// Earlier links used view=diagnostics; the collection level is now chosen per panel.
const legacyViews: Record<string, View> = { diagnostics: "Issues" };
type Scope = { app: string; from: string; to: string };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
function readLocation(): { range: Scope; view: View } {
  const query = new URLSearchParams(location.search),
    view = query.get("view") ?? "";
  query.delete("view");
  query.delete("level");
  const parsed = dateRange(query);
  return {
    range: parsed
      ? { app: parsed.app, from: parsed.from, to: parsed.to }
      : { app: "all", from: daysAgo(29), to: today() },
    view:
      views.find((v) => v.toLowerCase() === view) ??
      legacyViews[view] ??
      "Overview",
  };
}
function Privacy() {
  return (
    <section className="panel privacy-content">
      <h2>Detailed aggregates. No individual timelines.</h2>
      <p>
        Basic collection measures backend API counts, errors and coarse latency.
        All expanded statistics require explicit opt-in, with a fresh choice for
        the expanded scope.
      </p>
      <h3>What is collected after opt-in</h3>
      <p>
        Allowlisted feature categories, CAD operation kinds, workflow steps,
        diagnostic codes, size and part-count ranges, coarse timing
        distributions and OpenFEA solver outcomes. Cloud totals have a separate
        OpenZCAD account permission that expires after 30 days.
      </p>
      <h3>What never enters Glimpse</h3>
      <p>
        Model contents, geometry, filenames, project names, emails, account or
        project IDs, URLs, raw messages or stacks, cookies, fingerprints,
        visitor IDs, sessions or individual histories. Data stays separate per
        app.
      </p>
      <h3>Withdrawal and reports</h3>
      <p>
        Withdraw browser collection in OpenZCAD Settings → Privacy or OpenFEA
        Storage. Revoke account statistics separately in OpenZCAD Settings →
        Privacy. Withdrawal stops future collection in its scope; already
        aggregated totals cannot be attributed to remove an individual
        contribution. Browser DNT/GPC suppresses browser sending, while the
        separate account permission remains until withdrawn or expired.
      </p>
      <p>
        Optional reports contain only counts from the current opted-in page.
        Users download and review them before choosing to share. Reports opened
        here stay in this page and are never uploaded or added to service
        statistics.
      </p>
      <h3>Interpretation and retention</h3>
      <p>
        90 UTC days of service aggregates. Snapshots represent consenting
        accounts at one point in time; operations can repeat, fail delivery or
        be spoofed. Unknown, not received and unsupported do not mean zero. No
        anonymous unique-user count exists. Combined views do not track people
        across apps.
      </p>
      <h3>Consent requirements</h3>
      <p>
        Cookieless collection is not automatically exempt from consent rules.
        The deployment needs an audience and jurisdiction review, notices and
        infrastructure retention review before activation. This dashboard does
        not certify legal compliance.
      </p>
    </section>
  );
}
export function Dashboard({
  loadStats,
  demo = false,
}: {
  loadStats: (range: Range, signal: AbortSignal) => Promise<Stats>;
  demo?: boolean;
}) {
  const compact = useCompact();
  const [filtersOpen, setFiltersOpen] = useState(!compact);
  useEffect(() => setFiltersOpen(!compact), [compact]);
  const [initial] = useState(readLocation),
    [view, setView] = useState<View>(initial.view),
    [draft, setDraft] = useState(initial.range),
    [filter, setFilter] = useState(initial.range);
  const [data, setData] = useState<Loaded | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const sequence = useRef(0);
  function apply(range: Scope, nextView = view, push = true) {
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
    // Basic and opt-in aggregates stay separate queries; each panel names its source.
    void Promise.all([
      loadStats({ ...filter, level: "basic" }, controller.signal),
      loadStats({ ...filter, level: "optional" }, controller.signal),
    ])
      .then(([basic, optional]) => {
        if (current === sequence.current) setData({ basic, optional });
      })
      .catch((e) => {
        if (!controller.signal.aborted && current === sequence.current)
          setError(e instanceof Error ? e.message : "Analytics unavailable.");
      })
      .finally(() => {
        if (current === sequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [filter, loadStats]);
  const applied = data?.basic.range ?? { ...filter, level: "basic" };
  const preset = (days: number) =>
    apply({ ...draft, from: daysAgo(days - 1), to: today() });
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a
            href="?"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              apply(filter, "Overview");
            }}
          >
            <img
              className="brand-mark"
              src={`${import.meta.env.BASE_URL}brand/mark.svg`}
              alt=""
              width="30"
              height="30"
            />
            Glimpse
          </a>
          <nav aria-label="Main navigation">
            {views.map((v) => (
              <button
                key={v}
                aria-current={view === v ? "page" : undefined}
                onClick={() => apply(filter, v)}
              >
                {v}
              </button>
            ))}
          </nav>
          <div className="access-label">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" />
            </svg>
            {demo ? "Public demo · sample data" : "Only you · Cloudflare Access"}
          </div>
        </div>
      </header>
      <main>
        {demo && (
          <aside className="demo-banner" aria-label="Demo information">
            <div>
              <strong>Explore Glimpse</strong>
              <p>
                All numbers are made up. Try the filters, storage charts, and
                issues. This demo never connects to live analytics.
              </p>
            </div>
            <a
              href="https://github.com/esaueng/glimpse"
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub ↗
            </a>
          </aside>
        )}
        <div className="toolbar">
          <h1>{view}</h1>
          {view !== "Privacy" && (
            <details
              className="filters"
              open={filtersOpen}
              onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
            >
              <summary>
                Filters · {appName(filter.app)} · {filter.from} – {filter.to}
              </summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  apply(draft);
                }}
              >
                <label>
                  <span>App</span>
                  <select
                    value={draft.app}
                    onChange={(e) => setDraft({ ...draft, app: e.target.value })}
                  >
                    <option value="all">All apps</option>
                    <option value="openzcad">OpenZCAD</option>
                    <option value="openfea">OpenFEA</option>
                    <option value="openlattice3d">OpenLattice3D</option>
                  </select>
                </label>
                <label>
                  <span>From</span>
                  <input
                    required
                    type="date"
                    value={draft.from}
                    max={draft.to}
                    onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                  />
                </label>
                <label>
                  <span>To</span>
                  <input
                    required
                    type="date"
                    value={draft.to}
                    min={draft.from}
                    max={today()}
                    onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  />
                </label>
                <span className="utc">UTC</span>
                <button className="primary" disabled={loading}>
                  Apply
                </button>
                <span className="presets" role="group" aria-label="Quick ranges">
                  {[7, 30, 90].map((days) => (
                    <button key={days} type="button" disabled={loading} onClick={() => preset(days)}>
                      {days}d
                    </button>
                  ))}
                </span>
              </form>
            </details>
          )}
          {view !== "Privacy" && (
            <div className="refresh">
              <span>
                {data
                  ? demo
                    ? "Synthetic data"
                    : `Updated ${new Date(data.basic.receivedAt).toISOString().slice(11, 16)} UTC`
                  : "Awaiting data"}
              </span>
              <button
                type="button"
                aria-label="Refresh"
                disabled={loading}
                onClick={() => setFilter({ ...filter })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
              </button>
            </div>
          )}
        </div>
        {view !== "Privacy" && (
          <p className="scope" role="status" aria-live="polite">
            {loading ? (
              "Loading aggregates…"
            ) : error ? (
              <span className="error-message">
                {error}
                {data ? " Showing stale results for the last successful scope." : ""}
              </span>
            ) : (
              <>
                {appName(applied.app)} · {applied.from} – {applied.to} UTC ·
                Basic counts cover all users; opt-in figures cover opted-in
                users only.
              </>
            )}
          </p>
        )}
        {view === "Privacy" ? (
          <Privacy />
        ) : data ? (
          <div className={loading ? "content is-loading" : "content"}>
            {view === "Overview" && <Overview data={data} app={applied.app} />}
            {view === "Issues" && (
              <Issues data={data} app={applied.app} demo={demo} />
            )}
            {view === "Storage" && <Storage data={data} app={applied.app} />}
          </div>
        ) : (
          !loading && <p className="notice">No data loaded.</p>
        )}
        <footer>
          <span>No model contents, names, visitor IDs, or individual timelines.</span>
          <span>Glimpse · {demo ? "public demo · synthetic data" : "private analytics"}</span>
        </footer>
      </main>
    </>
  );
}
