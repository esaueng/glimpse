import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { applyMigrations, MIGRATION_FILES } from "./d1-migrations";

const origin = "https://glimpse.test";
const issuer = "https://test.cloudflareaccess.com";
let mf: Miniflare, token: string, serviceToken: string;
type Init = { method?: string; body?: string; headers?: Record<string, string> };
type Fetcher = { fetch(url: string, init?: Init): Promise<Response> };

const post = (body: unknown, headers: Record<string, string> = {}, worker?: Fetcher) =>
  (worker ?? { fetch: (u: string, i?: Init) => mf.dispatchFetch(u, i) }).fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      "Cf-Access-Jwt-Assertion": token,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
let next = 1;
async function rpc(method: string, params?: unknown, worker?: Fetcher) {
  const res = await post({ jsonrpc: "2.0", id: next++, method, ...(params ? { params } : {}) }, {}, worker);
  return (await res.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}
async function tool(name: string, args?: unknown, worker?: Fetcher) {
  const { result, error } = await rpc("tools/call", { name, ...(args ? { arguments: args } : {}) }, worker);
  if (error) throw new Error(error.message);
  const content = result!.content as { text: string }[];
  return { isError: !!result!.isError, text: content[0]!.text, json: () => JSON.parse(content[0]!.text) };
}

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" };
  token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(issuer)
    .setAudience("dashboard")
    .setSubject("test")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(keys.privateKey);
  // Shaped like an Access service-token JWT: empty subject, client id as common_name.
  serviceToken = await new SignJWT({ common_name: "automation.access" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(issuer)
    .setAudience("dashboard")
    .setSubject("")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(keys.privateKey);
  const bundle = await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    external: ["cloudflare:workers"],
  });
  const worker = (name: string, db: string) => ({
    name,
    modules: true,
    script: bundle.outputFiles[0]!.text,
    compatibilityDate: "2026-10-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: db },
    bindings: { ACCESS_ISSUER: issuer, ACCESS_AUD: "dashboard" },
    serviceBindings: { ASSETS: () => new Response("<h1>Glimpse</h1>") },
    outboundService: () =>
      new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } }),
  });
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [worker("glimpse", "db"), worker("pending", "pending-db")] }));
  const db = await mf.getD1Database("DB", "glimpse");
  await applyMigrations(db);
  await applyMigrations(
    await mf.getD1Database("DB", "pending"),
    MIGRATION_FILES.filter((f) => f !== "0006_issues.sql"),
  );
  const today = new Date().toISOString().slice(0, 10);
  for (const [app, event, bucket, count] of [
    ["openzcad", "api_request", "none", 1000],
    ["openzcad", "api_error", "none", 80],
    ["openzcad", "api_latency", "lt_100ms", 1000],
    ["openfea", "api_request", "none", 500],
    ["openfea", "api_latency", "lt_100ms", 500],
  ] as const)
    await db
      .prepare("INSERT INTO daily_counts(day,app,level,event,bucket,count) VALUES(?,?,'basic',?,?,?)")
      .bind(today, app, event, bucket, count)
      .run();
}, 30000);
afterAll(() => mf?.dispose());

describe("MCP transport", () => {
  it("requires Access and rejects other origins, methods and content types", async () => {
    expect((await mf.dispatchFetch(`${origin}/mcp`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await post({}, { Origin: "https://evil.test" })).status).toBe(403);
    expect(
      (await mf.dispatchFetch(`${origin}/mcp`, { headers: { "Cf-Access-Jwt-Assertion": token } })).status,
    ).toBe(405);
    expect((await post("{}", { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post({}, { "MCP-Protocol-Version": "1999-01-01" })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
  });
  it("accepts an Access service-token JWT with an empty subject", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "Cf-Access-Jwt-Assertion": serviceToken });
    expect(res.status).toBe(200);
  });
  it("negotiates the protocol and answers notifications with 202", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "glimpse" },
      capabilities: { tools: {}, prompts: {} },
    });
    expect((await rpc("initialize", { protocolVersion: "2099-01-01" })).result!.protocolVersion).toBe("2025-11-25");
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await rpc("ping")).result).toEqual({});
    expect((await rpc("nope")).error!.code).toBe(-32601);
  });
  it("lists tools with schemas and read-only hints", async () => {
    const { tools } = (await rpc("tools/list")).result as {
      tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
    };
    expect(tools.map((t) => t.name)).toEqual([
      "get_health",
      "get_metrics",
      "list_issues",
      "get_issue",
      "update_issue",
      "list_sources",
    ]);
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual(["update_issue"]);
  });
  it("answers a batch from older clients", async () => {
    const res = await post([
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(await res.json()).toEqual([{ jsonrpc: "2.0", id: "a", result: {} }]);
  });
});

