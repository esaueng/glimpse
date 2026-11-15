// MCP server for agents (Claude, Codex) over Streamable HTTP, stateless JSON responses.
// It sits behind Cloudflare Access like the dashboard: Access managed OAuth signs people in
// and service tokens cover unattended automations; the Worker verifies the Access JWT
// before this code runs (src/index.ts). Tools read the same data as the dashboard and may
// change an issue's status or note, recorded with the role "agent".
import { APPS, APP_NAMES, BUCKETS, type App } from "./contract";
import { logFailure } from "./errors";
import { missingMigrations } from "./migrations";
import { STATUSES, type Status } from "./sources/model";
import { getIssue, listIssues, listSources, setNote, setStatus } from "./sources/store";
import { readBody } from "./sources/api";
import { readStats } from "./stats";
import { appHealth, attention } from "../web/health";
import { bucketCounts, errorCodes, total, type Loaded, type Stats } from "../web/data";

export const MCP_PATH = "/mcp";
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const LIMIT = 64 * 1024;

type Json = Record<string, unknown>;
type RpcError = { code: number; message: string };
class InvalidParams extends Error {}

const appEnum = ["all", ...APPS];
const issueStatus = ["active", ...STATUSES];
const tools = [
  {
    name: "get_health",
    title: "App health",
    description:
      "Health of each app over the last N UTC days: status (healthy, degraded, failing, idle), API requests, server-error share, share of requests taking 1 s or more, opted-in diagnostics, plus a ranked 'needs attention' list and open inbox issue counts. Start here.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", enum: appEnum, default: "all" },
        days: { type: "integer", minimum: 1, maximum: 90, default: 7 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_metrics",
    title: "Daily metrics",
    description:
      "Daily API requests and server errors per app, API response-time ranges, failure counts (exports, solver runs, generations) and the top opted-in diagnostic codes over the last N UTC days.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", enum: appEnum, default: "all" },
        days: { type: "integer", minimum: 1, maximum: 90, default: 14 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_issues",
    title: "List issues",
    description:
      "Issues from connected sources (Cloudflare Workers Issues), most severe and most recent first. 'active' means open or acknowledged. Text is scrubbed: no emails, IPs, tokens or query strings.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: issueStatus, default: "active" },
        app: { type: "string", enum: appEnum, default: "all" },
        category: { type: "string", enum: ["error", "security", "deploy", "availability", "other"] },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_issue",
    title: "Issue detail",
    description:
      "One issue with its Worker, error type, stack frames, occurrence counts, first and last seen times, Cloudflare dashboard link, note and recent activity.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", pattern: "^iss_[0-9a-f]{16}$" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "update_issue",
    title: "Update issue",
    description:
      "Set an issue's status (open, acknowledged, resolved, ignored) and/or its note, for example 'acknowledged' when starting an investigation and a note linking the fix. Logged as done by an agent. A resolved issue reopens automatically if it happens again.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", pattern: "^iss_[0-9a-f]{16}$" },
        status: { type: "string", enum: [...STATUSES] },
        note: { type: "string", maxLength: 500 },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_sources",
    title: "List sources",
    description: "Connected webhook sources with delivery counts, last delivery time and status. Secrets are never returned.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const prompts = [
  {
    name: "investigate_issue",
    title: "Investigate an issue",
    description: "Steps for an agent to investigate one Glimpse issue and propose a fix.",
    arguments: [{ name: "issue_id", description: "Glimpse issue id (iss_…)", required: true }],
  },
];

