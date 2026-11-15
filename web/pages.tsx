// Home, Performance and Sources: the monitoring pages built on the daily aggregates.
import { APPS, BUCKETS, type App } from "../src/contract";
import { DataTable, LineChart, Sparkline, StackBar, shortDay, timingLabels, type Tone } from "./charts";
import {
  appName,
  bucketCounts,
  bytes,
  censusHistory,
  dailySeries,
  latestCensus,
  number,
  percent,
  total,
  type Loaded,
} from "./data";
import {
  appHealth,
  attention,
  ERROR_RATE,
  SLOW_SHARE,
  statusLabel,
  type AppHealth,
  type Attention,
} from "./health";
import { SlowOperations } from "./views";
import { Panel, Tile } from "./ui";

export type Navigate = (view: string, app?: string) => void;

const appTone: Record<App, Tone> = { openzcad: "accent", openfea: "fea", openlattice3d: "lattice" };
const timingTones: Tone[] = ["accent", "tone-2", "tone-3", "warn", "error"];
const inScope = (scope: string) => APPS.filter((a) => scope === "all" || scope === a);
const share = (value: number | null, digits = 1) => (value === null ? "—" : percent(value, 1, digits));

export function StatusPill({ status }: { status: AppHealth["status"] }) {
  return (
    <span className={`status-pill ${status}`}>
      <i aria-hidden="true" />
      {statusLabel[status]}
    </span>
  );
}

function HealthCard({ health, onOpen }: { health: AppHealth; onOpen: () => void }) {
  const { app } = health;
  return (
    <article className={`health-card ${health.status}`} aria-labelledby={`health-${app}`}>
      <header>
        <h3 id={`health-${app}`} className="app-name">
          <span className={`swatch ${app}`} />
          {appName(app)}
        </h3>
        <StatusPill status={health.status} />
        <button type="button" className="icon-link" onClick={onOpen} title="Performance">
          <span aria-hidden="true">→</span>
          <span className="sr-only">{appName(app)} performance</span>
        </button>
      </header>
      <div className="health-main">
        <div>
          <span className="tile-label">API requests</span>
          <strong className="tile-value">{number(health.requests)}</strong>
        </div>
        <Sparkline label={`${appName(app)} requests per day`} values={health.dailyRequests} tone={appTone[app]} />
      </div>
      <dl className="health-stats">
        <div>
          <dt>Server errors</dt>
          <dd className={health.errorRate !== null && health.errorRate >= ERROR_RATE.degraded ? "bad" : undefined}>
            {share(health.errorRate, 2)}
          </dd>
        </div>
        <div>
          <dt>Over 1 s</dt>
          <dd className={health.slowShare !== null && health.slowShare >= SLOW_SHARE ? "bad" : undefined}>
            {share(health.slowShare)}
          </dd>
        </div>
        <div>
          <dt>Diagnostics*</dt>
          <dd>{number(health.diagnostics)}</dd>
        </div>
      </dl>
    </article>
  );
}

const severityLabel: Record<Attention["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Note",
};

