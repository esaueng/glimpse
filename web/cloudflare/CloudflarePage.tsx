import { useEffect, useMemo, useRef, useState } from "react";
import {
  allocate,
  alerts,
  DAY,
  emptyData,
  forecast,
  isoDay,
  validRange,
  type App,
  type CloudflareData,
} from "../../src/cloudflare/model";
import { AppEditor } from "./AppEditor";
import { AppsTable, ResourceTable } from "./apps";
import { DailySpend } from "./chart";
import { FilterBar, type Apply } from "./FilterBar";
import {
  readFilters,
  sameFilters,
  sanitizeFilters,
  writeFilters,
} from "./filters";
import { formatDayRange, formatMoney } from "./format";
import { CoverageTable, ProductUsage, SubscriptionsTable } from "./tables";
import type { MonitorLoader, SettingsWriter } from "./types";
import { applyDemoSetting, matchesProduct } from "./usage";
import "./cloudflare.css";

export type { MonitorLoader, SettingsWriter } from "./types";

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

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
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
    [requested, setFilters] = useState(readFilters),
    [editing, setEditing] = useState<{
      app: App;
      invoker: HTMLElement | null;
    } | null>(null),
    [accountBudget, setAccountBudget] = useState(""),
    [saving, setSaving] = useState(false),
    [sort, setSort] = useState("cost");
  const sequence = useRef(0),
    addButton = useRef<HTMLButtonElement>(null);
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

  const now = new Date(),
    currentPeriod = data?.periods.find(
      (p) => p.start <= now.toISOString() && p.end > now.toISOString(),
    );
  // URL values are untrusted: only values present in the data are used, and the
  // URL is rewritten in place to match what is shown.
  const filters = useMemo(
    () =>
      data ? sanitizeFilters(requested, data, currentPeriod?.start) : requested,
    [requested, data, currentPeriod?.start],
  );
  useEffect(() => {
    if (data && !sameFilters(filters, requested)) {
      setFilters(filters);
      writeFilters(filters, "replace");
    }
  }, [data, filters, requested]);
  const apply: Apply = (next, mode = "push") => {
    const updated = { ...filters, ...next };
    setFilters(updated);
    writeFilters(updated, mode);
  };
  const save: SettingsWriter = async (value) => {
    if (demo) {
      setData((current) => current && applyDemoSetting(current, value));
      return;
    }
    if (!write) throw new Error("Settings unavailable");
    await write(value);
    setRefresh((n) => n + 1);
  };

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
    return { charges: accountCharges, usage, resources, apps, allocation };
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
  const status = loading
    ? "Loading…"
    : error || !data
      ? ""
      : demo
        ? "Sample data"
        : `Updated ${new Date(data.receivedAt).toISOString().slice(11, 16)} UTC`;
  return (
    <div className="content cf-page" aria-busy={loading}>
      <div className="cf-heading">
        <p className="scope">
          Esau infrastructure ·{" "}
          {demo
            ? "Fictional sample data"
            : "Cloudflare-reported costs and resource usage"}
        </p>
        <div className="refresh">
          <span className="status" role="status" aria-live="polite">
            {status}
          </span>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            aria-disabled={loading || undefined}
            onClick={() => {
              if (!loading) setRefresh((n) => n + 1);
            }}
          >
            <RefreshIcon />
          </button>
        </div>
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
          {data.coverage.length > 0 && (
            <>
              <h3>Scheduled jobs</h3>
              <CoverageTable coverage={data.coverage} />
            </>
          )}
        </section>
      )}
      {data?.configured && (
        <>
          <FilterBar
            data={data}
            filters={filters}
            apply={apply}
            currentStart={currentPeriod?.start}
          />
          <p className="panel-note">
            {rangeOk
              ? `${formatDayRange(from, to)} UTC`
              : "Choose a valid UTC range of up to 400 days."}{" "}
            · Billing can lag usage. App costs are allocated estimates; account
            totals come from Cloudflare. Filters on app and visibility affect
            allocations and resources; subscriptions remain account-wide.
          </p>
          <div className="strip">
            <Tile
              label={scoped ? "Allocated usage cost" : "Metered usage cost"}
              value={
                accountHasBilling && rangeOk
                  ? formatMoney(total, currency)
                  : "—"
              }
              note={
                previousCharges?.length && !scoped
                  ? `Previous full period ${formatMoney(
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
                  ? formatMoney(monthly, currency)
                  : "—"
              }
              note="Account-wide monthly equivalent · current plans"
            />
            <Tile
              label="Projected metered cost"
              value={
                projection === null ? "—" : formatMoney(projection, currency)
              }
              note="Period-end estimate · needs 3 reported days"
            />
            <Tile
              label="Account budget remaining"
              value={
                data.budget && currentPeriod && currency === "USD"
                  ? formatMoney(
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
                  <div className="cf-panel-actions">
                    <button
                      type="button"
                      ref={addButton}
                      onClick={(e) =>
                        setEditing({
                          app: {
                            id: "",
                            name: "",
                            visibility: "private",
                            budget: null,
                          },
                          invoker: e.currentTarget,
                        })
                      }
                    >
                      Add app
                    </button>
                    <label className="app-select cf-inline-label">
                      Sort apps
                      <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="cost">Allocated cost</option>
                        <option value="name">Name</option>
                      </select>
                    </label>
                  </div>
                </div>
                <AppsTable
                  apps={apps}
                  data={data}
                  allocation={selected.allocation}
                  usageByApp={usageByApp}
                  billed={accountHasBilling}
                  currency={currency}
                  activeApp={filters.app}
                  setApp={(app) => apply({ app })}
                  edit={(app, invoker) => setEditing({ app, invoker })}
                />
                <p className="panel-note">
                  Allocation uses matching resource metrics after account
                  allowances are reflected in reported charges. Shared and
                  unsupported costs stay visible. A zero allocation does not
                  establish zero standalone hosting cost.
                </p>
                {editing && (
                  <AppEditor
                    key={editing.app.id}
                    app={editing.app}
                    save={save}
                    close={() => setEditing(null)}
                    restoreFocus={() => {
                      const target = editing.invoker?.isConnected
                        ? editing.invoker
                        : addButton.current;
                      target?.focus();
                    }}
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
                <ResourceTable
                  resources={selected.resources.filter((r) =>
                    matchesProduct(r.kind, filters.product),
                  )}
                  data={data}
                  usage={selected.usage}
                  save={save}
                />
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
              <SubscriptionsTable subscriptions={data.subscriptions} />
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
                  if (saving) return;
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
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={accountBudget}
                    onChange={(e) => setAccountBudget(e.target.value)}
                    placeholder="No budget"
                  />
                </label>
                <button aria-disabled={saving || undefined}>
                  {saving ? "Saving…" : "Save budget"}
                </button>
              </form>
            </section>
          </div>
          <section className="panel">
            <h2>Collection coverage</h2>
            <CoverageTable coverage={data.coverage} />
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
