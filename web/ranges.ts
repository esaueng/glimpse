import { APPS, dateRange } from "../src/contract";
// Timeframe presets over UTC days. Glimpse stores daily aggregates, so the
// smallest window is one UTC day and the largest is 90 days.
export type Preset =
  | "today"
  | "yesterday"
  | "7d"
  | "14d"
  | "30d"
  | "90d"
  | "this-week"
  | "prev-week"
  | "this-month"
  | "prev-month";
export type Timeframe = { from: string; to: string; preset?: Preset };

/** Resolve a rolling choice at the time of refresh; explicit dates stay fixed. */
export function refreshedTimeframe(value: Timeframe, now = new Date()): Timeframe {
  return value.preset ? { ...value, ...presetRange(value.preset, now) } : { ...value };
}
export const rollingPresets: { id: Preset; label: string }[] = [
  { id: "7d", label: "Past 7 days" },
  { id: "14d", label: "Past 14 days" },
  { id: "30d", label: "Past 30 days" },
  { id: "90d", label: "Past 90 days" },
];
export const calendarPresets: [
  { id: Preset; label: string },
  { id: Preset; label: string },
][] = [
  [
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
  ],
  [
    { id: "this-week", label: "This week" },
    { id: "prev-week", label: "Previous week" },
  ],
  [
    { id: "this-month", label: "This month" },
    { id: "prev-month", label: "Previous month" },
  ],
];
export const presetIds: Preset[] = [
  ...rollingPresets.map((p) => p.id),
  ...calendarPresets.flat().map((p) => p.id),
];
export const isPreset = (value: string | null): value is Preset =>
  presetIds.includes(value as Preset);
const DAY = 86400000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const startOfDay = (now: Date) =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
export function presetRange(
  preset: Preset,
  now = new Date(),
): { from: string; to: string } {
  const today = startOfDay(now),
    weekday = (now.getUTCDay() + 6) % 7, // Monday = 0
    monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  switch (preset) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "yesterday":
      return { from: iso(today - DAY), to: iso(today - DAY) };
    case "this-week":
      return { from: iso(today - weekday * DAY), to: iso(today) };
    case "prev-week":
      return {
        from: iso(today - (weekday + 7) * DAY),
        to: iso(today - (weekday + 1) * DAY),
      };
    case "this-month":
      return { from: iso(monthStart), to: iso(today) };
    case "prev-month":
      return {
        from: iso(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        to: iso(monthStart - DAY),
      };
    default: {
      const days = Number.parseInt(preset, 10);
      return { from: iso(today - (days - 1) * DAY), to: iso(today) };
    }
  }
}
export const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
export function formatRange(from: string, to: string) {
  const a = new Date(`${from}T00:00:00Z`),
    b = new Date(`${to}T00:00:00Z`),
    day = (d: Date, year: boolean) =>
      d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(year ? { year: "numeric" } : {}),
        timeZone: "UTC",
      });
  if (from === to) return day(b, true);
  return `${day(a, a.getUTCFullYear() !== b.getUTCFullYear())} – ${day(b, true)}`;
}

/** The longest range the stats API accepts, in inclusive UTC days. */
export const MAX_DAYS = 90;
export const shiftDay = (day: string, days: number) =>
  iso(Date.parse(day) + days * DAY);
const todayIso = (now: Date) => iso(startOfDay(now));

/** Why a custom range cannot be applied, or "" when it can. */
export function customRangeError(from: string, to: string, now = new Date()) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  if (!valid(from) || !valid(to)) return "Choose both dates.";
  if (from > to) return "From must be on or before To.";
  if (to > todayIso(now)) return "To cannot be later than today (UTC).";
  const days = spanDays(from, to);
  if (days > MAX_DAYS)
    return `This range is ${days} days. Choose at most ${MAX_DAYS} days.`;
  return "";
}

export type Scope = { app: string; from: string; to: string; preset?: Preset };
export const scopeApps: readonly string[] = ["all", ...APPS];
/** Query keys the dashboard owns; everything else (utm_*, cf_*) is preserved. */
const OWN_KEYS = ["app", "range", "from", "to", "level", "view"];
const quote = (value: string) =>
  `“${value.length > 24 ? `${value.slice(0, 24)}…` : value}”`;

/**
 * Read the analytics scope from a query string. Only app, range, from and to
 * are considered, so unrelated keys never reset the scope. Anything invalid
 * falls back to a safe default and is described in `notice`.
 */
export function readScope(
  search: string,
  now = new Date(),
): { scope: Scope; notice: string } {
  const query = new URLSearchParams(search),
    notices: string[] = [];
  const rawApp = query.get("app") ?? "all";
  const app = scopeApps.includes(rawApp) ? rawApp : "all";
  if (app !== rawApp)
    notices.push(`The app ${quote(rawApp)} in the link is unknown, so all apps are shown.`);
  const fallback = (): Scope => ({ app, ...presetRange("30d", now), preset: "30d" });
  const range = query.get("range"),
    from = query.get("from"),
    to = query.get("to");
  let scope: Scope;
  if (range !== null) {
    if (isPreset(range)) scope = { app, ...presetRange(range, now), preset: range };
    else {
      notices.push(
        `The timeframe ${quote(range)} in the link is unknown, so it was reset to the past 30 days.`,
      );
      scope = fallback();
    }
  } else if (from !== null || to !== null) {
    const dates = new URLSearchParams();
    if (from !== null) dates.set("from", from);
    if (to !== null) dates.set("to", to);
    const parsed = dateRange(dates, now);
    if (parsed) scope = { app, from: parsed.from, to: parsed.to };
    else {
      notices.push(
        `The timeframe in the link (${quote(from ?? "?")} to ${quote(to ?? "?")}) is not a valid range of at most ${MAX_DAYS} UTC days ending by today, so it was reset to the past 30 days.`,
      );
      scope = fallback();
    }
  } else scope = fallback();
  return { scope, notice: notices.join(" ") };
}

/** Whether the stats API would accept this scope. */
export const validScope = (scope: Scope, now = new Date()) =>
  scopeApps.includes(scope.app) &&
  dateRange(new URLSearchParams({ from: scope.from, to: scope.to }), now) !== null;

/** Canonical query for a scope and view, keeping keys the dashboard does not own. */
export function scopeSearch(scope: Scope, view: string, current = ""): string {
  const query = new URLSearchParams({ app: scope.app });
  if (scope.preset) query.set("range", scope.preset);
  else {
    query.set("from", scope.from);
    query.set("to", scope.to);
  }
  query.set("view", view);
  for (const [key, value] of new URLSearchParams(current))
    if (!OWN_KEYS.includes(key)) query.append(key, value);
  return `?${query}`;
}
