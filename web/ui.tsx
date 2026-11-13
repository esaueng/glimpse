// Shared presentational components for the dashboard and the Cloudflare page.
import type { ReactNode } from "react";

/**
 * One stat in a `.strip`: label, value and an optional note (the children).
 * `gap` marks a figure Glimpse deliberately does not collect, such as total
 * users, and renders it in the muted "Not collected" style.
 */
export function Tile({
  label,
  value,
  children,
  gap = false,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  gap?: boolean;
}) {
  return (
    <div className={gap ? "tile tile-gap" : "tile"}>
      <span className="tile-label">{label}</span>
      <strong className="tile-value">{value}</strong>
      {children && <span className="tile-note">{children}</span>}
    </div>
  );
}

export function Panel({
  title,
  note,
  children,
  className = "",
  level = 2,
  na,
}: {
  title: string;
  note?: ReactNode;
  children?: ReactNode;
  className?: string;
  level?: 2 | 3;
  /** Set when the app filter excludes the owning app: the panel collapses to one N/A row. */
  na?: string;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  if (na)
    return (
      <section className={`panel panel-na ${className}`}>
        <div className="panel-heading">
          <Heading>{title}</Heading>
          <span className="panel-meta">
            <strong className="na">N/A</strong> · {na}
          </span>
        </div>
      </section>
    );
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <Heading>{title}</Heading>
        {note && <span className="panel-meta">{note}</span>}
      </div>
      {children}
    </section>
  );
}
