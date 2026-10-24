import { useEffect, useRef, useState } from "react";
import { dateRange } from "../src/contract";
import { appName, type Loaded, type Range, type Stats } from "./data";
import { RangePicker } from "./RangePicker";
import {
  formatRange,
  isPreset,
  presetRange,
  refreshedTimeframe,
  type Preset,
} from "./ranges";
import { Issues, Overview, Storage } from "./views";
import {
  CloudflarePage,
  type MonitorLoader,
  type SettingsWriter,
} from "./Cloudflare";
import "./style.css";
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
type Scope = { app: string; from: string; to: string; preset?: Preset };
function readLocation(): { range: Scope; view: View } {
  const query = new URLSearchParams(location.search),
    view = query.get("view") ?? "",
    preset =
      query.get("range") ??
      (query.has("from") || query.has("to") ? null : "30d");
  for (const key of ["view", "level", "range"]) query.delete(key);
  // A preset in the URL rolls forward with the current UTC day.
  if (isPreset(preset)) {
    const { from, to } = presetRange(preset);
    query.set("from", from);
    query.set("to", to);
  }
  const parsed = dateRange(query);
  return {
    range: parsed
      ? {
          app: parsed.app,
          from: parsed.from,
          to: parsed.to,
          ...(isPreset(preset) ? { preset } : {}),
        }
      : { app: "all", ...presetRange("30d"), preset: "30d" },
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
  const [initial] = useState(readLocation),
    [view, setView] = useState<View>(initial.view),
    [filter, setFilter] = useState(initial.range);
  const [data, setData] = useState<Loaded | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const { app, from, to } = filter;
  const analyticsView = view !== "Cloudflare" && view !== "Privacy";
  const sequence = useRef(0);
  function apply(range: Scope, nextView = view, push = true) {
    setFilter({ ...range });
    setView(nextView);
    if (push) {
      const { preset, ...dates } = range;
      history.pushState(
        null,
        "",
        `?${new URLSearchParams({
          ...(preset ? { app: range.app, range: preset } : dates),
          view: nextView.toLowerCase(),
        })}`,
      );
    }
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
    if (!analyticsView) return;
    const current = ++sequence.current,
      controller = new AbortController();
    setLoading(true);
    setError("");
    // Basic and opt-in aggregates stay separate queries; each panel names its source.
    void Promise.all([
      loadStats({ app, from, to, level: "basic" }, controller.signal),
      loadStats({ app, from, to, level: "optional" }, controller.signal),
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
  }, [analyticsView, app, from, to, refresh, loadStats]);
  const applied = data?.basic.range ?? { ...filter, level: "basic" };
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
            {demo
              ? "Public demo · sample data"
              : "Only you · Cloudflare Access"}
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
                      ? ""
                      : data
                        ? demo
                          ? "Synthetic data"
                          : `Updated ${new Date(data.basic.receivedAt).toISOString().slice(11, 16)} UTC`
                        : "Awaiting data"}
                </span>
                <button
                  type="button"
                  aria-label="Refresh"
                  title="Refresh"
                  disabled={loading}
                  onClick={() => {
                    setFilter((current) => ({
                      ...current,
                      ...refreshedTimeframe(current),
                    }));
                    setRefresh((current) => current + 1);
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
        {view === "Cloudflare" ? (
          <CloudflarePage
            load={loadCloudflare}
            write={writeCloudflare}
            demo={demo}
          />
        ) : view === "Privacy" ? (
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
