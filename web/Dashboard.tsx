import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { appName, type Loaded, type Range, type Stats } from "./data";
import { useLoader, useUrlState, writeSearch } from "./hooks";
import { RangePicker } from "./RangePicker";
import {
  formatRange,
  readScope,
  refreshedTimeframe,
  scopeSearch,
  validScope,
  type Scope,
} from "./ranges";
import { Issues, Overview, Storage } from "./views";
import type { MonitorLoader, SettingsWriter } from "./Cloudflare";
import "./style.css";
// The Cloudflare monitor is a separate page; load its code only when opened.
const CloudflarePage = lazy(() =>
  import("./Cloudflare").then((m) => ({ default: m.CloudflarePage })),
);
const views = [
  "Overview",
  "Issues",
  "Storage",
  "Cloudflare",
  "Privacy",
] as const;
type View = (typeof views)[number];
// Earlier links used view=diagnostics; the collection level is now chosen per panel.
const legacyViews: Record<string, View> = { diagnostics: "Issues" };
function readLocation(): { range: Scope; view: View; notice: string } {
  const view = new URLSearchParams(location.search).get("view") ?? "";
  const { scope, notice } = readScope(location.search);
  return {
    range: scope,
    notice,
    view:
      views.find((v) => v.toLowerCase() === view) ??
      legacyViews[view] ??
      "Overview",
  };
}
/** Keeps a render error in one part of the page from blanking the dashboard. */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; compact?: boolean },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  componentDidUpdate(prior: { resetKey?: string }) {
    if (this.state.failed && prior.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section
        className={this.props.compact ? "panel crash" : "panel crash crash-page"}
        role="alert"
      >
        <h2>Something went wrong showing this {this.props.compact ? "page" : "dashboard"}.</h2>
        <p>
          No data was changed. Try again, choose another page or timeframe, or
          reload.
        </p>
        <div className="crash-actions">
          <button type="button" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
          <button type="button" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </section>
    );
  }
}
const utcTime = (iso: string) => new Date(iso).toISOString().slice(11, 19);
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
      <h3>What never enters application analytics</h3>
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
      <h3>Cloudflare infrastructure monitoring</h3>
      <p>
        The separate owner-authorized Cloudflare page stores infrastructure
        resource names and IDs, app mappings, aggregate usage and costs for up
        to 400 days. It does not collect customer identities or model data.
        Public demo data is fictional.
      </p>
    </section>
  );
}
export function Dashboard({
  loadStats,
  loadCloudflare,
  writeCloudflare,
  demo = false,
}: {
  loadStats: (range: Range, signal: AbortSignal) => Promise<Stats>;
  loadCloudflare?: MonitorLoader;
  writeCloudflare?: SettingsWriter;
  demo?: boolean;
}) {
  const [{ view, range: filter, notice }, setLocation] = useUrlState(
    readLocation,
    // Normalise an invalid link in place, without adding a history entry.
    (next) => {
      if (next.notice)
        writeSearch(
          scopeSearch(next.range, next.view.toLowerCase(), location.search),
          "replace",
        );
    },
  );
  const setNotice = (notice: string) =>
    setLocation((current) => ({ ...current, notice }));
  const { app, from, to } = filter;
  const analyticsView = view !== "Cloudflare" && view !== "Privacy";
  // Basic and opt-in aggregates stay separate queries; each panel names its source.
  const { data, loading, error, refresh } = useLoader<Loaded>(
    (signal) =>
      Promise.all([
        loadStats({ app, from, to, level: "basic" }, signal),
        loadStats({ app, from, to, level: "optional" }, signal),
      ]).then(([basic, optional]) => ({ basic, optional })),
    [app, from, to, loadStats],
    {
      enabled: analyticsView,
      errorMessage: (e) =>
        e instanceof Error ? e.message : "Analytics unavailable.",
    },
  );
  const heading = useRef<HTMLHeadingElement>(null),
    shownView = useRef(view),
    baseTitle = useRef(document.title);
  /**
   * Apply a scope and view. Page changes add a history entry so back and
   * forward move between pages; filter changes replace the current entry.
   * An invalid range is never applied or written to the URL.
   */
  function apply(range: Scope, nextView: View = view) {
    if (!validScope(range)) {
      setNotice(
        `${formatRange(range.from, range.to)} is not a valid range of at most 90 UTC days ending by today, so the timeframe was not changed.`,
      );
      return;
    }
    setLocation({ range: { ...range }, view: nextView, notice: "" });
    writeSearch(
      scopeSearch(range, nextView.toLowerCase(), location.search),
      nextView === view ? "replace" : "push",
    );
  }
  useEffect(() => {
    document.title = `${view} · ${baseTitle.current}`;
    // Move focus to the new page heading on navigation, not on first load.
    if (shownView.current !== view) heading.current?.focus();
    shownView.current = view;
  }, [view]);
  const applied = data?.basic.range ?? { ...filter, level: "basic" };
  return (
    <>
      <a
        className="skip-link"
        href="#content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("content")?.focus();
        }}
      >
        Skip to content
      </a>
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
            <span className="access-long">
              {demo
                ? "Public demo · sample data"
                : "Only you · Cloudflare Access"}
            </span>
            <span className="access-short">
              {demo ? "Sample data" : "Only you"}
            </span>
          </div>
        </div>
      </header>
      <main id="content" tabIndex={-1}>
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
              className="banner-link"
              href="https://github.com/esaueng/glimpse"
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </aside>
        )}
        <div className="toolbar">
          <h1 ref={heading} tabIndex={-1}>
            {view}
          </h1>
          {analyticsView && (
            <div className="controls">
              <RangePicker
                value={filter}
                onChange={(t) => apply({ app: filter.app, ...t })}
              />
              <label className="app-select">
                <span className="sr-only">App</span>
                <select
                  value={filter.app}
                  onChange={(e) => apply({ ...filter, app: e.target.value })}
                >
                  <option value="all">All apps</option>
                  <option value="openzcad">OpenZCAD</option>
                  <option value="openfea">OpenFEA</option>
                  <option value="openlattice3d">OpenLattice3D</option>
                </select>
              </label>
              <div className="refresh">
                <span className="status" role="status" aria-live="polite">
                  {loading
                    ? "Loading…"
                    : error
                      ? "Refresh failed"
                      : data
                        ? `${demo ? "Synthetic · " : ""}Updated ${utcTime(data.basic.receivedAt)} UTC`
                        : "Awaiting data"}
                </span>
                <button
                  type="button"
                  aria-label="Refresh"
                  title="Refresh"
                  // aria-disabled keeps focus on the button while loading.
                  aria-disabled={loading}
                  className={loading ? "is-spinning" : undefined}
                  onClick={() => {
                    if (loading) return;
                    setLocation((current) => ({
                      ...current,
                      range: {
                        ...current.range,
                        ...refreshedTimeframe(current.range),
                      },
                    }));
                    refresh();
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
        {notice && (
          <div className="range-notice" role="status" data-range-notice>
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
        {analyticsView && (
          <p className="scope">
            {error ? (
              <span className="error-message" role="alert">
                {error}
                {data
                  ? " Showing stale results for the last successful scope."
                  : ""}
              </span>
            ) : (
              <>
                {appName(applied.app)} · {formatRange(applied.from, applied.to)}{" "}
                UTC · Basic counts cover all users; opt-in figures cover
                opted-in users only.
              </>
            )}
          </p>
        )}
        <ErrorBoundary compact resetKey={`${view}:${app}:${from}:${to}`}>
          {view === "Cloudflare" ? (
            <Suspense
              fallback={<p className="notice">Loading Cloudflare monitor…</p>}
            >
              <CloudflarePage
                load={loadCloudflare}
                write={writeCloudflare}
                demo={demo}
              />
            </Suspense>
          ) : view === "Privacy" ? (
            <Privacy />
          ) : data ? (
            <div
              className={loading ? "content is-loading" : "content"}
              aria-busy={loading}
            >
              {view === "Overview" && (
                <Overview data={data} app={applied.app} />
              )}
              {view === "Issues" && (
                <Issues data={data} app={applied.app} demo={demo} />
              )}
              {view === "Storage" && (
                <Storage data={data} app={applied.app} />
              )}
            </div>
          ) : (
            !loading && <p className="notice">No data loaded.</p>
          )}
        </ErrorBoundary>
        <footer>
          <span>No model contents, visitor IDs, or individual timelines.</span>
          <span>
            Glimpse ·{" "}
            {demo ? "public demo · synthetic data" : "private analytics"}
          </span>
        </footer>
      </main>
    </>
  );
}
