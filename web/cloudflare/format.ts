// Display-layer formatting for the Cloudflare page. Intl formatters are cached
// because tables call these once per cell.
import { bytes } from "../data";

export const metricNames: Record<string, string> = {
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

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const oneDecimal = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
export const formatNumber = (value: number) => decimal.format(value);

const currencyFormats = new Map<string, Intl.NumberFormat>();
function currencyFormat(currency: string) {
  let format = currencyFormats.get(currency);
  if (!format) {
    // Throws RangeError for malformed codes; callers decide how to recover.
    format = new Intl.NumberFormat(undefined, { style: "currency", currency });
    currencyFormats.set(currency, format);
  }
  return format;
}
/** True for well-formed ISO 4217 codes that Intl can format. */
export function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    currencyFormat(code);
    return true;
  } catch {
    return false;
  }
}
/** Formats integer micro-units of a currency; never throws on a bad code. */
export function formatMoney(micros: number, currency = "USD") {
  const value = micros / 1e6;
  return isCurrency(currency)
    ? currencyFormat(currency).format(value)
    : `${decimal.format(value)} ${currency}`;
}

/** Human duration from milliseconds, e.g. "31.8 min" or "529.8 h". */
export function formatDuration(ms: number) {
  const abs = Math.abs(ms);
  if (abs >= 3_600_000) return `${oneDecimal.format(ms / 3_600_000)} h`;
  if (abs >= 60_000) return `${oneDecimal.format(ms / 60_000)} min`;
  if (abs >= 1000) return `${oneDecimal.format(ms / 1000)} s`;
  return `${oneDecimal.format(ms)} ms`;
}

const isMs = (unit: string) => /^(ms|millis(econds?)?|cpu[ -]?ms)$/i.test(unit);
const isSeconds = (unit: string) => /^(s|secs?|seconds?)$/i.test(unit);

/** Resource analytics values, keyed by the collector's unit names. */
export function formatUsage(value: number, unit: string) {
  if (unit === "bytes") return bytes(value);
  if (unit === "microseconds") return formatDuration(value / 1000);
  if (isMs(unit)) return formatDuration(value);
  if (isSeconds(unit)) return formatDuration(value * 1000);
  if (unit === "byte-seconds")
    return `${decimal.format(value / 2 ** 30 / 3600)} GiB-hours`;
  return `${decimal.format(value)} ${unit}`;
}

/**
 * Billing quantities. Cloudflare often reports a generic "Count" unit, so the
 * charge description decides how the number reads (CPU time is billed in ms).
 */
export function formatQuantity(
  quantity: number,
  unit: string,
  description: string,
) {
  const u = unit.trim(),
    generic = !u || /^counts?$/i.test(u),
    d = description.toLowerCase();
  if (/cpu/.test(d) && (generic || isMs(u))) return formatDuration(quantity);
  if (isMs(u)) return formatDuration(quantity);
  if (isSeconds(u)) return formatDuration(quantity * 1000);
  if (/^bytes?$/i.test(u)) return bytes(quantity);
  if (!generic) return `${decimal.format(quantity)} ${u}`;
  const noun = /request/.test(d)
    ? "requests"
    : /rows?\b/.test(d)
      ? "rows"
      : /operation/.test(d)
        ? "operations"
        : "";
  return noun ? `${decimal.format(quantity)} ${noun}` : decimal.format(quantity);
}

// Dates: UTC throughout, matching the timeframe picker's formatting.
const dayShort = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayLong = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const stamp = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
const toDate = (value: string) =>
  new Date(value.length === 10 ? `${value}T00:00:00Z` : value);

/** "Nov 5, 2026" (or "Nov 5" without the year) for a YYYY-MM-DD or ISO value. */
export function formatDay(value: string, year = true) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return (year ? dayLong : dayShort).format(date);
}
/** "Oct 1 – Oct 31, 2026"; the year appears once unless the range crosses it. */
export function formatDayRange(from: string, to: string) {
  const a = toDate(from),
    b = toDate(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()))
    return `${from} – ${to}`;
  if (from === to) return dayLong.format(b);
  return `${(a.getUTCFullYear() === b.getUTCFullYear() ? dayShort : dayLong).format(a)} – ${dayLong.format(b)}`;
}
/** "Nov 12, 2026, 23:06" for an ISO timestamp, in UTC. */
export function formatStamp(value: string) {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? value : stamp.format(date);
}
