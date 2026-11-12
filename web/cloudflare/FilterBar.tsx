import { useId, useRef } from "react";
import {
  DAY,
  isoDay,
  type CloudflareData,
} from "../../src/cloudflare/model";
import {
  currencyOptions,
  defaultFilters,
  productOptions,
  visibilityLabels,
  type Filters,
} from "./filters";
import { formatDayRange } from "./format";

export type Apply = (next: Partial<Filters>, mode?: "push" | "replace") => void;

const periodLabel = (p: { start: string; end: string }) =>
  formatDayRange(p.start.slice(0, 10), isoDay(new Date(Date.parse(p.end) - DAY)));

export function FilterBar({
  data,
  filters,
  apply,
  currentStart,
}: {
  data: CloudflareData;
  filters: Filters;
  apply: Apply;
  currentStart: string | undefined;
}) {
  const appSelect = useRef<HTMLSelectElement>(null),
    labelId = useId();
  const appName = (id: string) => data.apps.find((a) => a.id === id)?.name;
  const periods = data.periods.filter((p) => p.start !== currentStart),
    chosen = periods.find((p) => p.start === filters.period),
    timeframe = chosen ? periodLabel(chosen) : "Custom dates";
  const active = [
    filters.app !== "all" && `App: ${appName(filters.app) ?? filters.app}`,
    filters.visibility !== "all" &&
      `Visibility: ${visibilityLabels[filters.visibility]}`,
    filters.product !== "all" && `Product: ${filters.product}`,
    filters.period !== "current" && `Timeframe: ${timeframe}`,
    filters.currency !== "USD" && `Currency: ${filters.currency}`,
  ].filter((v): v is string => !!v);
  const marked = (value: string, fallback: string) =>
    value !== fallback ? { "data-active": "" } : {};
  return (
    <div className="cf-filter-area">
      <div className="cf-filters">
        <label className="app-select">
          App
          <select
            ref={appSelect}
            value={filters.app}
            {...marked(filters.app, "all")}
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
        <label className="app-select">
          Visibility
          <select
            value={filters.visibility}
            {...marked(filters.visibility, "all")}
            onChange={(e) => apply({ visibility: e.target.value })}
          >
            <option value="all">All visibility</option>
            {Object.entries(visibilityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="app-select">
          Product
          <select
            value={filters.product}
            {...marked(filters.product, "all")}
            onChange={(e) => apply({ product: e.target.value })}
          >
            <option value="all">All products</option>
            {productOptions(data).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="app-select">
          Timeframe
          <select
            value={filters.period}
            {...marked(filters.period, "current")}
            onChange={(e) => apply({ period: e.target.value })}
          >
            <option value="current">Current billing period</option>
            {periods.map((p) => (
              <option key={p.start} value={p.start}>
                {periodLabel(p)}
              </option>
            ))}
            <option value="custom">Custom dates</option>
          </select>
        </label>
        <label className="app-select">
          Currency
          <select
            value={filters.currency}
            {...marked(filters.currency, "USD")}
            onChange={(e) => apply({ currency: e.target.value })}
          >
            {currencyOptions(data).map((c) => (
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
                onChange={(e) => apply({ from: e.target.value }, "replace")}
              />
            </label>
            <label>
              Through · UTC
              <input
                type="date"
                value={filters.to}
                max={isoDay()}
                onChange={(e) => apply({ to: e.target.value }, "replace")}
              />
            </label>
          </>
        )}
      </div>
      {active.length > 0 && (
        <div className="cf-active">
          <span className="cf-active-label" id={labelId}>
            Active filters
          </span>
          <ul aria-labelledby={labelId}>
            {active.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              apply({ ...defaultFilters });
              appSelect.current?.focus();
            }}
          >
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}
