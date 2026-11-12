import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { number, percent } from "./data";
import { sizeLabels, timingLabels } from "./labels";
export { sizeLabels, timingLabels };
export type Tone =
  | "accent"
  | "fea"
  | "lattice"
  | "tone-2"
  | "tone-3"
  | "warn"
  | "error";
export const color = (tone: Tone) => `var(--${tone})`;
const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
/** "12 Nov" for a UTC day such as 2026-11-12. */
export const shortDay = (day: string) =>
  dayFormat.format(new Date(`${day}T00:00:00Z`));
function niceStep(span: number) {
  const raw = Math.max(span, 1) / 3,
    power = 10 ** Math.floor(Math.log10(raw)),
    scaled = raw / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}
export type Series = {
  name: string;
  values: number[];
  tone: Tone;
  dashed?: boolean;
};
/**
 * Scrolling region for a table. Marks the edge where more columns are hidden
 * and only takes keyboard focus when it actually scrolls.
 */
export function TableScroll({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [state, setState] = useState({ start: false, end: false, scrolls: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth,
        next = {
          start: max > 1 && el.scrollLeft > 1,
          end: max > 1 && el.scrollLeft < max - 1,
          scrolls: max > 1 || el.scrollHeight - el.clientHeight > 1,
        };
      setState((prior) =>
        prior.start === next.start &&
        prior.end === next.end &&
        prior.scrolls === next.scrolls
          ? prior
          : next,
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  return (
    <>
      {(state.start || state.end) && (
        <p className="scroll-hint" aria-hidden="true">
          Scroll sideways for more columns <span>→</span>
        </p>
      )}
      <div
        ref={ref}
        className={`table-scroll ${className}`.trim()}
        role="region"
        aria-label={label}
        tabIndex={state.scrolls ? 0 : undefined}
        data-more-start={state.start || undefined}
        data-more-end={state.end || undefined}
      >
        {children}
      </div>
    </>
  );
}
/** A collapsed table of exact values; the summary names the chart it belongs to. */
export function DataTable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="data-disclosure">
      <summary>
        Data table<span className="sr-only">: {label}</span> · UTC
      </summary>
      <TableScroll label={`${label}: exact values`}>{children}</TableScroll>
    </details>
  );
}
// Fluid SVG line chart. Values and labels stay in HTML; the table is the exact alternative.
export function LineChart({
  label,
  days,
  series,
  height = 220,
  zeroBased = true,
  area = false,
  peak = false,
  format = number,
  unit = 1,
}: {
  label: string;
  days: string[];
  series: Series[];
  height?: number;
  zeroBased?: boolean;
  area?: boolean;
  peak?: boolean;
  format?: (value: number) => string;
  /** Tick steps are chosen in multiples of this unit, e.g. 2 ** 30 for GiB. */
  unit?: number;
}) {
  const all = series.flatMap((s) => s.values),
    high = Math.max(1, ...all),
    low = zeroBased ? 0 : Math.min(...all);
  let step = niceStep((high - low) / unit) * unit,
    bottom = 0,
    top = 0;
  // At most four gridlines; a coarser step keeps small panels readable.
  do {
    bottom = zeroBased ? 0 : Math.floor(low / step) * step;
    top = Math.max(bottom + step, Math.ceil((high * 1.02) / step) * step);
  } while ((top - bottom) / step > 4 && (step *= 2));
  const ticks: number[] = [];
  for (let t = bottom + step; t <= top + step / 2; t += step) ticks.push(t);
  const tickText = ticks.map(format);
  const x = (i: number) =>
      days.length > 1 ? (i / (days.length - 1)) * 1000 : 500,
    y = (v: number) => 190 - ((v - bottom) / (top - bottom)) * 180;
  const path = (values: number[]) =>
    values
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
  const first = series[0],
    peakIndex = first
      ? first.values.reduce((best, v, i, a) => (v > a[best]! ? i : best), 0)
      : 0;
  const empty = !all.some((v) => v > 0),
    // One UTC day has no line to draw: show points and say so in text.
    single = days.length === 1;
  const peakText =
    first && days[peakIndex]
      ? `Peak · ${shortDay(days[peakIndex])} · ${format(first.values[peakIndex] ?? 0)}`
      : "";
  return (
    <figure className="line-chart">
      <div className="chart-plot" style={{ height }}>
        <svg
          viewBox="0 0 1000 200"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}. ${series
            .map((s) =>
              single
                ? `${s.name} ${format(s.values[0] ?? 0)}`
                : `${s.name} from ${format(s.values[0] ?? 0)} to ${format(s.values.at(-1) ?? 0)}`,
            )
            .join("; ")}. Exact values are in the data table.`}
        >
          {ticks.map((t) => (
            <line key={t} className="grid-line" x1="0" x2="1000" y1={y(t)} y2={y(t)} />
          ))}
          <line className="axis-line" x1="0" x2="1000" y1="190" y2="190" />
          {!single && area && first && (
            <path
              d={`${path(first.values)} L1000,190 L0,190 Z`}
              style={{ fill: color(first.tone) }}
              className="area"
            />
          )}
          {!single &&
            series.map((s) => (
              <path
                key={s.name}
                d={path(s.values)}
                className={s.dashed ? "series dashed" : "series"}
                style={{ stroke: color(s.tone) }}
              />
            ))}
        </svg>
        <div className="tick-labels" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={t} style={{ top: `calc(${(y(t) / 200) * 100}% - 15px)` }}>
              {tickText[i]}
            </span>
          ))}
        </div>
        {single &&
          !empty &&
          series.map((s) => (
            <i
              key={s.name}
              className="point"
              aria-hidden="true"
              style={{
                left: "50%",
                top: `${(y(s.values[0] ?? 0) / 200) * 100}%`,
                borderColor: color(s.tone),
              }}
            />
          ))}
        {peak && first && !empty && !single && (
          <div
            className={`peak ${x(peakIndex) < 500 ? "start" : "end"}`}
            aria-hidden="true"
            style={
              {
                left: `${x(peakIndex) / 10}%`,
                top: `${(y(first.values[peakIndex]!) / 200) * 100}%`,
                "--x": x(peakIndex) / 10,
                "--w": `calc(${peakText.length}ch + 16px)`,
                "--gutter": `calc(${Math.max(0, ...tickText.map((t) => t.length))}ch + 8px)`,
              } as CSSProperties
            }
          >
            <i style={{ borderColor: color(first.tone) }} />
            <span>{peakText}</span>
          </div>
        )}
        {empty && <p className="chart-empty">No data in this range.</p>}
      </div>
      {single ? (
        <p className="chart-single">
          Single day · {shortDay(days[0]!)} ·{" "}
          {series.map((s) => `${s.name} ${format(s.values[0] ?? 0)}`).join(" · ")}
        </p>
      ) : (
        <div className="x-labels" aria-hidden="true">
          {[...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])]
            .filter((i) => i >= 0 && days[i])
            .map((i) => (
              <span key={i}>{shortDay(days[i]!)}</span>
            ))}
        </div>
      )}
      <DataTable label={label}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              {series.map((s) => (
                <th key={s.name} className="numeric">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => (
              <tr key={day}>
                <td className="nowrap">{day}</td>
                {series.map((s) => (
                  <td key={s.name} className="numeric">
                    {format(s.values[i] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </figure>
  );
}
// Trend only: no axes. Exact start and end values sit beside it in text.
export function Sparkline({
  label,
  values,
  tone = "accent",
  format = number,
}: {
  label: string;
  values: number[];
  tone?: Tone;
  format?: (value: number) => string;
}) {
  if (!values.length) return <span className="sparkline" aria-hidden="true" />;
  const high = Math.max(...values),
    low = Math.min(...values),
    y = (v: number) => (high === low ? 12 : 21 - ((v - low) / (high - low)) * 18);
  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      role="img"
      aria-label={
        values.length > 1
          ? `${label}: ${format(values[0]!)} to ${format(values.at(-1)!)}`
          : `${label}: ${format(values[0]!)}, one snapshot`
      }
    >
      {values.length > 1 ? (
        <path
          d={values
            .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 100).toFixed(2)},${y(v).toFixed(2)}`)
            .join(" ")}
          style={{ stroke: color(tone) }}
        />
      ) : (
        <path className="sparkline-dot" d="M50,12 L50,12" style={{ stroke: color(tone) }} />
      )}
    </svg>
  );
}
/** Colour key; it is real text so screen readers and forced colours keep it. */
export function Legend({
  items,
  label,
}: {
  items: { name: string; tone: Tone; dashed?: boolean }[];
  label?: string;
}) {
  return (
    <ul className="legend" aria-label={label}>
      {items.map((s) => (
        <li key={s.name}>
          <span
            className={s.dashed ? "swatch dashed" : "swatch"}
            style={{ background: color(s.tone) }}
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}
export type Segment = { name: string; value: number; tone: Tone };
export function StackBar({
  label,
  segments,
  legend = true,
}: {
  label: string;
  segments: Segment[];
  legend?: boolean;
}) {
  const sum = segments.reduce((n, s) => n + s.value, 0);
  return (
    <div className="stack">
      <div
        className="stack-bar"
        role="img"
        aria-label={
          sum
            ? `${label}: ${segments.map((s) => `${s.name} ${percent(s.value, sum)}`).join(", ")}`
            : `${label}: no data`
        }
      >
        {sum ? (
          segments.map((s) =>
            s.value ? (
              <i
                key={s.name}
                style={{ flexGrow: s.value, background: color(s.tone) }}
              />
            ) : null,
          )
        ) : (
          <i className="none" />
        )}
      </div>
      {legend && (
        <ul className="legend" aria-hidden="true">
          {segments.map((s) => (
            <li key={s.name}>
              <span className="swatch" style={{ background: color(s.tone) }} />
              {s.name}
              {sum ? ` ${percent(s.value, sum)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function RankBars({
  items,
  tone = "accent",
  empty = "No data in this range.",
}: {
  items: { label: string; value: number; title?: string }[];
  tone?: Tone;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return items.length ? (
    <ol className="rank-bars">
      {items.map((item) => (
        <li key={item.label} title={item.title}>
          <span className="rank-label">{item.label}</span>
          <span className="track">
            <i style={{ width: `${(item.value / max) * 100}%`, background: color(tone) }} />
          </span>
          <span className="numeric">{number(item.value)}</span>
        </li>
      ))}
    </ol>
  ) : (
    <p className="empty">{empty}</p>
  );
}
export function Columns({
  items,
  tone = "accent",
  show = "value",
  height = 120,
}: {
  items: { label: string; value: number; tone?: Tone }[];
  tone?: Tone;
  show?: "value" | "share";
  height?: number;
}) {
  const max = Math.max(1, ...items.map((i) => i.value)),
    sum = items.reduce((n, i) => n + i.value, 0);
  return sum ? (
    <ol className="columns" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <li key={item.label}>
          <span className="numeric">
            {show === "share" ? percent(item.value, sum) : number(item.value)}
          </span>
          <i
            style={{
              height: Math.max(3, (item.value / max) * height),
              background: color(item.tone ?? tone),
            }}
          />
          <span className="column-label">{item.label}</span>
        </li>
      ))}
    </ol>
  ) : (
    <p className="empty">No data in this range.</p>
  );
}