// Argument helpers: reject anything outside the schema instead of guessing.
function args(value: unknown, allowed: string[]): Json {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidParams("Arguments must be an object");
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new InvalidParams(`Unknown argument: ${unknown.join(", ")}`);
  return value as Json;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T | undefined, name: string): T | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !options.includes(value as T))
    throw new InvalidParams(`${name} must be one of: ${options.join(", ")}`);
  return value as T;
}
function int(value: unknown, min: number, max: number, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new InvalidParams(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function issueId(value: unknown): string {
  if (typeof value !== "string" || !/^iss_[0-9a-f]{16}$/.test(value)) throw new InvalidParams("id must look like iss_ followed by 16 hex digits");
  return value;
}

const day = (offset: number, now: Date) => new Date(now.getTime() - offset * 86400000).toISOString().slice(0, 10);
async function load(db: D1Database, app: App | "all", days: number, now: Date): Promise<Loaded> {
  const scope = { app, from: day(days - 1, now), to: day(0, now) };
  const [basic, optional] = await Promise.all([
    readStats(db, { ...scope, level: "basic" }),
    readStats(db, { ...scope, level: "optional" }),
  ]);
  return { basic: basic as unknown as Stats, optional: optional as unknown as Stats };
}
const ratio = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

class ToolError extends Error {}
async function need(db: D1Database, surface: "stats" | "issues") {
  const missing = await missingMigrations(db, surface);
  if (missing.length) throw new ToolError(`Database migration pending: ${missing.join(", ")}`);
}

async function call(db: D1Database, name: string, raw: unknown, now: Date): Promise<unknown> {
  switch (name) {
    case "get_health": {
      const a = args(raw, ["app", "days"]);
      const app = oneOf(a.app, appEnum, "all", "app") as App | "all",
        days = int(a.days, 1, 90, 7, "days");
      await need(db, "stats");
      const data = await load(db, app, days, now);
      const issues = (await missingMigrations(db, "issues")).length ? null : (await listIssues(db, { app, status: "active", limit: 1 })).counts;
      return {
        range: { from: data.basic.range.from, to: data.basic.range.to, utc: true },
        apps: APPS.filter((a) => app === "all" || a === app).map((a) => {
          const h = appHealth(data, a);
          return {
            app: a,
            name: APP_NAMES[a],
            status: h.status,
            requests: h.requests,
            serverErrors: h.errors,
            serverErrorShare: ratio(h.errorRate),
            slowShare: ratio(h.slowShare),
            diagnosticsOptedIn: h.diagnostics,
            lastDataDay: h.lastDay,
          };
        }),
        needsAttention: attention(data, app).map(({ id: _, ...item }) => item),
        openIssues: issues ? { open: issues.open, acknowledged: issues.acknowledged } : "inbox not set up",
        notes: "Requests and errors cover all users; diagnostics cover opted-in users only.",
      };
    }
    case "get_metrics": {
      const a = args(raw, ["app", "days"]);
      const app = oneOf(a.app, appEnum, "all", "app") as App | "all",
        days = int(a.days, 1, 90, 14, "days");
      await need(db, "stats");
      const data = await load(db, app, days, now);
      const apps = APPS.filter((x) => app === "all" || x === app);
      const daily = new Map<string, Json>();
      for (const r of data.basic.rows) {
        if (r.event !== "api_request" && r.event !== "api_error") continue;
        const entry = daily.get(r.day) ?? { day: r.day };
        const key = `${r.app}.${r.event === "api_request" ? "requests" : "errors"}`;
        entry[key] = ((entry[key] as number | undefined) ?? 0) + r.count;
        daily.set(r.day, entry);
      }
      const opt = data.optional.rows;
      return {
        range: { from: data.basic.range.from, to: data.basic.range.to, utc: true },
        daily: [...daily.values()].sort((x, y) => String(x.day).localeCompare(String(y.day))),
        apiResponseTime: Object.fromEntries(
          apps.map((x) => [x, Object.fromEntries(BUCKETS.map((b, i) => [b, bucketCounts(data.basic.rows, "api_latency", BUCKETS, x)[i]]))]),
        ),
        failuresOptedIn: Object.fromEntries(
          apps.map((x) => [
            x,
            {
              exports: { failed: total(opt, "export_failed", x), completed: total(opt, "export_completed", x) },
              solverRuns: { failed: total(opt, "solver_failed", x), completed: total(opt, "solver_completed", x) },
              generations: { failed: total(opt, "generation_failed", x), completed: total(opt, "generation_completed", x) },
            },
          ]),
        ),
        topDiagnosticsOptedIn: errorCodes(opt).slice(0, 10),
      };
    }
    case "list_issues": {
      const a = args(raw, ["status", "app", "category", "limit"]);
      const status = oneOf(a.status, issueStatus, "active", "status") as Status | "active",
        app = oneOf(a.app, appEnum, "all", "app")!,
        category = oneOf(a.category, ["error", "security", "deploy", "availability", "other"], undefined, "category"),
        limit = int(a.limit, 1, 100, 25, "limit");
      await need(db, "issues");
      const { issues, counts } = await listIssues(db, { status, app, category, limit });
      return {
        counts,
        issues: issues.map((i) => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          category: i.category,
          status: i.status,
          app: i.app,
          worker: i.service,
          occurrences: i.occurrences,
          firstSeen: i.first_seen,
          lastSeen: i.last_seen,
          note: i.note,
        })),
      };
    }
    case "get_issue": {
      const a = args(raw, ["id"]);
      const id = issueId(a.id);
      await need(db, "issues");
      const issue = await getIssue(db, id);
      if (!issue) throw new ToolError(`No issue ${id}`);
      const { fingerprint: _f, prev_status: _p, ...rest } = issue as typeof issue & { fingerprint?: string; prev_status?: string };
      return rest;
    }
    case "update_issue": {
      const a = args(raw, ["id", "status", "note"]);
      const id = issueId(a.id),
        status = oneOf(a.status, STATUSES, undefined, "status");
      if (a.note !== undefined && (typeof a.note !== "string" || a.note.length > 500))
        throw new InvalidParams("note must be a string of at most 500 characters");
      const note = typeof a.note === "string" && a.note.trim() ? a.note.trim() : null;
      if (!status && !note) throw new InvalidParams("Give a status, a note, or both");
      await need(db, "issues");
      const ok = status ? await setStatus(db, id, status, note, "agent") : await setNote(db, id, note!, "agent");
      if (!ok) throw new ToolError(`No issue ${id}`);
      const updated = await getIssue(db, id);
      return { id, status: updated?.status, note: updated?.note };
    }
    case "list_sources": {
      args(raw, []);
      await need(db, "issues");
      return { sources: await listSources(db) };
    }
  }
  throw new InvalidParams(`Unknown tool: ${name}`);
}

