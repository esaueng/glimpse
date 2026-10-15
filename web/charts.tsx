import { useCompact } from "./useCompact";
import type { Row } from "../src/contract";
import { BUCKETS } from "../src/contract";
import { dailySeries, number, type Stats } from "./data";
export const sizeLabels = ["<1 MiB", "1–10 MiB", "10–100 MiB", "≥100 MiB"];
export const timingLabels = [
  "<100 ms",
  "100 ms–1 s",
  "1–10 s",
  "10–60 s",
  "≥60 s",
];
export function Histogram({
  labels,
  values,
}: {
  labels: readonly string[];
  values: number[];
}) {
  const sum = values.reduce((a, b) => a + b, 0);
  return (
    <table className="histogram">
      <thead>
        <tr>
          <th>Range</th>
          <th>Count</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {labels.map((label, i) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="numeric">{number(values[i] ?? 0)}</td>
            <td>
              <div className="distribution">
                <span className="track">
                  <i
                    style={{
                      width: `${(sum ? (values[i] ?? 0) / sum : 0) * 100}%`,
                    }}
                  />
                </span>
                <span>
                  {sum ? `${Math.round(((values[i] ?? 0) / sum) * 100)}%` : "—"}
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function Timing({ rows, event }: { rows: Row[]; event: string }) {
  const values = BUCKETS.map((bucket) =>
    rows
      .filter((r) => r.event === event && r.bucket === bucket)
      .reduce((n, r) => n + r.count, 0),
  );
  return <Histogram labels={timingLabels} values={values} />;
}
export function Activity({ data, event }: { data: Stats; event: string }) {
  const compact = useCompact(),
    width = compact ? 360 : 780,
    height = compact ? 200 : 156,
    left = compact ? 35 : 50,
    right = width - 20;
  const series = dailySeries(data, event),
    max = Math.max(1, ...series.flatMap((r) => [r.openzcad, r.openfea]));
  const top = Math.ceil(max / 4) * 4;
  const x = (i: number) =>
      left + (i / Math.max(1, series.length - 1)) * (right - left),
    y = (value: number) => (compact ? 162 : 122) - (value / top) * (compact ? 134 : 98);
  const shown = ["openzcad", "openfea"] as const;
  return (
    <section className="panel activity-panel">
      <div className="panel-heading">
        <h2>Daily activity</h2>
        <div className="legend">
          <span className="cad-key">OpenZCAD</span>
          <span className="fea-key">OpenFEA</span>
        </div>
      </div>
      <p className="chart-caption">
        {event === "api_request"
          ? "Backend API requests"
          : "Workspace opens · repeatable observations"}
      </p>
      <svg
        className="activity-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Daily ${event === "api_request" ? "API requests" : "workspace opens"} by app. Exact values in the daily data table.`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1={left}
              x2={right}
              y1={y((top * i) / 4)}
              y2={y((top * i) / 4)}
              className="grid-line"
            />
            <text x={left - 10} y={y((top * i) / 4) + 4} textAnchor="end">
              {number((top * i) / 4)}
            </text>
          </g>
        ))}
        {shown
          .filter((app) => data.range.app === "all" || data.range.app === app)
          .map((app) => (
            <g
              key={app}
              className={app === "openzcad" ? "cad-series" : "fea-series"}
            >
              <polyline
                fill="none"
                strokeWidth="2"
                points={series.map((r, i) => `${x(i)},${y(r[app])}`).join(" ")}
              />
              {series.map((r, i) => (
                <circle
                  key={r.day}
                  cx={x(i)}
                  cy={y(r[app])}
                  r={series.length > 45 ? 1.7 : 2.7}
                >
                  <title>{`${r.day} · ${app} · ${r[app]}`}</title>
                </circle>
              ))}
            </g>
          ))}
        {[
          ...new Set([
            0,
            Math.floor((series.length - 1) / 2),
            series.length - 1,
          ]),
        ]
          .filter((i) => i >= 0)
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height-10}
              textAnchor={
                i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"
              }
            >
              {series[i]?.day}
            </text>
          ))}
      </svg>
      {!series.some((r) => r.openzcad || r.openfea) && (
        <p className="empty-inline">No activity in this date range.</p>
      )}
      <details className="data-disclosure">
        <summary>Daily data table · UTC</summary>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Daily activity table"
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>OpenZCAD</th>
                <th>OpenFEA</th>
              </tr>
            </thead>
            <tbody>
              {series.map((r) => (
                <tr key={r.day}>
                  <td>{r.day}</td>
                  <td className="numeric">{number(r.openzcad)}</td>
                  <td className="numeric">{number(r.openfea)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
