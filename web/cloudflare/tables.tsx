import type { CloudflareData } from "../../src/cloudflare/model";
import {
  formatDay,
  formatMoney,
  formatQuantity,
  formatStamp,
} from "./format";
import { CfTable, Cell, Row } from "./table";

export function ProductUsage({
  charges,
  currency,
}: {
  charges: CloudflareData["charges"];
  currency: string;
}) {
  const grouped = new Map<
    string,
    {
      family: string;
      description: string;
      unit: string;
      quantity: number;
      cost: number;
    }
  >();
  for (const c of charges) {
    const key = JSON.stringify([c.family, c.description, c.unit]),
      prior = grouped.get(key);
    grouped.set(key, {
      family: c.family,
      description: c.description,
      unit: c.unit,
      quantity: (prior?.quantity ?? 0) + c.quantity,
      cost: (prior?.cost ?? 0) + c.cost,
    });
  }
  const rows = [...grouped.values()].sort(
    (a, b) => b.cost - a.cost || a.description.localeCompare(b.description),
  );
  return (
    <>
      <p className="panel-note">
        Quantities and usage charges as reported by Cloudflare. Included usage
        is reflected in costs; subscription fees are separate.
      </p>
      <CfTable
        tall
        label="Product usage and costs"
        columns={[
          { label: "Product" },
          { label: "Metric" },
          { label: "Reported quantity", numeric: true },
          { label: "Usage cost", numeric: true },
        ]}
      >
        {rows.map((r) => (
          <Row key={`${r.family}:${r.description}:${r.unit}`}>
            <Cell label="Product" kind="title">
              {r.family}
            </Cell>
            <Cell label="Metric">{r.description}</Cell>
            <Cell label="Reported quantity" numeric>
              {formatQuantity(r.quantity, r.unit, r.description)}
            </Cell>
            <Cell label="Usage cost" numeric>
              {formatMoney(r.cost, currency)}
            </Cell>
          </Row>
        ))}
      </CfTable>
      {!rows.length && (
        <p className="empty">No billing quantities received for these dates.</p>
      )}
    </>
  );
}

export function SubscriptionsTable({
  subscriptions,
}: {
  subscriptions: CloudflareData["subscriptions"];
}) {
  return (
    <CfTable
      label="Subscriptions"
      columns={[
        { label: "Plan" },
        { label: "Amount", numeric: true },
        { label: "Cycle" },
        { label: "Renews" },
      ]}
    >
      {subscriptions.map((s) => (
        <Row key={s.id}>
          <Cell label="Plan" kind="title">
            {s.name}
          </Cell>
          <Cell label="Amount" numeric>
            {s.amount === null
              ? "Unavailable"
              : formatMoney(s.amount, s.currency)}
          </Cell>
          <Cell label="Cycle">{s.frequency}</Cell>
          <Cell label="Renews" className="cf-nowrap">
            {s.renews ? formatDay(s.renews) : "—"}
          </Cell>
        </Row>
      ))}
    </CfTable>
  );
}

export function CoverageTable({
  coverage,
}: {
  coverage: CloudflareData["coverage"];
}) {
  return (
    <CfTable
      label="Cloudflare API coverage"
      columns={[
        { label: "Source" },
        { label: "Status" },
        { label: "Last successful collection · UTC" },
        { label: "Details" },
      ]}
    >
      {coverage.map((c) => (
        <Row key={c.source}>
          <Cell label="Source" kind="title">
            {c.source}
          </Cell>
          <Cell
            label="Status"
            className={c.status === "ok" ? undefined : "warn-text"}
          >
            {c.status}
          </Cell>
          <Cell label="Last success · UTC" className="cf-nowrap">
            {c.lastSuccess ? formatStamp(c.lastSuccess) : "Never"}
          </Cell>
          <Cell label="Details" kind="stack">
            {c.message}
          </Cell>
        </Row>
      ))}
    </CfTable>
  );
}
