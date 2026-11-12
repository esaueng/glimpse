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
  const max = Math.max(
    1,
    ...rows.map(([, v]) =>
      [...v.values()].reduce((a, b) => a + Math.max(0, b), 0),
    ),
  );
  if (!rows.length)
    return <p className="empty">No billing data received for these dates.</p>;
  return (
    <>
      <div
        className="cf-spend"
        role="img"
        aria-label="Daily costs stacked by product. Exact values and corrections are in the data table below."
      >
        {rows.map(([day, values]) => (
          <div className="cf-spend-row" key={day}>
            <span className="cf-nowrap">{formatDay(day, false)}</span>
            <div className="cf-spend-track">
              {families.map((family, i) => (
                <i
                  key={family}
                  className={series(i)}
                  style={{
                    width: `${(Math.max(0, values.get(family) ?? 0) / max) * 100}%`,
                  }}
                />
              ))}
            </div>
            <span className="numeric">
              {formatMoney(
                [...values.values()].reduce((a, b) => a + b, 0),
                currency,
              )}
            </span>
          </div>
        ))}
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
