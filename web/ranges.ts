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
