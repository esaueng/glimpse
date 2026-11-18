import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { OPENZCAD_CHANNELS } from "../src/contract";
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
import { Issues, Storage, Usage } from "./views";
import { Home, Performance, Sources } from "./pages";
import { Inbox } from "./inbox";
import { PageActions, Skeleton } from "./ui";
import type { IssuesClient } from "./issues-api";
import type { MonitorLoader, SettingsWriter } from "./Cloudflare";
import "./style.css";
// The Cloudflare monitor is a separate page; load its code only when opened.
const CloudflarePage = lazy(() =>
  import("./Cloudflare").then((m) => ({ default: m.CloudflarePage })),
);
type Page = { id: string; title: string; group: string; icon: string; data: boolean };
// Grouped navigation. `data` pages load the analytics aggregates for the selected scope.
const pages = [
  { id: "home", title: "Home", group: "Monitor", icon: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10", data: true },
  { id: "issues", title: "Issues", group: "Monitor", icon: "M12 3 2 20h20L12 3Zm0 6v5m0 3v.01", data: true },
  { id: "performance", title: "Performance", group: "Monitor", icon: "M3 13a9 9 0 0 1 18 0M12 13l4-4M7 20h10", data: true },
  { id: "usage", title: "Usage", group: "Product", icon: "M4 20V10m6 10V4m6 16v-7m4 7H2", data: true },
  { id: "storage", title: "Storage", group: "Product", icon: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3", data: true },
  { id: "costs", title: "Costs", group: "Infrastructure", icon: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6", data: false },
  { id: "sources", title: "Sources", group: "Settings", icon: "M9 2v6m6-6v6M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4", data: true },
  { id: "privacy", title: "Privacy", group: "Settings", icon: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z", data: false },
] as const satisfies readonly Page[];
type View = (typeof pages)[number]["id"];
const groups = [...new Set(pages.map((p) => p.group))];
// Earlier links named the pages Overview, Diagnostics and Cloudflare.
const legacyViews: Record<string, View> = {
  overview: "usage",
  diagnostics: "issues",
  cloudflare: "costs",
};
function readLocation(): { range: Scope; view: View; notice: string } {
  const view = new URLSearchParams(location.search).get("view") ?? "";
  const { scope, notice } = readScope(location.search);
  return {
    range: scope,
    notice,
    view: pages.find((p) => p.id === view)?.id ?? legacyViews[view] ?? "home",
  };
}
const pageOf = (view: View) => pages.find((p) => p.id === view)!;
function Icon({ d }: { d: string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const appChoices = [
  ["all", "All apps"],
  ["openzcad", "OpenZCAD"],
  ["openfea", "OpenFEA"],
  ["openlattice3d", "OpenLattice3D"],
] as const;
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
        Basic collection measures API counts, errors and coarse latency.
        OpenZCAD also reports total cloud accounts, active web logins and
        visible app starts. Beta and stable report separately.
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
        visitor IDs, session IDs or individual histories. Data stays separate per
        app and OpenZCAD channel.
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
        90 UTC days of service aggregates. Account snapshots show the latest
        totals in range. Workspace sessions include reloads and repeat visits,
        and delivery can fail. Unknown, not received and unsupported do not mean zero. No
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
        The separate owner-authorized Costs page stores infrastructure
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
  issues,
  demo = false,
}: {
  loadStats: (range: Range, signal: AbortSignal) => Promise<Stats>;
  issues?: IssuesClient;
  loadCloudflare?: MonitorLoader;
  writeCloudflare?: SettingsWriter;
  demo?: boolean;
}) {
  const [{ view, range: filter, notice }, setLocation] = useUrlState(
    readLocation,
    // Normalise an invalid or legacy link in place, without adding a history entry.
    (next) => {
      const raw = new URLSearchParams(location.search).get("view");
      if (next.notice || (raw !== null && raw !== next.view))
        writeSearch(scopeSearch(next.range, next.view, location.search), "replace");
    },
  );
  const [menuOpen, setMenuOpen] = useState(false);
  // Pages without the analytics controls (Costs) place their own actions here.
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const setNotice = (notice: string) =>
    setLocation((current) => ({ ...current, notice }));
  const { from, to } = filter;
  const page = pageOf(view),
    analyticsView = page.data,
    // Sources reports every source, so it always reads all apps.
    app = view === "sources" ? "all" : filter.app,
    showChannels = app === "all" || app === "openzcad",
    channel = showChannels ? filter.channel : undefined;
  // Basic and opt-in aggregates stay separate queries; each panel names its source.
  const { data: loaded, loading, error, refresh } = useLoader<Loaded>(
    (signal) =>
      Promise.all([
        loadStats({ app, from, to, ...(channel && { channel }), level: "basic" }, signal),
        loadStats({ app, from, to, ...(channel && { channel }), level: "optional" }, signal),
      ]).then(([basic, optional]) => ({ basic, optional })),
    [app, channel, from, to, loadStats],
    {
      enabled: analyticsView,
      errorMessage: (e) =>
        e instanceof Error ? e.message : "Analytics unavailable.",
    },
  );
  // A pending or failed channel switch must not show the previous channel's totals.
  const data =
    (loaded?.basic.range.channel ?? "beta") === (channel ?? "beta") ? loaded : null;
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
    setMenuOpen(false);
    setLocation({ range: { ...range }, view: nextView, notice: "" });
    writeSearch(
      scopeSearch(range, nextView, location.search),
      nextView === view ? "replace" : "push",
    );
  }
  const navigate = (next: string, nextApp?: string) => {
    const target = pages.find((p) => p.id === next)?.id;
    if (target) apply({ ...filter, app: nextApp ?? filter.app }, target);
  };
  useEffect(() => {
    document.title = `${page.title} · ${baseTitle.current}`;
    // Move focus to the new page heading on navigation, not on first load.
    if (shownView.current !== view) heading.current?.focus();
    shownView.current = view;
  }, [view]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);
  const applied = data?.basic.range ?? { ...filter, level: "basic" };
  return (
    <div className="shell">
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
      <aside className="sidebar">
        <div className="sidebar-top">
          <a
            href="?"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              apply(filter, "home");
            }}
          >
            <img
              className="brand-mark"
              src={`${import.meta.env.BASE_URL}brand/mark.svg`}
              alt=""
              width="26"
              height="26"
            />
            Glimpse
          </a>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={menuOpen ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
            <span className="sr-only">Menu</span>
            <span aria-hidden="true">{page.title}</span>
          </button>
        </div>
        <nav
          id="main-nav"
          aria-label="Main navigation"
          className={menuOpen ? "is-open" : undefined}
        >
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-title" aria-hidden="true">
                {group}
              </span>
              <ul aria-label={group}>
                {pages
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-current={view === p.id ? "page" : undefined}
                        onClick={() => apply(filter, p.id)}
                      >
                        <Icon d={p.icon} />
                        {p.title}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="access-label">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" />
          </svg>
          <span>
            {demo ? "Public demo · sample data" : "Only you · Cloudflare Access"}
          </span>
        </div>
      </aside>
      <main id="content" tabIndex={-1}>
        {demo && (
          <aside className="demo-banner" aria-label="Demo information">
            <strong>Demo</strong>
            <span>All numbers are made up. No live connection.</span>
            <a
              className="banner-link"
              href="https://github.com/esaueng/glimpse"
              target="_blank"
              rel="noreferrer"
            >
              GitHub <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </aside>
        )}
        <div className="page-head">
          <h1 ref={heading} tabIndex={-1}>
            {page.title}
          </h1>
          {!analyticsView && <div className="controls" ref={setActions} />}
          {analyticsView && (
            <div className="controls">
              <RangePicker
                value={filter}
                onChange={(t) => apply({ ...t, app: filter.app, channel: filter.channel })}
              />
              {view !== "sources" && (
                <div className="app-filter" role="group" aria-label="App">
                  {appChoices.map(([id, name]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={filter.app === id}
                      onClick={() => apply({ ...filter, app: id })}
                    >
                      {id !== "all" && <span className={`swatch ${id}`} aria-hidden="true" />}
                      {name}
                    </button>
                  ))}
                </div>
              )}
              {showChannels && (
                <div
                  className="app-filter channel-filter"
                  role="group"
                  aria-label="OpenZCAD channel"
                  title="OpenZCAD release channel"
                >
                  <span className="filter-prefix" aria-hidden="true">
                    ZCAD
                  </span>
                  {OPENZCAD_CHANNELS.map((site) => (
                    <button
                      key={site}
                      type="button"
                      aria-pressed={(channel ?? "beta") === site}
                      onClick={() => apply({ ...filter, channel: site })}
                    >
                      {site === "beta" ? "Beta" : "Stable"}
                    </button>
                  ))}
                </div>
              )}
              <div className="refresh">
                <span className="status" role="status" aria-live="polite">
                  {loading
                    ? "Loading…"
                    : error
                      ? "Refresh failed"
                      : data
                        ? `${utcTime(data.basic.receivedAt)} UTC`
                        : ""}
                </span>
                <button
                  type="button"
                  aria-label={data ? `Refresh, updated ${utcTime(data.basic.receivedAt)} UTC` : "Refresh"}
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
        {analyticsView && error && (
          <p className="scope error-message" role="alert">
            {error}
            {data ? " Showing the last successful results." : ""}
          </p>
        )}
        <ErrorBoundary compact resetKey={`${view}:${app}:${channel}:${from}:${to}`}>
          {view === "costs" ? (
            <Suspense
              fallback={<Skeleton label="Loading Cloudflare monitor…" />}
            >
              <PageActions.Provider value={actions}>
                <CloudflarePage
                  load={loadCloudflare}
                  write={writeCloudflare}
                  demo={demo}
                />
              </PageActions.Provider>
            </Suspense>
          ) : view === "privacy" ? (
            <div className="content" key={view}>
              <Privacy />
            </div>
          ) : data ? (
            <div
              key={view}
              className={loading ? "content is-loading" : "content"}
              aria-busy={loading}
            >
              {view === "home" && (
                <Home data={data} app={applied.app} navigate={navigate} issues={issues} />
              )}
              {view === "issues" && (
                <>
                  {issues && (
                    <Inbox client={issues} app={applied.app} onConnect={() => navigate("sources")} />
                  )}
                  <h2 className="section-title">App diagnostics</h2>
                  <Issues data={data} app={applied.app} demo={demo} />
                </>
              )}
              {view === "performance" && (
                <Performance data={data} app={applied.app} />
              )}
              {view === "usage" && <Usage data={data} app={applied.app} />}
              {view === "storage" && (
                <Storage data={data} app={applied.app} />
              )}
              {view === "sources" && (
                <Sources data={data} navigate={navigate} issues={issues} demo={demo} />
              )}
            </div>
          ) : (
            loading ? <Skeleton label="Loading analytics…" /> : <p className="notice">No data loaded.</p>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
