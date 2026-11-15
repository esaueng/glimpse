// HTTP surfaces for sources: the public webhook (secret-authenticated, outside Access) and
// the dashboard API for the inbox and source management (behind Access).
import { logFailure } from "../errors";
import { ADAPTERS, CATEGORIES, STATUSES, type Status } from "./model";
import { shape } from "./scrub";
import {
  authenticate,
  createSource,
  deleteSource,
  getIssue,
  ingest,
  listIssues,
  listSources,
  recordDelivery,
  rotateSecret,
  setStatus,
} from "./store";

export const HOOK_PREFIX = "/hooks/";
const HOOK_LIMIT = 64 * 1024;

/** Reads a bounded body; Content-Length alone is not trusted. */
export async function readBody(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return text + decoder.decode();
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const text = (body: string, status: number, headers?: HeadersInit) => new Response(body, { status, headers });

/**
 * POST /hooks/<source id>. The response never says whether a source exists, so a wrong id
 * and a wrong secret look the same. Unrecognised payloads are accepted (Cloudflare would
 * otherwise retry) and their key paths, never values, are kept for the Sources page.
 */
export async function hook(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== "POST") return text("Method not allowed", 405, { Allow: "POST" });
  const id = new URL(request.url).pathname.slice(HOOK_PREFIX.length);
  const body = await readBody(request, HOOK_LIMIT);
  if (body === null) return text("Payload too large", 413);
  // The header name depends on the adapter, so look the source up first.
  const kind = await db
    .prepare("SELECT kind FROM sources WHERE id=?")
    .bind(/^src_[\w-]{6,40}$/.test(id) ? id : "")
    .first<{ kind: string }>();
  const adapter = kind ? ADAPTERS[kind.kind] : undefined;
  const source = adapter ? await authenticate(db, id, request.headers.get(adapter.secretHeader)) : null;
  if (!source || !adapter) return text("Unauthorized", 401);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    await recordDelivery(db, source.id, "rejected: not JSON", null, false);
    return text("Invalid JSON", 400);
  }
  const parsed = adapter.parse(payload),
    keys = shape(payload);
  if (parsed.kind === "test") {
    await recordDelivery(db, source.id, "test received", null, true);
    return text("ok", 202);
  }
  if (parsed.kind === "unrecognised") {
    await recordDelivery(db, source.id, "unrecognised payload", keys, true);
    return text("accepted", 202);
  }
  for (const event of parsed.events) await ingest(db, source.id, event);
  await recordDelivery(db, source.id, `ok: ${parsed.events.length} issue${parsed.events.length === 1 ? "" : "s"}`, keys, true);
  return text("accepted", 202);
}

/** Same-origin JSON body of at most 4 KiB, or an error response. */
async function writeBody(request: Request): Promise<Record<string, unknown> | Response> {
  const url = new URL(request.url);
  if (
    request.headers.get("Origin") !== url.origin ||
    request.headers.get("Content-Type")?.split(";")[0] !== "application/json"
  )
    return text("Same-origin JSON required", 403);
  const body = await readBody(request, 4096);
  if (body === null) return text("Too large", 413);
  try {
    const value: unknown = JSON.parse(body || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Fall through.
  }
  return text("Invalid JSON", 400);
}

const ISSUE_ID = /^iss_[0-9a-f]{16}$/,
  SOURCE_ID = /^src_[\w-]{6,40}$/;

/** /api/issues and /api/sources, behind Access. */
export async function issuesApi(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url),
    parts = url.pathname.split("/").filter(Boolean),
    read = ["GET", "HEAD"].includes(request.method);
  try {
    if (parts[1] === "issues") {
      if (parts.length === 2 && read) {
        const q = url.searchParams,
          status = q.get("status") ?? "active",
          app = q.get("app") ?? "all",
          category = q.get("category") ?? "";
        if (
          ![...STATUSES, "active"].includes(status) ||
          !/^[a-z0-9-]{1,40}$/.test(app) ||
          (category && !(CATEGORIES as readonly string[]).includes(category))
        )
          return text("Invalid filter", 400);
        return json(await listIssues(db, { status: status as Status | "active", app, category: category || undefined }));
      }
      const id = parts[2] ?? "";
      if (parts.length !== 3 || !ISSUE_ID.test(id)) return text("Not found", 404);
      if (read) {
        const issue = await getIssue(db, id);
        return issue ? json(issue) : text("Not found", 404);
      }
      if (request.method !== "POST") return text("Method not allowed", 405, { Allow: "GET, POST" });
      const body = await writeBody(request);
      if (body instanceof Response) return body;
      const keys = Object.keys(body).sort().join(",");
      const note = body.note === undefined || body.note === null ? null : body.note;
      if (
        !["status", "note,status"].includes(keys) ||
        !(STATUSES as readonly unknown[]).includes(body.status) ||
        (note !== null && (typeof note !== "string" || note.length > 500))
      )
        return text("Invalid update", 400);
      return (await setStatus(db, id, body.status as Status, note as string | null, "dashboard"))
        ? new Response(null, { status: 204 })
        : text("Not found", 404);
    }
    if (parts[1] === "sources") {
      if (parts.length === 2 && read)
        return json({
          sources: await listSources(db),
          kinds: Object.values(ADAPTERS).map((a) => ({ kind: a.kind, label: a.label, header: a.secretHeader })),
        });
      if (request.method !== "POST") return text("Method not allowed", 405, { Allow: "GET, POST" });
      const body = await writeBody(request);
      if (body instanceof Response) return body;
      const hookUrl = (id: string) => `${url.origin}${HOOK_PREFIX}${id}`;
      if (parts.length === 2) {
        const adapter = typeof body.kind === "string" ? ADAPTERS[body.kind] : undefined;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!adapter || Object.keys(body).sort().join(",") !== "kind,name" || !name || name.length > 80)
          return text("Invalid source", 400);
        const created = await createSource(db, adapter.kind, name);
        return json({ ...created, url: hookUrl(created.id), header: adapter.secretHeader }, 201);
      }
      const id = parts[2] ?? "";
      if (parts.length !== 3 || !SOURCE_ID.test(id)) return text("Not found", 404);
      if (body.action === "rotate") {
        const secret = await rotateSecret(db, id);
        return secret ? json({ id, secret, url: hookUrl(id) }) : text("Not found", 404);
      }
      if (body.action === "delete")
        return (await deleteSource(db, id)) ? new Response(null, { status: 204 }) : text("Not found", 404);
      return text("Invalid action", 400);
    }
    return text("Not found", 404);
  } catch (error) {
    logFailure("Issues request failed", error);
    return json({ error: "Issues unavailable" }, 503);
  }
}
