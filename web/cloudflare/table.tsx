// Tables that become stacked label/value cards at ≤760px. Explicit ARIA table
// roles keep the semantics when CSS changes the display of table parts, and
// each cell repeats its column label visually (hidden from assistive tech,
// which already announces the column header).
import type { ReactNode } from "react";

export type Column = { label: string; numeric?: boolean };

export function CfTable({
  label,
  columns,
  tall = false,
  children,
}: {
  label: string;
  columns: Column[];
  tall?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={tall ? "table-scroll tall" : "table-scroll"}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="cf-table" role="table">
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((c) => (
              <th
                key={c.label}
                role="columnheader"
                scope="col"
                className={c.numeric ? "numeric" : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ app, children }: { app?: string; children: ReactNode }) {
  return (
    <tr role="row" data-app={app}>
      {children}
    </tr>
  );
}

/**
 * kind: "title" heads the mobile card, "stack" puts the label above long
 * values, "buttons" lays out actions.
 */
export function Cell({
  label,
  numeric = false,
  kind,
  className,
  children,
}: {
  label: string;
  numeric?: boolean;
  kind?: "title" | "stack" | "buttons";
  className?: string;
  children: ReactNode;
}) {
  const classes = [numeric && "numeric", kind && `cf-${kind}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <td role="cell" className={classes || undefined}>
      <span className="cf-cell-label" aria-hidden="true">
        {label}
      </span>
      <div className="cf-cell-value">{children}</div>
    </td>
  );
}
