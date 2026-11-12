// Cloudflare page filters live in cf_* URL parameters next to the dashboard's
// own app/range/from/to/view parameters, which are always preserved.
import { validDay, type CloudflareData } from "../../src/cloudflare/model";
import { writeSearch, type HistoryMode } from "../hooks";
import { isCurrency } from "./format";

export type Filters = {
  app: string;
  visibility: string;
  product: string;
  period: string;
  from: string;
  to: string;
  currency: string;
};
export const defaultFilters: Filters = {
  app: "all",
  visibility: "all",
  product: "all",
  period: "current",
  from: "",
  to: "",
  currency: "USD",
};
export const visibilityLabels: Record<string, string> = {
  public: "Public",
  private: "Private",
  unknown: "Not classified",
};
const keys = Object.keys(defaultFilters) as (keyof Filters)[];

export function readFilters(search = location.search): Filters {
  const q = new URLSearchParams(search);
  return Object.fromEntries(
    keys.map((key) => [key, q.get(`cf_${key}`) || defaultFilters[key]]),
  ) as Filters;
}

/** Writes filters to the URL. Discrete choices push; typing replaces. */
export function writeFilters(filters: Filters, mode: HistoryMode) {
  const q = new URLSearchParams(location.search);
  q.set("view", "cloudflare");
  for (const key of keys) {
    const value = filters[key];
    if (value && value !== defaultFilters[key]) q.set(`cf_${key}`, value);
    else q.delete(`cf_${key}`);
  }
  writeSearch(`?${q}`, mode);
}

export const productOptions = (data: CloudflareData) =>
  [...new Set(data.charges.map((c) => c.family))].sort();

export const currencyOptions = (data: CloudflareData) =>
  [
    ...new Set([
      "USD",
      ...data.charges.map((c) => c.currency),
      ...data.subscriptions.map((s) => s.currency),
    ]),
  ].filter(isCurrency);

/** Keeps only values the loaded data can show; anything else falls back to its default. */
export function sanitizeFilters(
  f: Filters,
  data: CloudflareData,
  currentStart: string | undefined,
): Filters {
  let period = f.period;
  if (period === currentStart) period = "current";
  else if (
    period !== "current" &&
    period !== "custom" &&
    !data.periods.some((p) => p.start === period)
  )
    period = "current";
  return {
    app:
      f.app === "all" || data.apps.some((a) => a.id === f.app) ? f.app : "all",
    visibility: Object.hasOwn(visibilityLabels, f.visibility)
      ? f.visibility
      : "all",
    product: productOptions(data).includes(f.product) ? f.product : "all",
    period,
    from: validDay(f.from) ? f.from : "",
    to: validDay(f.to) ? f.to : "",
    currency: currencyOptions(data).includes(f.currency) ? f.currency : "USD",
  };
}

export const sameFilters = (a: Filters, b: Filters) =>
  keys.every((key) => a[key] === b[key]);