function prompt(name: string, raw: unknown) {
  if (name !== "investigate_issue") throw new InvalidParams(`Unknown prompt: ${name}`);
  const a = args(raw, ["issue_id"]);
  const id = issueId(a.issue_id);
  return {
    description: `Investigate Glimpse issue ${id}`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Investigate Glimpse issue ${id}.`,
            `1. Call get_issue with id ${id}. Note the Worker, error type, stack frames, and first and last seen times.`,
            "2. Call get_health for the issue's app to see whether errors or latency moved at the same time.",
            "3. Mark it acknowledged with update_issue and a short note that you are investigating.",
            "4. Use the Cloudflare MCP server (Workers observability) to pull logs and traces for that Worker around the last-seen time.",
            "5. Find the root cause in the Worker's repository, make the smallest fix with a regression test, and open a pull request.",
            "6. Add the pull request link with update_issue (note). Do not mark it resolved until the fix is deployed.",
          ].join("\n"),
        },
      },
    ],
  };
}

async function handle(db: D1Database, message: unknown, now: Date): Promise<Json | null> {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
  const m = message as Json;
  // A client's response to a server request (none are sent) needs no reply.
  if (!("method" in m) && ("result" in m || "error" in m)) return null;
  const validId = typeof m.id === "string" || (typeof m.id === "number" && Number.isFinite(m.id));
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string" || ("id" in m && !validId))
    return { jsonrpc: "2.0", id: validId ? m.id : null, error: { code: -32600, message: "Invalid request" } };
  // Notifications get no reply.
  if (!("id" in m)) return null;
  const id = m.id;
  const reply = (result: unknown): Json => ({ jsonrpc: "2.0", id, result });
  const fail = (error: RpcError): Json => ({ jsonrpc: "2.0", id, error });
  const params = (m.params ?? {}) as Json;
  try {
    switch (m.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        return reply({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: "glimpse", title: "Glimpse", version: "0.1.0" },
          instructions:
            "Glimpse monitors OpenZCAD, OpenFEA and OpenLattice3D. Start with get_health, then list_issues and get_issue. Use update_issue to acknowledge issues you work on and to note fixes. Glimpse holds aggregates and scrubbed issue metadata only; use the Cloudflare MCP server for raw logs and traces.",
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools });
      case "prompts/list":
        return reply({ prompts });
      case "prompts/get":
        return reply(prompt(String(params.name ?? ""), params.arguments));
      case "tools/call": {
        const name = String(params.name ?? "");
        if (!tools.some((t) => t.name === name)) return fail({ code: -32602, message: `Unknown tool: ${name}` });
        try {
          const result = await call(db, name, params.arguments, now);
          return reply({ content: [{ type: "text", text: JSON.stringify(result) }] });
        } catch (error) {
          // Bad arguments and missing data are tool results the model can read and correct.
          if (error instanceof InvalidParams || error instanceof ToolError)
            return reply({ content: [{ type: "text", text: error.message }], isError: true });
          throw error;
        }
      }
      default:
        return fail({ code: -32601, message: `Method not found: ${m.method}` });
    }
  } catch (error) {
    if (error instanceof InvalidParams) return fail({ code: -32602, message: error.message });
    logFailure("MCP request failed", error);
    return fail({ code: -32603, message: "Internal error" });
  }
}

/** POST /mcp: one JSON-RPC message (or a batch from older clients), answered as JSON. */
export async function mcp(request: Request, db: D1Database, now = new Date()): Promise<Response> {
  const url = new URL(request.url);
  // Browsers send Origin; MCP clients do not. Reject other origins (DNS rebinding, CSRF).
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return new Response("Forbidden origin", { status: 403 });
  if (request.method !== "POST")
    // No server-initiated stream and no sessions: GET and DELETE are not offered.
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  const version = request.headers.get("MCP-Protocol-Version");
  if (version && !VERSIONS.includes(version))
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported protocol version ${version}` } },
      { status: 400 },
    );
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json")
    return new Response("Content-Type must be application/json", { status: 415 });
  const body = await readBody(request, LIMIT);
  if (body === null) return new Response("Payload too large", { status: 413 });
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(message)) {
    if (!message.length || message.length > 20)
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid batch" } }, { status: 400 });
    const replies = (await Promise.all(message.map((m) => handle(db, m, now)))).filter(Boolean);
    return replies.length ? Response.json(replies) : new Response(null, { status: 202 });
  }
  const reply = await handle(db, message, now);
  return reply ? Response.json(reply) : new Response(null, { status: 202 });
}