describe("MCP tools", () => {
  it("reports app health and what needs attention", async () => {
    const health = (await tool("get_health", { days: 7 })).json();
    const zcad = health.apps.find((a: { app: string }) => a.app === "openzcad");
    expect(zcad).toMatchObject({ status: "failing", requests: 1000, serverErrors: 80, serverErrorShare: 0.08 });
    expect(health.apps.find((a: { app: string }) => a.app === "openfea").status).toBe("healthy");
    expect(health.needsAttention[0]).toMatchObject({ severity: "critical", app: "openzcad", view: "issues" });
    expect(health.openIssues).toEqual({ open: 0, acknowledged: 0 });
  });
  it("returns daily metrics", async () => {
    const metrics = (await tool("get_metrics", { app: "openzcad", days: 3 })).json();
    expect(metrics.daily.at(-1)).toMatchObject({ "openzcad.requests": 1000, "openzcad.errors": 80 });
    expect(metrics.apiResponseTime.openzcad.lt_100ms).toBe(1000);
    expect(Object.keys(metrics.failuresOptedIn)).toEqual(["openzcad"]);
  });
  it("reports bad arguments as tool errors the model can correct", async () => {
    const bad = await tool("get_health", { days: 400 });
    expect(bad).toMatchObject({ isError: true, text: "days must be an integer from 1 to 90" });
    expect((await tool("get_issue", { id: "x" })).isError).toBe(true);
    expect((await tool("list_sources", { extra: 1 })).text).toBe("Unknown argument: extra");
    expect((await rpc("tools/call", { name: "drop_tables" })).error!.code).toBe(-32602);
  });
  it("lists, reads and updates issues as an agent", async () => {
    const api = (path: string, body?: unknown) =>
      mf.dispatchFetch(`${origin}${path}`, {
        method: body ? "POST" : "GET",
        headers: { "Cf-Access-Jwt-Assertion": token, Origin: origin, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const { id: source, secret } = (await (
      await api("/api/sources", { kind: "cloudflare-issues", name: "Workers Issues" })
    ).json()) as Record<string, string>;
    await mf.dispatchFetch(`${origin}/hooks/${source}`, {
      method: "POST",
      headers: { "cf-webhook-auth": secret, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "TypeError: boom",
        data: { issue: { id: "x1", script_name: "openzcad", stack: "TypeError\n    at f (a.ts:1:2)" } },
      }),
    });
    const list = (await tool("list_issues", { app: "openzcad" })).json();
    expect(list.issues).toHaveLength(1);
    const id = list.issues[0].id;
    expect(list.issues[0]).toMatchObject({ title: "TypeError: boom", worker: "openzcad", status: "open" });

    const issue = (await tool("get_issue", { id })).json();
    expect(issue.detail.frames).toEqual(["f (a.ts:1:2)"]);
    expect(issue).not.toHaveProperty("fingerprint");

    expect((await tool("update_issue", { id })).text).toBe("Give a status, a note, or both");
    expect((await tool("update_issue", { id, status: "acknowledged", note: "Investigating" })).json()).toEqual({
      id,
      status: "acknowledged",
      note: "Investigating",
    });
    expect((await tool("update_issue", { id, note: "Fix in PR #12" })).json()).toMatchObject({
      status: "acknowledged",
      note: "Fix in PR #12",
    });
    const after = (await tool("get_issue", { id })).json();
    expect(after.activity.map((a: { kind: string }) => a.kind).slice(0, 2)).toEqual([
      "note by agent",
      "acknowledged by agent",
    ]);
    expect((await tool("list_sources")).json().sources[0]).not.toHaveProperty("secret_hash");
    expect((await tool("update_issue", { id: "iss_0000000000000000", status: "resolved" })).isError).toBe(true);
  });
  it("offers an investigation prompt", async () => {
    const { result } = await rpc("prompts/get", { name: "investigate_issue", arguments: { issue_id: "iss_0123456789abcdef" } });
    const text = (result!.messages as { content: { text: string } }[])[0]!.content.text;
    expect(text).toContain("get_issue with id iss_0123456789abcdef");
    expect((await rpc("prompts/get", { name: "investigate_issue", arguments: { issue_id: "bad" } })).error!.code).toBe(-32602);
  });
  it("explains a pending migration instead of failing", async () => {
    const pending = (await mf.getWorker("pending")) as unknown as Fetcher;
    const res = await tool("list_issues", {}, pending);
    expect(res).toMatchObject({ isError: true, text: "Database migration pending: 0006_issues.sql" });
    expect((await tool("get_health", {}, pending)).json().openIssues).toBe("inbox not set up");
  });
});