function AttentionList({ items, navigate, app }: { items: Attention[]; navigate: Navigate; app: string }) {
  if (!items.length)
    return (
      <p className="all-clear">
        <span aria-hidden="true">✓</span> All clear
      </p>
    );
  return (
    <ul className="attention">
      {items.map((item) => (
        <li key={item.id} className={item.severity}>
          <span className={`severity ${item.severity}`}>{severityLabel[item.severity]}</span>
          <div>
            <strong>{item.title}</strong>
            <span className="muted small">{item.detail}</span>
          </div>
          <button
            type="button"
            className="icon-link"
            title={item.view === "sources" ? "Sources" : item.view === "performance" ? "Performance" : "Issues"}
            onClick={() => navigate(item.view, item.app ?? app)}
          >
            <span aria-hidden="true">→</span>
            <span className="sr-only">Open {item.view} for {item.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Home({ data, app, navigate }: { data: Loaded; app: string; navigate: Navigate }) {
  const apps = inScope(app),
    health = apps.map((a) => appHealth(data, a)),
    items = attention(data, app),
    optional = data.optional.rows,
    census = app === "all" || app === "openzcad" ? latestCensus(data.optional.census) : undefined,
    series = dailySeries(data.basic, "api_request"),
    errorSeries = dailySeries(data.basic, "api_error"),
    days = series.map((d) => d.day);
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const i of items) counts[i.severity]++;
  return (
    <>
      <section className="section" aria-labelledby="health-heading">
        <div className="section-heading">
          <h2 id="health-heading" className="section-title">
            App health
          </h2>
          <span className="muted small">
            Degraded ≥{percent(ERROR_RATE.degraded, 1, 0)} errors or ≥{percent(SLOW_SHARE, 1, 0)} over 1 s · Failing ≥
            {percent(ERROR_RATE.failing, 1, 0)} errors · *opted-in users
          </span>
        </div>
        <div className="health-grid">
          {health.map((h) => (
            <HealthCard key={h.app} health={h} onOpen={() => navigate("performance", h.app)} />
          ))}
        </div>
      </section>

      <div className="split">
        <Panel
          title="Needs attention"
          className="wide"
          note={
            items.length
              ? [
                  counts.critical && `${counts.critical} critical`,
                  counts.warning && `${counts.warning} warning${counts.warning > 1 ? "s" : ""}`,
                  counts.info && `${counts.info} note${counts.info > 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        >
          <AttentionList items={items} navigate={navigate} app={app} />
        </Panel>
        <Panel title="At a glance" className="narrow" note={<span className="badge">Opted-in users</span>}>
          <dl className="glance">
            <div>
              <dt>Workspaces opened</dt>
              <dd>{number(total(optional, "workspace_opened"))}</dd>
            </div>
            <div>
              <dt>Exports</dt>
              <dd>{number(total(optional, "export_completed"))}</dd>
            </div>
            <div>
              <dt>Cloud accounts</dt>
              <dd>{census ? number(census.accounts) : app === "all" || app === "openzcad" ? "—" : "N/A"}</dd>
            </div>
            <div>
              <dt>Cloud storage</dt>
              <dd>{census ? bytes(census.storedBytes) : app === "all" || app === "openzcad" ? "—" : "N/A"}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel title="Traffic and server errors" note="All users · per UTC day">
        <div className="grid-2 charts">
          <div>
            <div className="chart-title">
              <span>API requests</span>
            </div>
            <LineChart
              label="API requests per day"
              days={days}
              height={160}
              series={apps.map((a) => ({ name: appName(a), values: series.map((d) => d[a]), tone: appTone[a] }))}
            />
          </div>
          <div>
            <div className="chart-title">
              <span>Server errors (5xx)</span>
            </div>
            <LineChart
              label="Server errors per day"
              days={days}
              height={160}
              peak
              series={[
                {
                  name: "Server errors",
                  values: errorSeries.map((d) => apps.reduce((n, a) => n + d[a], 0)),
                  tone: "error",
                },
              ]}
            />
          </div>
        </div>
      </Panel>
    </>
  );
}

export function Performance({ data, app }: { data: Loaded; app: string }) {
  const apps = inScope(app),
    basic = data.basic.rows,
    requests = total(basic, "api_request"),
    errors = total(basic, "api_error"),
    series = dailySeries(data.basic, "api_request"),
    errorSeries = dailySeries(data.basic, "api_error"),
    days = series.map((d) => d.day),
    latency = apps.map((a) => ({ app: a, values: bucketCounts(basic, "api_latency", BUCKETS, a) })),
    all = latency.reduce((sum, l) => sum.map((v, i) => v + (l.values[i] ?? 0)), [0, 0, 0, 0, 0]),
    timed = all.reduce((n, v) => n + v, 0);
  // Daily error rate in percent; days without requests stay at zero rather than invented.
  const rate = series.map((d, i) => {
    const req = apps.reduce((n, a) => n + d[a], 0),
      err = apps.reduce((n, a) => n + errorSeries[i]![a], 0);
    return req ? (err / req) * 100 : 0;
  });
  return (
    <>
      <section className="strip" aria-label="Performance summary">
        <Tile label="API requests" value={number(requests)}>
          {number(Math.round(requests / Math.max(1, days.length)))} per day · all users
        </Tile>
        <Tile label="Server error rate" value={percent(errors, requests, 2)}>
          {number(errors)} errors (5xx)
        </Tile>
        <Tile label="Under 100 ms" value={percent(all[0] ?? 0, timed)}>
          Of timed API requests
        </Tile>
        <Tile label="1 s or more" value={percent((all[2] ?? 0) + (all[3] ?? 0) + (all[4] ?? 0), timed)}>
          Of timed API requests
        </Tile>
      </section>

      <Panel title="Requests and error rate" note="All users · per UTC day">
        <div className="grid-2 charts">
          <div>
            <div className="chart-title">
              <span>API requests by app</span>
            </div>
            <LineChart
              label="API requests per day by app"
              days={days}
              height={180}
              series={apps.map((a) => ({ name: appName(a), values: series.map((d) => d[a]), tone: appTone[a] }))}
            />
          </div>
          <div>
            <div className="chart-title">
              <span>Server error rate</span>
            </div>
            <LineChart
              label="Server error rate per day"
              days={days}
              height={180}
              peak
              format={(v) => `${v.toFixed(v && v < 1 ? 2 : 1)}%`}
              series={[{ name: "Error rate", values: rate, tone: "error" }]}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="API response time by app"
        note="Coarse ranges · all users"
      >
        <ul className="slow-list">
          {latency.map(({ app: a, values }) => {
            const sum = values.reduce((n, v) => n + v, 0),
              slow = (values[2] ?? 0) + (values[3] ?? 0) + (values[4] ?? 0);
            return (
              <li key={a}>
                <span className="app-name small-name">
                  <span className={`swatch ${a}`} />
                  {appName(a)}
                </span>
                <StackBar
                  legend={false}
                  label={`${appName(a)} API response time`}
                  segments={values.map((value, i) => ({ name: timingLabels[i]!, value, tone: timingTones[i]! }))}
                />
                <span className="slow-share">
                  <span className="numeric">{sum ? percent(slow, sum) : "—"}</span>{" "}
                  <span className="muted small">≥1 s</span>
                </span>
              </li>
            );
          })}
        </ul>
        <DataTable label="API response time by app">
          <table>
            <thead>
              <tr>
                <th>App</th>
                {timingLabels.map((name) => (
                  <th key={name} className="numeric">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {latency.map(({ app: a, values }) => (
                <tr key={a}>
                  <td>{appName(a)}</td>
                  {values.map((v, i) => (
                    <td key={i} className="numeric">
                      {number(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Panel>

      <SlowOperations data={data} app={app} />
    </>
  );
}

type Source = {
  name: string;
  kind: string;
  detail: string;
  state: "live" | "quiet" | "elsewhere" | "planned";
  status: string;
  action?: { label: string; view: string };
};

const stateLabel: Record<Source["state"], string> = {
  live: "Receiving",
  quiet: "No data in range",
  elsewhere: "Connected",
  planned: "Planned",
};

function SourceList({ sources, navigate }: { sources: Source[]; navigate: Navigate }) {
  return (
    <ul className="sources">
      {sources.map((s) => (
        <li key={s.name} className={s.state}>
          <div className="source-main">
            <strong>{s.name}</strong>
            <span className="muted small">{s.detail}</span>
          </div>
          <span className="source-kind">{s.kind}</span>
          <span className={`source-state ${s.state}`}>
            <i aria-hidden="true" />
            {stateLabel[s.state]}
            {s.status && <span className="muted small">{s.status}</span>}
          </span>
          {s.action ? (
            <button type="button" className="icon-link" title={s.action.label} onClick={() => navigate(s.action!.view)}>
              <span aria-hidden="true">→</span>
              <span className="sr-only">Open {s.action.label}</span>
            </button>
          ) : (
            <span />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Expects data for all apps: the dashboard ignores the app filter on this page. */
export function Sources({ data, navigate }: { data: Loaded; navigate: Navigate }) {
  const last = (app: App) => {
    const days = [...data.basic.rows, ...data.optional.rows].filter((r) => r.app === app).map((r) => r.day).sort();
    return days.at(-1);
  };
  const snapshots = censusHistory(data.optional.census),
    snapshot = snapshots.at(-1)?.day;
  const connected: Source[] = [
    ...APPS.map((a): Source => {
      const day = last(a);
      return {
        name: `${appName(a)} analytics`,
        kind: "Service binding · push",
        detail: "API counters; opt-in product counts",
        state: day ? "live" : "quiet",
        status: day ? shortDay(day) : "",
        action: { label: "Usage", view: "usage" },
      };
    }),
    {
      name: "OpenZCAD cloud snapshots",
      kind: "Service binding · hourly",
      detail: "Account and storage totals",
      state: snapshot ? "live" : "quiet",
      status: snapshot ? shortDay(snapshot) : "",
      action: { label: "Storage", view: "storage" },
    },
    {
      name: "Cloudflare usage and billing",
      kind: "Scheduled pull · hourly",
      detail: "Costs and resource usage",
      state: "elsewhere",
      status: "",
      action: { label: "Costs", view: "costs" },
    },
  ];
  const planned: Source[] = [
    {
      name: "Cloudflare Workers Issues",
      kind: "Webhook · push",
      detail: "Grouped Worker errors and scans",
      state: "planned",
      status: "",
    },
    {
      name: "Worker performance",
      kind: "Scheduled pull",
      detail: "Requests, errors, CPU per Worker",
      state: "planned",
      status: "",
    },
    {
      name: "Deployments and Workers Builds",
      kind: "Scheduled pull",
      detail: "Deploy markers, failed builds",
      state: "planned",
      status: "",
    },
    {
      name: "GitHub",
      kind: "Webhook · push",
      detail: "Failed Actions, Dependabot alerts",
      state: "planned",
      status: "",
    },
    {
      name: "Uptime checks",
      kind: "Scheduled probe",
      detail: "Health endpoint probes",
      state: "planned",
      status: "",
    },
    {
      name: "Agent access (MCP)",
      kind: "MCP · Access OAuth",
      detail: "Claude and Codex read health and issues",
      state: "planned",
      status: "",
    },
    {
      name: "Custom source",
      kind: "Signed webhook",
      detail: "Any service, own secret",
      state: "planned",
      status: "",
    },
  ];
  return (
    <>
      <Panel title="Connected" note="Latest data in range">
        <SourceList sources={connected} navigate={navigate} />
      </Panel>
      <Panel title="Planned">
        <SourceList sources={planned} navigate={navigate} />
      </Panel>
    </>
  );
}
