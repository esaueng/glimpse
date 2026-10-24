import { configured, readData, setState } from "./store";
import type { MonitorEnv } from "./env";
export async function cloudflareApi(
  request: Request,
  env: MonitorEnv,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.pathname === "/api/cloudflare" &&
    ["GET", "HEAD"].includes(request.method)
  )
    return Response.json(await readData(env));
  if (url.pathname !== "/api/cloudflare/settings")
    return new Response("Not found", { status: 404 });
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  if (!configured(env))
    return new Response("Cloudflare monitor is not configured", {
      status: 409,
    });
  if (
    request.headers.get("Origin") !== url.origin ||
    request.headers.get("Content-Type")?.split(";")[0] !== "application/json"
  )
    return new Response("Same-origin JSON required", { status: 403 });
  // Bound streamed input too; Content-Length alone is not trustworthy.
  const reader = request.body?.getReader();
  let size = 0,
    value = "";
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return new Response("Settings too large", { status: 413 });
      }
      value += decoder.decode(part.value, { stream: true });
    }
    value += decoder.decode();
  }
  let v: any;
  try {
    v = JSON.parse(value);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!v || typeof v !== "object" || Array.isArray(v))
    return new Response("Invalid settings", { status: 400 });
  const keys = Object.keys(v).sort().join(",");
  const budgetValid = (b: unknown) =>
    b === null ||
    (typeof b === "number" && Number.isSafeInteger(b) && b > 0 && b <= 1e12);
  if (keys === "budget" && budgetValid(v.budget))
    await setState(env.DB, "budget", v.budget);
  else if (
    keys === "app,resource" &&
    typeof v.app === "string" &&
    typeof v.resource === "string" &&
    v.app.length <= 200 &&
    v.resource.length <= 400
  ) {
    const exists = await env.DB.prepare("SELECT id FROM cf_apps WHERE id=?")
      .bind(v.app)
      .first();
    if (!exists) return new Response("Unknown app", { status: 400 });
    const updated = await env.DB.prepare(
      "UPDATE cf_resources SET app=?,manual=1 WHERE id=?",
    )
      .bind(v.app, v.resource)
      .run();
    if (!updated.meta.changes)
      return new Response("Unknown resource", { status: 400 });
  } else if (
    keys === "budget,id,name,visibility" &&
    typeof v.id === "string" &&
    /^[a-zA-Z0-9:_-]{1,200}$/.test(v.id) &&
    typeof v.name === "string" &&
    v.name.trim().length > 0 &&
    v.name.length <= 100 &&
    ["public", "private", "unknown"].includes(v.visibility) &&
    budgetValid(v.budget)
  ) {
    if (["shared", "unassigned"].includes(v.id))
      return new Response("Reserved app", { status: 400 });
    await env.DB.prepare(
      "INSERT INTO cf_apps(id,name,visibility,budget) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,visibility=excluded.visibility,budget=excluded.budget",
    )
      .bind(v.id, v.name.trim(), v.visibility, v.budget)
      .run();
  } else return new Response("Invalid settings", { status: 400 });
  return new Response(null, { status: 204 });
}
