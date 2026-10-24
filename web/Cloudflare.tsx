import { useEffect, useMemo, useRef, useState } from "react";
import {
  allocate,
  alerts,
  DAY,
  emptyData,
  forecast,
  isoDay,
  money,
  validRange,
  type App,
  type CloudflareData,
  type Resource,
} from "../src/cloudflare/model";
import { bytes, number } from "./data";
export type MonitorLoader = (signal: AbortSignal) => Promise<CloudflareData>;
export type SettingsWriter = (value: Record<string, unknown>) => Promise<void>;
type Filters = {
  app: string;
  visibility: string;
  product: string;
  period: string;
  from: string;
  to: string;
  currency: string;
};
const readFilters = (): Filters => {
  const q = new URLSearchParams(location.search);
  return {
    app: q.get("cf_app") || "all",
    visibility: q.get("cf_visibility") || "all",
    product: q.get("cf_product") || "all",
    period: q.get("cf_period") || "current",
    from: q.get("cf_from") || "",
    to: q.get("cf_to") || "",
    currency: q.get("cf_currency") || "USD",
  };
};
const metricNames: Record<string, string> = {
  workerRequests: "Worker requests",
  workerErrors: "Worker errors",
  workerCpuUs: "Worker CPU",
  rowsRead: "D1 rows read",
  rowsWritten: "D1 rows written",
  databaseSizeBytes: "D1 storage peak",
  r2Operations: "R2 operations",
  r2StorageBytes: "R2 storage peak",
  kvOperations: "KV operations",
  doRequests: "DO requests",
  doDuration: "DO duration",
  doRowsRead: "DO rows read",
  doRowsWritten: "DO rows written",
  containerCpuSeconds: "Container CPU",
  containerMemory: "Container memory",
  containerDisk: "Container disk",
  containerEgress: "Container egress",
  queueOperations: "Queue operations",
};
const colors = [
  "var(--accent)",
  "var(--lattice)",
  "var(--fea)",
  "var(--tone-3)",
  "var(--warn)",
  "#98c6b2",
  "#c4a5dd",
];
const formatUsage = (value: number, unit: string) =>
  unit === "bytes"
    ? bytes(value)
    : unit === "microseconds"
      ? `${number(Math.round(value / 1000))} ms`
      : unit === "byte-seconds"
        ? `${number(Math.round((value / 2 ** 30 / 3600) * 100) / 100)} GiB-hours`
        : `${number(Math.round(value * 100) / 100)} ${unit}`;
