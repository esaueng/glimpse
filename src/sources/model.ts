// Source adapters turn a webhook payload into normalised issue events. Adding a source means
// adding an adapter here; storage, the inbox, retention and the API are shared.
import { frames, scrub } from "./scrub";

export const CATEGORIES = ["error", "security", "deploy", "availability", "other"] as const;
export const SEVERITIES = ["critical", "warning", "info"] as const;
export const STATUSES = ["open", "acknowledged", "resolved", "ignored"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Status = (typeof STATUSES)[number];

/** What an adapter extracts from one delivery. Every string is already scrubbed. */
export type IssueEvent = {
  fingerprint: string;
  title: string;
  category: Category;
  severity: Severity;
  service: string | null;
  occurrences: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  url: string | null;
  /** The source reports the problem as over (for example an alert end event). */
  resolved: boolean;
  detail: { errorType?: string; frames?: string[]; trigger?: string; risk?: string };
};

export type Parsed =
  | { kind: "events"; events: IssueEvent[] }
  | { kind: "test" }
  | { kind: "unrecognised" };

export type Adapter = {
  kind: string;
  /** Shown on the Sources page. */
  label: string;
  /** Header that carries the shared secret. */
  secretHeader: string;
  parse(payload: unknown): Parsed;
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
/** The first present value among dotted paths, e.g. "data.issue.id". */
export function pick(value: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path.split(".")) current = isObject(current) ? current[key] : undefined;
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return undefined;
}
const time = (v: unknown): string | null => {
  const ms = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
};
const count = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const dashboardUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && url.hostname === "dash.cloudflare.com"
      ? `${url.origin}${url.pathname}`.slice(0, 400)
      : null;
  } catch {
    return null;
  }
};

/**
 * Cloudflare Workers Issues, delivered as a Cloudflare Notifications generic webhook. The
 * envelope (name, text, data, ts, alert_type, alert_correlation_id, alert_event) is
 * documented; the Issues `data` fields are not, so several likely names are read and the
 * delivery's key paths (never values) are kept on the source for review.
 */
export const cloudflareIssues: Adapter = {
  kind: "cloudflare-issues",
  label: "Cloudflare Workers Issues",
  secretHeader: "cf-webhook-auth",
  parse(payload) {
    if (!isObject(payload)) return { kind: "unrecognised" };
    // "Save and Test" sends only {"text": "Hello World! ..."}.
    if (!("data" in payload) && typeof payload.text === "string" && /test message/i.test(payload.text))
      return { kind: "test" };
    const id = pick(payload, [
      "data.issue.id",
      "data.issue_id",
      "data.issueId",
      "data.id",
      "data.episode.id",
    ]);
    const rawTitle = pick(payload, [
      "data.issue.title",
      "data.title",
      "data.issue.name",
      "data.episode.summary",
      "data.summary",
      "text",
      "name",
    ]);
    const title = scrub(rawTitle, 200);
    const service = scrub(
      pick(payload, [
        "data.issue.script_name",
        "data.script_name",
        "data.scriptName",
        "data.worker",
        "data.worker_name",
        "data.service",
        "data.issue.worker",
        "data.config.name",
      ]),
      100,
    );
    if (!title) return { kind: "unrecognised" };
    const errorType = scrub(pick(payload, ["data.issue.error_type", "data.error_type", "data.error.name", "data.exception.name"]), 80);
    const stack = pick(payload, ["data.issue.stack", "data.stack", "data.error.stack", "data.exception.stack"]);
    const riskText = String(pick(payload, ["data.issue.risk", "data.risk", "data.risk_level", "data.severity"]) ?? title);
    const risk = /\b(critical|high|medium|low)\b/i.exec(riskText)?.[1]?.toLowerCase();
    const security = /vulnerab|scan|attack|probe/i.test(`${title} ${errorType ?? ""}`);
    const severity: Severity =
      risk === "critical" || risk === "high" ? "critical" : risk === "low" ? "info" : "warning";
    const trigger = scrub(pick(payload, ["data.trigger", "data.automation.trigger", "alert_type"]), 80);
    // A per-delivery correlation id would split one problem into many, so without an issue
    // id the Worker and title identify it.
    const fingerprint =
      typeof id === "string" || typeof id === "number"
        ? `id:${String(id).slice(0, 120)}`
        : `title:${service ?? ""}:${title.toLowerCase()}`;
    return {
      kind: "events",
      events: [
        {
          fingerprint,
          title,
          category: security ? "security" : "error",
          severity,
          service,
          occurrences: count(pick(payload, ["data.issue.occurrences", "data.occurrences", "data.occurrence_count", "data.count"])),
          firstSeen: time(pick(payload, ["data.issue.first_seen", "data.first_seen", "data.episode.first_failed", "data.episode.first_fired"])),
          lastSeen: time(pick(payload, ["data.issue.last_seen", "data.last_seen", "data.episode.last_failed", "ts"])),
          url: dashboardUrl(pick(payload, ["data.issue.url", "data.url", "data.dashboard_url", "data.link"])),
          resolved:
            payload.alert_event === "ALERT_STATE_EVENT_END" || !!pick(payload, ["data.episode.resolved_at"]),
          detail: {
            ...(errorType ? { errorType } : {}),
            ...(frames(stack).length ? { frames: frames(stack) } : {}),
            ...(trigger ? { trigger } : {}),
            ...(risk ? { risk } : {}),
          },
        },
      ],
    };
  },
};

export const ADAPTERS: Record<string, Adapter> = { [cloudflareIssues.kind]: cloudflareIssues };
