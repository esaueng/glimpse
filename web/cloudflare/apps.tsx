import { useLayoutEffect, useRef, useState } from "react";
import type {
  App,
  CloudflareData,
  Resource,
} from "../../src/cloudflare/model";
import { formatMoney, formatUsage, metricNames } from "./format";
import { visibilityLabels } from "./filters";
import { CfTable, Cell, Row } from "./table";
import type { SettingsWriter } from "./types";
import { resourceMetrics, usageSummary } from "./usage";

const fixedApps = ["unassigned", "shared"];

export function AppsTable({
  apps,
  data,
  allocation,
  usageByApp,
  billed,
  currency,
  activeApp,
  setApp,
  edit,
}: {
  apps: App[];
  data: CloudflareData;
  allocation: Map<string, number>;
  usageByApp: Map<string, CloudflareData["usage"]>;
  billed: boolean;
  currency: string;
  activeApp: string;
  setApp: (app: string) => void;
  edit: (app: App, invoker: HTMLElement) => void;
}) {
  // Filtering re-renders the page above this table; keep the toggled row where
  // it was on screen and keep focus on its (relabelled) button.
  const anchor = useRef<{ id: string; top: number } | null>(null),
    wrapper = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pending = anchor.current;
    if (!pending) return;
    anchor.current = null;
    const button = wrapper.current?.querySelector<HTMLButtonElement>(
      `tr[data-app="${CSS.escape(pending.id)}"] .cf-filter-toggle`,
    );
    if (!button) return;
    window.scrollBy(0, button.getBoundingClientRect().top - pending.top);
    button.focus({ preventScroll: true });
  });
  return (
    <div ref={wrapper}>
      <CfTable
        label="Application usage and cost"
        columns={[
          { label: "App" },
          { label: "Visibility" },
          { label: "Resources", numeric: true },
          { label: "Allocated cost", numeric: true },
          { label: "Usage observed" },
          { label: "Budget · USD", numeric: true },
          { label: "Actions" },
        ]}
      >
        {apps.map((a) => {
          const filtered = activeApp === a.id;
          return (
            <Row key={a.id} app={a.id}>
              <Cell label="App" kind="title">
                {a.name}
              </Cell>
              <Cell label="Visibility">{visibilityLabels[a.visibility]}</Cell>
              <Cell label="Resources" numeric>
                {
                  data.resources.filter((r) => r.app === a.id && r.active)
                    .length
                }
              </Cell>
              <Cell label="Allocated cost" numeric>
                {billed
                  ? formatMoney(allocation.get(a.id) ?? 0, currency)
                  : "—"}
              </Cell>
              <Cell label="Usage observed" kind="stack">
                {usageSummary(usageByApp.get(a.id) ?? [])}
              </Cell>
              <Cell label="Budget · USD" numeric>
                {a.budget ? formatMoney(a.budget) : "—"}
              </Cell>
              <Cell label="Actions" kind="buttons">
                <button
                  type="button"
                  className="cf-filter-toggle"
                  onClick={(e) => {
                    anchor.current = {
                      id: a.id,
                      top: e.currentTarget.getBoundingClientRect().top,
                    };
                    setApp(filtered ? "all" : a.id);
                  }}
                >
                  {filtered ? (
                    <>
                      Show all apps
                      <span className="sr-only">, now showing {a.name}</span>
                    </>
                  ) : (
                    <>
                      Filter to app<span className="sr-only">: {a.name}</span>
                    </>
                  )}
                </button>
                {!fixedApps.includes(a.id) && (
                  <button
                    type="button"
                    onClick={(e) => edit(a, e.currentTarget)}
                  >
                    Edit<span className="sr-only"> {a.name}</span>
                  </button>
                )}
              </Cell>
            </Row>
          );
        })}
      </CfTable>
    </div>
  );
}

export function ResourceTable({
  resources,
  data,
  usage,
  save,
}: {
  resources: Resource[];
  data: CloudflareData;
  usage: CloudflareData["usage"];
  save: SettingsWriter;
}) {
  return (
    <CfTable
      label="Resource usage and ownership"
      columns={[
        { label: "Resource" },
        { label: "Product" },
        { label: "App assignment" },
        { label: "Usage in selected dates" },
      ]}
    >
      {resources.map((r) => (
        <ResourceRow
          key={r.id}
          resource={r}
          apps={data.apps}
          usage={usage}
          save={save}
        />
      ))}
    </CfTable>
  );
}

function ResourceRow({
  resource: r,
  apps,
  usage,
  save,
}: {
  resource: Resource;
  apps: App[];
  usage: CloudflareData["usage"];
  save: SettingsWriter;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const values = resourceMetrics(r.id, usage);
  return (
    <Row>
      <Cell label="Resource" kind="title">
        {r.dashboardUrl ? (
          <a href={r.dashboardUrl} target="_blank" rel="noreferrer">
            {r.name} ↗<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          r.name
        )}
        {!r.active && <span className="muted"> · no longer discovered</span>}
      </Cell>
      <Cell label="Product">{r.kind}</Cell>
      <Cell label="App assignment" kind="stack">
        <span className="app-select">
          <select
            aria-label={`App for ${r.name}`}
            value={r.app}
            aria-disabled={busy || undefined}
            onChange={async (e) => {
              if (busy) return;
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
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </span>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </Cell>
      <Cell label="Usage in selected dates" kind="stack">
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
      </Cell>
    </Row>
  );
}