function matchesProduct(kind: string, product: string) {
  return (
    product === "all" ||
    kind === product ||
    (product === "Workers KV" && kind === "KV")
  );
}
function usageSummary(rows: CloudflareData["usage"]) {
  const sums = new Map<string, { value: number; unit: string }>();
  for (const row of rows)
    if (row.aggregation === "sum") {
      const prior = sums.get(row.metric);
      sums.set(row.metric, {
        value: (prior?.value ?? 0) + row.value,
        unit: row.unit,
      });
    }
  const priorities = [
    "workerRequests",
    "rowsWritten",
    "doDuration",
    "containerCpuSeconds",
    "queueOperations",
  ];
  return (
    [...sums]
      .sort(
        ([a], [b]) =>
          (priorities.indexOf(a) < 0 ? 99 : priorities.indexOf(a)) -
          (priorities.indexOf(b) < 0 ? 99 : priorities.indexOf(b)),
      )
      .slice(0, 2)
      .map(
        ([metric, v]) =>
          `${metricNames[metric] ?? metric}: ${formatUsage(v.value, v.unit)}`,
      )
      .join(" · ") ||
    (rows.length ? "Storage observations available" : "No usage received")
  );
}
function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <strong className="tile-value">{value}</strong>
      <span className="tile-note">{note}</span>
    </div>
  );
}
function AppEditor({
  app,
  save,
  close,
}: {
  app: App;
  save: SettingsWriter;
  close: () => void;
}) {
  const [name, setName] = useState(app.name),
    [visibility, setVisibility] = useState(app.visibility),
    [budget, setBudget] = useState(
      app.budget === null ? "" : String(app.budget / 1e6),
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <form
      className="cf-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
          await save({
            id:
              app.id ||
              `custom:${
                name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .slice(0, 80) || "app"
              }`,
            name,
            visibility,
            budget: budget === "" ? null : Math.round(Number(budget) * 1e6),
          });
          close();
        } catch {
          setError("Could not save app settings. Try again.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <h3>{app.id ? `Edit ${app.name}` : "Add app"}</h3>
      <label>
        App name
        <input
          value={name}
          maxLength={100}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Visibility
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as App["visibility"])}
        >
          <option value="unknown">Not classified</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </label>
      <label>
        Metered usage budget · USD / billing period
        <input
          aria-label="App budget"
          type="number"
          min="0.01"
          max="1000000"
          step="0.01"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="No budget"
        />
      </label>
      <div className="cf-actions">
        <button className="primary" disabled={saving}>
          Save app
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </form>
  );
}
export function CloudflarePage({
  load,
  write,
  demo = false,
}: {
  load?: MonitorLoader;
  write?: SettingsWriter;
  demo?: boolean;
}) {
  const [data, setData] = useState<CloudflareData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [filters, setFilters] = useState(readFilters),
    [editing, setEditing] = useState<App | null>(null),
    [accountBudget, setAccountBudget] = useState(""),
    [saving, setSaving] = useState(false),
    [sort, setSort] = useState("cost");
  const sequence = useRef(0);
  useEffect(() => {
    const restore = () => setFilters(readFilters());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    const id = ++sequence.current,
      controller = new AbortController();
    setLoading(true);
    setError("");
    (load ? load(controller.signal) : Promise.resolve(emptyData()))
      .then((next) => {
        if (id === sequence.current) {
          setData(next);
          setAccountBudget(
            next.budget === null ? "" : String(next.budget / 1e6),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && id === sequence.current)
          setError("Cloudflare data could not be loaded. Try Refresh.");
      })
      .finally(() => {
        if (id === sequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [load, refresh]);
  function apply(next: Partial<Filters>) {
    const updated = { ...filters, ...next };
    setFilters(updated);
    const q = new URLSearchParams(location.search);
    q.set("view", "cloudflare");
    for (const [key, value] of Object.entries(updated))
      if (value) q.set(`cf_${key}`, value);
      else q.delete(`cf_${key}`);
    history.pushState(null, "", `?${q}`);
  }
  const save: SettingsWriter = async (value) => {
    if (demo) {
      setData((current) => {
        if (!current) return current;
        if ("resource" in value)
          return {
            ...current,
            resources: current.resources.map((r) =>
              r.id === value.resource ? { ...r, app: String(value.app) } : r,
            ),
          };
        if ("id" in value) {
          if (!current.apps.some((a) => a.id === value.id))
            return {
              ...current,
              apps: [
                ...current.apps,
                {
                  id: String(value.id),
                  name: String(value.name),
                  visibility: value.visibility as App["visibility"],
                  budget: value.budget as number | null,
                },
              ],
            };
          return {
            ...current,
            apps: current.apps.map((a) =>
              a.id === value.id
                ? {
                    ...a,
                    name: String(value.name),
                    visibility: value.visibility as App["visibility"],
                    budget: value.budget as number | null,
                  }
                : a,
            ),
          };
        }
        return { ...current, budget: value.budget as number | null };
      });
      return;
    }
    if (!write) throw new Error("Settings unavailable");
    await write(value);
    setRefresh((n) => n + 1);
  };
  const now = new Date(),
    currentPeriod = data?.periods.find(
      (p) => p.start <= now.toISOString() && p.end > now.toISOString(),
    );
  const selectedPeriod =
    filters.period === "current"
      ? currentPeriod
      : data?.periods.find((p) => p.start === filters.period);
  const from =
    filters.period === "custom"
      ? filters.from
      : (selectedPeriod?.start.slice(0, 10) ??
        isoDay(new Date(now.getTime() - 29 * DAY)));
  const to =
    filters.period === "custom"
      ? filters.to
      : selectedPeriod
        ? isoDay(
            new Date(
              Math.min(Date.parse(selectedPeriod.end) - DAY, now.getTime()),
            ),
          )
        : isoDay(now);
  const rangeOk = validRange(from, to);
  const selected = useMemo(() => {
    if (!data || !rangeOk)
      return {
        charges: [],
        usage: [],
        resources: [],
        apps: [],
        allocation: new Map<string, number>(),
        families: [] as string[],
      };
    const usage = data.usage.filter((u) => u.day >= from && u.day <= to);
    const accountCharges = data.charges.filter(
      (c) =>
        c.start.slice(0, 10) >= from &&
        c.start.slice(0, 10) <= to &&
        c.currency === filters.currency &&
        (filters.product === "all" || c.family === filters.product),
    );
    const allocation = allocate(accountCharges, usage, data.resources);
    const apps = data.apps.filter(
      (a) =>
        (filters.app === "all" || a.id === filters.app) &&
        (filters.visibility === "all" || a.visibility === filters.visibility),
    );
    const ids = new Set(apps.map((a) => a.id));
    const resources = data.resources.filter((r) => ids.has(r.app));
    return {
      charges: accountCharges,
      usage,
      resources,
      apps,
      allocation,
      families: [...new Set(accountCharges.map((c) => c.family))].sort(),
    };
  }, [
    data,
    from,
    to,
    rangeOk,
    filters.app,
    filters.visibility,
    filters.product,
    filters.currency,
  ]);
  const currency = filters.currency,
    scoped = filters.app !== "all" || filters.visibility !== "all";
  const total = scoped
    ? selected.apps.reduce(
        (n, a) => n + (selected.allocation.get(a.id) ?? 0),
        0,
      )
    : selected.charges.reduce((n, c) => n + c.cost, 0);
  const monthly =
    data?.subscriptions
      .filter((s) => s.currency === currency)
      .reduce(
        (n, s) =>
          n +
          (s.amount === null
            ? 0
            : s.frequency === "monthly"
              ? s.amount
              : s.frequency === "yearly" || s.frequency === "annual"
                ? s.amount / 12
                : 0),
        0,
      ) ?? 0;
  const projection =
    !scoped && selectedPeriod && filters.product === "all"
      ? forecast(selected.charges, selectedPeriod, now)
      : null;
  const warnings = data ? alerts(data, now) : [];
  const apps = [...selected.apps].sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : (selected.allocation.get(b.id) ?? 0) -
          (selected.allocation.get(a.id) ?? 0) || a.name.localeCompare(b.name),
  );
  const accountHasBilling =
    selected.charges.length > 0 &&
    !!data?.coverage.some((c) => c.source === "Billing" && c.lastSuccess);
  const usageByApp = useMemo(() => {
    const owners = new Map(data?.resources.map((r) => [r.id, r]) ?? []);
    const result = new Map<string, CloudflareData["usage"]>();
    for (const u of selected.usage) {
      const owner = owners.get(u.resource);
      if (owner && !matchesProduct(owner.kind, filters.product)) continue;
      const app = owner?.app ?? "unassigned",
        rows = result.get(app) ?? [];
      rows.push(u);
      result.set(app, rows);
    }
    return result;
  }, [data, selected.usage, filters.product]);
  const previousPeriod = data?.periods
    .filter((p) => selectedPeriod && p.start < selectedPeriod.start)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const previousCharges =
    previousPeriod &&
    data?.charges.filter(
      (c) => c.periodStart === previousPeriod.start && c.currency === currency,
    );
  return (
    <div className="content cf-page" aria-busy={loading}>
      <div className="cf-heading">
        <p className="scope">
          Esau infrastructure ·{" "}
          {demo
            ? "Fictional sample data"
            : "Cloudflare-reported costs and resource usage"}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
          {data ? " Showing stale results." : ""}
        </p>
      )}
      {!loading && data && !data.configured && (
        <section className="panel">
          <h2>Connect Esau’s Cloudflare account</h2>
          <p>
            The monitor needs its database migration, an Esau account ID, a
            read-only API token, and collector activation. Existing application
            analytics are independent.
          </p>
          <p className="panel-note">
            Once configured, the scheduled collector discovers apps and stores
            billing and usage here. Opening this page reads stored results.
          </p>
        </section>
      )}
      {data?.configured && (
        <>
          <div className="cf-filters">
            <label>
              App
              <select
                value={filters.app}
                onChange={(e) => apply({ app: e.target.value })}
              >
                <option value="all">All apps</option>
                {data.apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Visibility
              <select
                value={filters.visibility}
                onChange={(e) => apply({ visibility: e.target.value })}
              >
                <option value="all">All visibility</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="unknown">Not classified</option>
              </select>
            </label>
            <label>
              Product
              <select
                value={filters.product}
                onChange={(e) => apply({ product: e.target.value })}
              >
                <option value="all">All products</option>
                {[...new Set(data.charges.map((c) => c.family))]
                  .sort()
                  .map((p) => (
                    <option key={p}>{p}</option>
                  ))}
              </select>
            </label>
            <label>
              Timeframe
              <select
                value={filters.period}
                onChange={(e) => apply({ period: e.target.value })}
              >
                <option value="current">Current billing period</option>
                {data.periods
                  .filter((p) => p.start !== currentPeriod?.start)
                  .map((p) => (
                    <option key={p.start} value={p.start}>
                      {p.start.slice(0, 10)} –{" "}
                      {isoDay(new Date(Date.parse(p.end) - DAY))}
                    </option>
                  ))}
                <option value="custom">Custom dates</option>
              </select>
            </label>
            <label>
              Currency
              <select
                value={currency}
                onChange={(e) => apply({ currency: e.target.value })}
              >
                {[
                  ...new Set([
                    "USD",
                    ...data.charges.map((c) => c.currency),
                    ...data.subscriptions.map((s) => s.currency),
                  ]),
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {filters.period === "custom" && (
              <>
                <label>
                  From · UTC
                  <input
                    type="date"
                    value={filters.from}
                    onChange={(e) => apply({ from: e.target.value })}
                  />
                </label>
                <label>
                  Through · UTC
                  <input
                    type="date"
                    value={filters.to}
                    max={isoDay()}
                    onChange={(e) => apply({ to: e.target.value })}
                  />
                </label>
              </>
            )}
          </div>
          <p className="panel-note">
            {rangeOk
              ? `${from} – ${to} UTC`
              : "Choose a valid UTC range of up to 400 days."}{" "}
            · Billing can lag usage. App costs are allocated estimates; account
            totals come from Cloudflare. Filters on app and visibility affect
            allocations and resources; subscriptions remain account-wide.
          </p>
          <div className="strip">
            <Tile
              label={scoped ? "Allocated usage cost" : "Metered usage cost"}
              value={
                accountHasBilling && rangeOk ? money(total, currency) : "—"
              }
              note={
                previousCharges?.length && !scoped
                  ? `Previous full period ${money(
                      previousCharges.reduce((n, c) => n + c.cost, 0),
                      currency,
                    )}`
                  : "Selected dates · excluding subscriptions and tax"
              }
            />
            <Tile
              label="Fixed subscriptions"
              value={
                data.coverage.some(
                  (c) => c.source === "Subscriptions" && c.lastSuccess,
                )
                  ? money(monthly, currency)
                  : "—"
              }
              note="Account-wide monthly equivalent · current plans"
            />
            <Tile
              label="Projected metered cost"
              value={projection === null ? "—" : money(projection, currency)}
              note="Period-end estimate · needs 3 reported days"
            />
            <Tile
              label="Account budget remaining"
              value={
                data.budget && currentPeriod && currency === "USD"
                  ? money(
                      data.budget -
                        data.charges
                          .filter(
                            (c) =>
                              c.periodStart === currentPeriod.start &&
                              c.currency === "USD",
                          )
                          .reduce((n, c) => n + c.cost, 0),
                    )
                  : "—"
              }
              note="USD metered-usage budget · current billing period"
            />
          </div>
          {warnings.length > 0 && (
            <section
              className="panel cf-alerts"
              aria-label="Cost and collection alerts"
            >
              <h2>Needs attention</h2>
              <ul>
                {warnings.map((w) => (
                  <li
                    key={w.id}
                    className={
                      w.severity === "error" ? "error-message" : "warn-text"
                    }
                  >
                    {w.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rangeOk && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Daily metered cost by product</h2>
                  <span className="panel-meta">
                    Cloudflare reported · {currency}
                  </span>
                </div>
                {scoped ? (
                  <p className="empty">
                    Daily billing is account-wide. The app table below shows
                    allocated costs for this selection.
                  </p>
                ) : (
                  <DailySpend charges={selected.charges} currency={currency} />
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Product usage and cost</h2>
                  <span className="panel-meta">
                    Account-wide · selected dates · {currency}
                  </span>
                </div>
                <ProductUsage charges={selected.charges} currency={currency} />
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Applications</h2>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        id: "",
                        name: "",
                        visibility: "private",
                        budget: null,
                      })
                    }
                  >
                    Add app
                  </button>
                  <label>
                    Sort apps{" "}
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="cost">Allocated cost</option>
                      <option value="name">Name</option>
                    </select>
                  </label>
                </div>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Application usage and cost"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>App</th>
                        <th>Visibility</th>
                        <th>Resources</th>
                        <th>Allocated cost</th>
                        <th>Usage observed</th>
                        <th>Budget · USD</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apps.map((a) => {
                        const usage = usageByApp.get(a.id) ?? [];
                        return (
                          <tr key={a.id}>
                            <td>{a.name}</td>
                            <td>
                              {a.visibility === "unknown"
                                ? "Not classified"
                                : a.visibility}
                            </td>
                            <td className="numeric">
                              {
                                data.resources.filter(
                                  (r) => r.app === a.id && r.active,
                                ).length
                              }
                            </td>
                            <td className="numeric">
                              {accountHasBilling
                                ? money(
                                    selected.allocation.get(a.id) ?? 0,
                                    currency,
                                  )
                                : "—"}
                            </td>
                            <td>{usageSummary(usage)}</td>
                            <td>{a.budget ? money(a.budget) : "—"}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() => apply({ app: a.id })}
                              >
                                Inspect
                              </button>
                              {!["unassigned", "shared"].includes(a.id) && (
                                <button
                                  type="button"
                                  onClick={() => setEditing(a)}
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="panel-note">
                  Allocation uses matching resource metrics after account
                  allowances are reflected in reported charges. Shared and
                  unsupported costs stay visible. A zero allocation does not
                  establish zero standalone hosting cost.
                </p>
                {editing && (
                  <AppEditor
                    key={editing.id}
                    app={editing}
                    save={save}
                    close={() => setEditing(null)}
                  />
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Resource usage</h2>
                  <span className="panel-meta">
                    Aggregated Cloudflare analytics · may be sampled
                  </span>
                </div>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Resource usage and ownership"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Resource</th>
                        <th>Product</th>
                        <th>App assignment</th>
                        <th>Usage in selected dates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.resources
                        .filter(
                          (r) =>
                            filters.product === "all" ||
                            r.kind === filters.product ||
                            (filters.product === "Workers KV" &&
                              r.kind === "KV"),
                        )
                        .map((r) => (
                          <ResourceRow
                            key={r.id}
                            resource={r}
                            data={data}
                            usage={selected.usage}
                            save={save}
                          />
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          <div className="grid-2">
            <section className="panel">
              <h2>Fixed subscriptions</h2>
              <p className="panel-note">
                Current recurring fees, separate from metered charges. Annual
                fees show their renewal amount; monthly equivalents support
                planning. Invoice tax, credits, and one-time charges can differ.
              </p>
              <div
                className="table-scroll"
                role="region"
                aria-label="Subscriptions"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>Amount</th>
                      <th>Cycle</th>
                      <th>Renews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.subscriptions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>
                          {s.amount === null
                            ? "Unavailable"
                            : money(s.amount, s.currency)}
                        </td>
                        <td>{s.frequency}</td>
                        <td>{s.renews?.slice(0, 10) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <h2>Budget monitoring</h2>
              <p className="panel-note">
                Budgets monitor metered usage in USD. Warnings appear at 80% and
                100%, for projected overspend, and for daily spikes above $5 and
                twice the recent average. Notifications can use a separately
                configured webhook.
              </p>
              <form
                className="cf-budget"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaving(true);
                  try {
                    await save({
                      budget:
                        accountBudget === ""
                          ? null
                          : Math.round(Number(accountBudget) * 1e6),
                    });
                    setError("");
                  } catch {
                    setError("Could not save budget. Try again.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <label>
                  Esau budget · USD / billing period
                  <input
                    aria-label="Account budget"
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={accountBudget}
                    onChange={(e) => setAccountBudget(e.target.value)}
                    placeholder="No budget"
                  />
                </label>
                <button disabled={saving}>Save budget</button>
              </form>
            </section>
          </div>
          <section className="panel">
            <h2>Collection coverage</h2>
            <div
              className="table-scroll"
              role="region"
              aria-label="Cloudflare API coverage"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Last successful collection · UTC</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.coverage.map((c) => (
                    <tr key={c.source}>
                      <td>{c.source}</td>
                      <td
                        className={c.status === "ok" ? undefined : "warn-text"}
                      >
                        {c.status}
                      </td>
                      <td>
                        {c.lastSuccess?.replace("T", " ").slice(0, 19) ??
                          "Never"}
                      </td>
                      <td>{c.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.coverage.length && (
              <p className="empty">
                Waiting for the first scheduled collection.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function ProductUsage({
  charges,
  currency,
}: {
  charges: CloudflareData["charges"];
  currency: string;
}) {
  const grouped = new Map<
    string,
    {
      family: string;
      description: string;
      unit: string;
      quantity: number;
      cost: number;
    }
  >();
  for (const c of charges) {
    const key = JSON.stringify([c.family, c.description, c.unit]),
      prior = grouped.get(key);
    grouped.set(key, {
      family: c.family,
      description: c.description,
      unit: c.unit,
      quantity: (prior?.quantity ?? 0) + c.quantity,
      cost: (prior?.cost ?? 0) + c.cost,
    });
  }
  const rows = [...grouped.values()].sort(
    (a, b) => b.cost - a.cost || a.description.localeCompare(b.description),
  );
  return (
    <>
      <p className="panel-note">
        Quantities and usage charges as reported by Cloudflare. Included usage
        is reflected in costs; subscription fees are separate.
      </p>
      <div
        className="table-scroll tall"
        role="region"
        aria-label="Product usage and costs"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Metric</th>
              <th>Reported quantity</th>
              <th>Usage cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.family}:${r.description}:${r.unit}`}>
                <td>{r.family}</td>
                <td>{r.description}</td>
                <td className="numeric">
                  {number(r.quantity)} {r.unit}
                </td>
                <td className="numeric">{money(r.cost, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="empty">No billing quantities received for these dates.</p>
      )}
    </>
  );
}
function ResourceRow({
  resource: r,
  data,
  usage,
  save,
}: {
  resource: Resource;
  data: CloudflareData;
  usage: CloudflareData["usage"];
  save: SettingsWriter;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const values = new Map<
    string,
    { value: number; unit: string; aggregation: string }
  >();
  for (const u of usage)
    if (u.resource === r.id) {
      const prior = values.get(u.metric);
      values.set(u.metric, {
        ...u,
        value: prior
          ? u.aggregation === "sum"
            ? prior.value + u.value
            : Math.max(prior.value, u.value)
          : u.value,
      });
    }
  return (
    <tr>
      <td>
        {r.dashboardUrl ? (
          <a href={r.dashboardUrl} target="_blank" rel="noreferrer">
            {r.name} ↗
          </a>
        ) : (
          r.name
        )}
        {!r.active && <span className="muted"> · no longer discovered</span>}
      </td>
      <td>{r.kind}</td>
      <td>
        <select
          aria-label={`App for ${r.name}`}
          value={r.app}
          disabled={busy}
          onChange={async (e) => {
            const app = e.target.value;
            setBusy(true);
            setError("");
            try {
              await save({ resource: r.id, app });
            } catch {
              setError("Assignment not saved.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {data.apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </td>
      <td>
        {values.size ? (
          <ul className="cf-metrics">
            {[...values].map(([metric, u]) => (
              <li key={metric}>
                <span>{metricNames[metric] ?? metric}</span>
                <span className="numeric">{formatUsage(u.value, u.unit)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted">No usage received in this range</span>
        )}
      </td>
    </tr>
  );
}
function DailySpend({
  charges,
  currency,
}: {
  charges: CloudflareData["charges"];
  currency: string;
}) {
  const families = [...new Set(charges.map((c) => c.family))].sort();
  const daily = new Map<string, Map<string, number>>();
  for (const c of charges) {
    const day = c.start.slice(0, 10),
      values = daily.get(day) ?? new Map<string, number>();
    values.set(c.family, (values.get(c.family) ?? 0) + c.cost);
    daily.set(day, values);
  }
  const rows = [...daily].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(
    1,
    ...rows.map(([, v]) =>
      [...v.values()].reduce((a, b) => a + Math.max(0, b), 0),
    ),
  );
  if (!rows.length)
    return <p className="empty">No billing data received for these dates.</p>;
  return (
    <>
      <div
        className="cf-spend"
        role="img"
        aria-label="Daily costs stacked by product. Exact values and corrections are in the data table below."
      >
        {rows.map(([day, values]) => (
          <div className="cf-spend-row" key={day}>
            <span>{day.slice(5)}</span>
            <div className="cf-spend-track">
              {families.map((family, i) => (
                <i
                  key={family}
                  style={{
                    width: `${(Math.max(0, values.get(family) ?? 0) / max) * 100}%`,
                    background: colors[i % colors.length],
                  }}
                />
              ))}
            </div>
            <span className="numeric">
              {money(
                [...values.values()].reduce((a, b) => a + b, 0),
                currency,
              )}
            </span>
          </div>
        ))}
      </div>
      <ul className="legend">
        {families.map((family, i) => (
          <li key={family}>
            <span
              className="swatch"
              style={{ background: colors[i % colors.length] }}
            />
            {family}
          </li>
        ))}
      </ul>
      <details className="data-disclosure">
        <summary>Data table · UTC</summary>
        <div
          className="table-scroll"
          role="region"
          aria-label="Daily Cloudflare cost data"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Day</th>
                {families.map((f) => (
                  <th key={f}>{f}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([day, v]) => (
                <tr key={day}>
                  <td>{day}</td>
                  {families.map((f) => (
                    <td className="numeric" key={f}>
                      {money(v.get(f) ?? 0, currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
