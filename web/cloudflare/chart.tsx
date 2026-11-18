import type { CloudflareData } from "../../src/cloudflare/model";
import { formatDay, formatMoney } from "./format";
import { CfTable, Cell, Row } from "./table";

/** Series colours are token-based classes in cloudflare.css (cf-series-0…6). */
const SERIES = 7;
const series = (i: number) => `cf-series-${i % SERIES}`;

export function DailySpend({
  charges,
  currency,
}: {
  charges: CloudflareData["charges"];
  currency: string;
}) {
  const families = [...new Set(charges.map((c) => c.family))].sort();
  const daily = new Map<string, Map<string, number>>();
  for (const c of charges) {
    const day = c.start.slice(0, 10),
      values = daily.get(day) ?? new Map<string, number>();
    values.set(c.family, (values.get(c.family) ?? 0) + c.cost);
    daily.set(day, values);
  }
  const rows = [...daily].sort(([a], [b]) => a.localeCompare(b));
  // Scale to the busiest day; an all-zero range keeps a positive divisor.
  const max =
    Math.max(
      0,
      ...rows.map(([, v]) =>
        [...v.values()].reduce((a, b) => a + Math.max(0, b), 0),
      ),
    ) || 1;
  if (!rows.length)
    return <p className="empty">No billing data received for these dates.</p>;
  return (
    <>
      <div
        className="cf-spend"
        role="img"
        aria-label="Daily costs stacked by product. Exact values and corrections are in the data table below."
      >
        <div className="cf-spend-plot" aria-hidden="true">
          {rows.map(([day, values]) => {
            const sum = [...values.values()].reduce((a, b) => a + b, 0);
            return (
              <div
                className="cf-spend-col"
                key={day}
                title={`${formatDay(day)} · ${formatMoney(sum, currency)}`}
              >
                <div
                  className="cf-spend-stack"
                  style={{
                    height: `${([...values.values()].reduce((a, b) => a + Math.max(0, b), 0) / max) * 100}%`,
                  }}
                >
                  {families.map((family, i) => {
                    const v = Math.max(0, values.get(family) ?? 0);
                    return v ? (
                      <i key={family} className={series(i)} style={{ flexGrow: v }} />
                    ) : null;
                  })}
                </div>
                <span className="cf-spend-tip">
                  <strong>{formatDay(day, false)}</strong>
                  {formatMoney(sum, currency)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="x-labels" aria-hidden="true">
          {[...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].map((i) => (
            <span key={i}>{formatDay(rows[i]![0], false)}</span>
          ))}
        </div>
      </div>
      <ul className="legend">
        {families.map((family, i) => (
          <li key={family}>
            <span className={`swatch ${series(i)}`} />
            {family}
          </li>
        ))}
      </ul>
      <details className="data-disclosure">
        <summary>Data table · UTC</summary>
        <CfTable
          label="Daily Cloudflare cost data"
          columns={[
            { label: "Day" },
            ...families.map((f) => ({ label: f, numeric: true })),
          ]}
        >
          {rows.map(([day, v]) => (
            <Row key={day}>
              <Cell label="Day" kind="title" className="cf-nowrap">
                {formatDay(day)}
              </Cell>
              {families.map((f) => (
                <Cell label={f} numeric key={f}>
                  {formatMoney(v.get(f) ?? 0, currency)}
                </Cell>
              ))}
            </Row>
          ))}
        </CfTable>
      </details>
    </>
  );
}
