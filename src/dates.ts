// Shared UTC calendar-day helpers for analytics and infrastructure ranges.
export const DAY = 86400000;
export const isoDay = (date = new Date()) => date.toISOString().slice(0, 10);
export function validDay(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    isoDay(new Date(s)) === s
  );
}
