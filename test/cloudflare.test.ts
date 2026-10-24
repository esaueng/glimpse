import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";
import {
  allocate,
  alerts,
  billingPeriods,
  emptyData,
  forecast,
  normalizeCharges,
  validRange,
  type Charge,
} from "../src/cloudflare/model";
import {
  CloudflareClient,
  datasets,
  usageRows,
} from "../src/cloudflare/client";
import { cloudflareDemo } from "../web/cloudflare-demo";
const now = new Date("2026-10-24T12:00:00Z");
const period = {
  start: "2026-09-28T00:00:00.000Z",
  end: "2026-10-28T00:00:00.000Z",
};
const billingRow = {
  SubscriptionId: "sample-sub",
  BillingPeriodStart: period.start,
  ChargePeriodStart: "2026-10-23T00:00:00Z",
  ChargePeriodEnd: "2026-10-24T00:00:00Z",
  ServiceFamilyName: "D1",
  ServiceName: "D1 Rows Written",
  ChargeDescription: "D1 Rows Written",
  ConsumedUnit: "rows",
  ConsumedQuantity: 100,
  ContractedCost: 1.5,
  CumulatedContractedCost: 999,
  BillingCurrency: "USD",
};
describe("Cloudflare billing semantics", () => {
  it("uses the subscription anchor and clamps short months", () => {
    expect(
      billingPeriods(
        {
          subscriptions: [
            { billing_cycle_anchor_timestamp: "2026-02-28T00:00:00Z" },
          ],
        },
        now,
      ),
    ).toEqual([period]);
    expect(
      billingPeriods(
        {
          subscriptions: [
            { billing_cycle_anchor_timestamp: "2026-01-31T00:00:00Z" },
          ],
        },
        new Date("2026-02-28T12:00:00Z"),
      ),
    ).toEqual([
      { start: "2026-02-28T00:00:00.000Z", end: "2026-03-31T00:00:00.000Z" },
    ]);
  });
  it("replaces corrected charge identities and ignores cumulative amounts", async () => {
    const [first] = await normalizeCharges([billingRow], [period]);
    const [corrected] = await normalizeCharges(
      [{ ...billingRow, ContractedCost: 2, ConsumedQuantity: 150 }],
      [period],
    );
    expect(first!.cost).toBe(1500000);
    expect(corrected!.cost).toBe(2000000);
    expect(first!.id).toBe(corrected!.id);
    expect(first!.periodEnd).toBe(period.end);
    await expect(
      normalizeCharges(
        [{ ...billingRow, ContractedCost: undefined }],
        [period],
      ),
    ).rejects.toThrow();
    await expect(
      normalizeCharges(
        [{ ...billingRow, BillingCurrency: undefined }],
        [period],
      ),
    ).rejects.toThrow();
  });
  it("allocates account charges once, retains shared and unsupported costs, and preserves integer totals", async () => {
    const charges = await normalizeCharges(
      [
        billingRow,
        {
          ...billingRow,
          ServiceName: "R2 Storage",
          ServiceFamilyName: "R2",
          ChargeDescription: "R2 Storage",
          ContractedCost: 0.33,
        },
      ],
      [period],
    );
    const usage = [
      {
        day: "2026-10-23",
        resource: "D1:a",
        metric: "rowsWritten",
        value: 75,
        unit: "rows",
        aggregation: "sum" as const,
      },
      {
        day: "2026-10-23",
        resource: "D1:b",
        metric: "rowsWritten",
        value: 25,
        unit: "rows",
        aggregation: "sum" as const,
      },
    ];
    const resources = [
      {
        id: "D1:a",
        nativeId: "a",
        name: "A",
        kind: "D1" as const,
        app: "app-a",
        active: true,
      },
      {
        id: "D1:b",
        nativeId: "b",
        name: "B",
        kind: "D1" as const,
        app: "shared",
        active: true,
      },
    ];
    const allocated = allocate(charges, usage, resources);
    expect(allocated.get("app-a")).toBe(1125000);
    expect(allocated.get("shared")).toBe(375000);
    expect(allocated.get("unassigned")).toBe(330000);
    expect([...allocated.values()].reduce((a, b) => a + b, 0)).toBe(1830000);
    expect(allocate(charges, [], resources).get("unassigned")).toBe(1830000);
  });
  it("does not forecast from insufficient data and validates actual date ranges", () => {
    expect(forecast([], period, now)).toBeNull();
    const charge = {
      ...billingRow,
      start: "2026-09-28T00:00:00Z",
      end: "2026-09-29T00:00:00Z",
      periodStart: period.start,
      cost: 1e6,
    } as unknown as Charge;
    expect(forecast([charge], period, now)).toBeNull();
    expect(validRange("2026-02-30", "2026-03-01", now)).toBe(false);
    expect(validRange("2026-10-01", "2026-10-24", now)).toBe(true);
  });
  it("retains account-level R2 operations when no bucket dimension exists", () => {
    const dataset = datasets.find(
      (d) => d.name === "r2OperationsAdaptiveGroups",
    )!;
    expect(
      usageRows(
        dataset,
        [{ dimensions: { bucketName: "" }, sum: { requests: 6 } }],
        "2026-10-24",
      )[0],
    ).toMatchObject({ resource: "R2:@account", value: 6 });
  });
  it("preserves correction signs and tiny currency amounts across many apps", async () => {
    const [charge] = await normalizeCharges(
      [{ ...billingRow, ContractedCost: 0.000007 }],
      [period],
    );
    const resources = Array.from({ length: 12 }, (_, i) => ({
      id: `D1:${i}`,
      nativeId: String(i),
      name: String(i),
      kind: "D1" as const,
      app: `app-${i}`,
      active: true,
    }));
    const usage = resources.map((r) => ({
      day: "2026-10-23",
      resource: r.id,
      metric: "rowsWritten",
      value: 1,
      unit: "rows",
      aggregation: "sum" as const,
    }));
    const positive = [...allocate([charge!], usage, resources).values()];
    expect(positive.reduce((a, b) => a + b, 0)).toBe(7);
    expect(positive.every((n) => n >= 0)).toBe(true);
    const [correction] = await normalizeCharges(
      [{ ...billingRow, ContractedCost: -0.000007, ConsumedQuantity: -7 }],
      [period],
    );
    const negative = [...allocate([correction!], usage, resources).values()];
    expect(negative.reduce((a, b) => a + b, 0)).toBe(-7);
    expect(negative.every((n) => n <= 0)).toBe(true);
  });
  it("raises budget and stale-source warnings without treating unavailable as zero", () => {
    const data = cloudflareDemo(now);
    data.budget = 1e6;
    data.coverage.push({
      source: "D1 inventory",
      status: "unavailable",
      message: "Permission unavailable.",
      checkedAt: now.toISOString(),
      lastSuccess: null,
    });
    expect(alerts(data, now).some((a) => a.id.startsWith("budget:"))).toBe(
      true,
    );
    expect(
      alerts(data, now).some((a) =>
        a.message.includes("Permission unavailable"),
      ),
    ).toBe(true);
    expect(alerts(emptyData(), now)).toEqual([]);
  });
  it("uses a fixed origin, refuses redirects, reports auth failures, and bounds retries", async () => {
    const transport = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response("", { status: 403 }),
    );
    await expect(
      new CloudflareClient(
        "a".repeat(32),
        "test-token",
        transport,
      ).accountRequest("/billable-usage"),
    ).rejects.toMatchObject({ status: 403 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/billable-usage`,
    );
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
  it("uses the provider's Pages and subscription pagination limits", async () => {
    const transport = vi.fn(async (_url: RequestInfo | URL) =>
      Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      }),
    );
    const client = new CloudflareClient(
      "a".repeat(32),
      "test-token",
      transport,
    );
    await client.list("/pages/projects");
    await client.list("/subscriptions");
    expect(String(transport.mock.calls[0]![0])).toContain("per_page=10");
    expect(String(transport.mock.calls[1]![0])).toContain("per_page=50");
  });
  it("uses the native Workers fetch implementation and withholds redirects", async () => {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import {CloudflareClient} from './src/cloudflare/client';export default {async fetch(){try{await new CloudflareClient('${"a".repeat(32)}','test-only-credential').accountRequest('');return new Response('unexpected');}catch(e){return Response.json({status:e.status});}}};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
    });
    const outbound = vi.fn(
      async (_request: unknown) =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://other.invalid/" },
        }),
    );
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0]!.text,
        compatibilityDate: "2026-10-15",
        compatibilityFlags: ["nodejs_compat"],
        outboundService: outbound,
      }),
    );
    try {
      expect(
        await (await runtime.dispatchFetch("https://local.invalid/")).json(),
      ).toEqual({ status: 302 });
      expect(outbound).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.dispose();
    }
  });
});
let mf: Miniflare;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { collect } from './src/cloudflare/collect';
    import { cloudflareApi } from './src/cloudflare/api';
    let fail=false;
    const reply=result=>Response.json({success:true,result});
    const transport=async (url,init)=>{
      const path=new URL(url).pathname;
      if(path.endsWith('/graphql')) {
        const query=JSON.parse(init.body).query;
        if(fail && query.includes('d1Analytics')) return Response.json({errors:[{message:'private provider detail'}]});
        const name=query.match(/metrics: (\\w+)/)[1];
        const defs={workersInvocationsAdaptive:['scriptName','app-a','sum',{requests:100,errors:1,cpuTimeUs:7000}],d1AnalyticsAdaptiveGroups:['databaseId','sample-db','sum',{rowsRead:200,rowsWritten:100}],d1StorageAdaptiveGroups:['databaseId','sample-db','max',{databaseSizeBytes:2048}],r2OperationsAdaptiveGroups:['bucketName','sample-bucket','sum',{requests:10}],r2StorageAdaptiveGroups:['bucketName','sample-bucket','max',{payloadSize:1024}],kvOperationsAdaptiveGroups:['namespaceId','sample-kv','sum',{requests:2}],durableObjectsInvocationsAdaptiveGroups:['namespaceId','sample-do','sum',{requests:3}],durableObjectsPeriodicGroups:['namespaceId','sample-do','sum',{duration:1000,rowsRead:0,rowsWritten:0}],containersUsageAdaptiveGroups:['applicationId','sample-container','sum',{cpuTimeSec:1,allocatedMemory:100,allocatedDisk:100,txBytes:1}],queueMessageOperationsAdaptiveGroups:['queueId','sample-queue','sum',{billableOperations:5}]};
        const [dimension,id,group,values]=defs[name];
        return Response.json({data:{viewer:{accounts:[{metrics:[{dimensions:{[dimension]:id},[group]:values}]}]}}});
      }
      if(path.endsWith('/settings')) return reply({bindings:[{type:'d1',id:'sample-db'},{type:'plain_text',name:'DO_NOT_STORE',text:'private-config'}]});
      const map={
        '':{name:'Esau'},'/workers/scripts':[{id:'app-a'},{id:'app-b'}],'/pages/projects':[],
        '/d1/database':[{uuid:'sample-db',name:'sample-db'}],'/r2/buckets':{buckets:[{name:'sample-bucket'}]},
        '/storage/kv/namespaces':[{id:'sample-kv',title:'sample-kv'}],'/workers/durable_objects/namespaces':[{id:'sample-do',name:'sample-do',script:'app-a'}],
        '/containers/applications':[{id:'sample-container',name:'app-a-container'}],'/queues':[{queue_id:'sample-queue',queue_name:'app-a-queue'}],
        '/billable-usage/info':{covered:true,subscriptions:[{billing_cycle_anchor_timestamp:'2026-02-28T00:00:00Z'}]},
        '/billable-usage':${JSON.stringify([billingRow])},
        '/subscriptions':[{id:'sample-plan',rate_plan:{public_name:'Sample Plan'},price:5,currency:'USD',frequency:'monthly',current_period_end:'2026-10-28T00:00:00Z'}]
      };
      const suffix=path.replace(/^\\/client\\/v4\\/accounts\\/[a-f0-9]+/,'');
      return reply(map[suffix]);
    };
    export default {async fetch(request,env){
      const path=new URL(request.url).pathname;
      if(path==='/_test/collect'){await collect(env,new Date('2026-10-24T12:00:00Z'),transport);return new Response('ok');}
      if(path==='/_test/fail'){fail=true;return new Response('ok');}
      return cloudflareApi(request,env);
    }};
  `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      bindings: {
        CF_MONITOR_ENABLED: "true",
        CF_ACCOUNT_ID: "a".repeat(32),
        CF_API_TOKEN: "test-only-credential",
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  await db.exec(
    readFileSync("migrations/0004_cloudflare.sql", "utf8")
      .replace(/--[^\n]*/g, "")
      .replace(/\n/g, " "),
  );
});
afterAll(async () => {
  await mf?.dispose();
});
describe("Cloudflare collection and protected settings persistence", () => {
  it("discovers resources, recognizes shared bindings, and never stores variables", async () => {
    expect(
      (await mf.dispatchFetch("https://example.test/_test/collect")).status,
    ).toBe(200);
    const data = (await (
      await mf.dispatchFetch("https://example.test/api/cloudflare")
    ).json()) as any;
    expect(data.apps.map((a: any) => a.id)).toContain("app-a");
    expect(data.resources.find((r: any) => r.id === "D1:sample-db").app).toBe(
      "shared",
    );
    expect(data.coverage.every((s: any) => s.status === "ok")).toBe(true);
    expect(data.charges).toHaveLength(1);
    expect(data.charges[0].cost).toBe(1500000);
    expect(JSON.stringify(data)).not.toMatch(
      /private-config|test-only-credential|DO_NOT_STORE/,
    );
  });
  it("reconciles charges and daily counters without adding cumulative values", async () => {
    const db = await mf.getD1Database("DB");
    const before = await db
      .prepare(
        "SELECT value FROM cf_usage WHERE day='2026-10-23' AND metric='rowsWritten'",
      )
      .first<any>();
    await mf.dispatchFetch("https://example.test/_test/collect");
    expect(
      await db
        .prepare(
          "SELECT value FROM cf_usage WHERE day='2026-10-23' AND metric='rowsWritten'",
        )
        .first(),
    ).toEqual(before);
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM cf_charges").first<any>()).n,
    ).toBe(1);
  });
  it("requires same-origin bounded JSON, validates app identity, and persists manual mappings", async () => {
    const endpoint = "https://example.test/api/cloudflare/settings";
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"budget":10000000}',
        })
      ).status,
    ).toBe(403);
    const headers = {
      "Content-Type": "application/json",
      Origin: "https://example.test",
    };
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ resource: "D1:sample-db", app: "missing" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ budget: NaN }),
        })
      ).status,
    ).toBe(204); // JSON encodes NaN as null: explicitly clears a budget.
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ budget: -1 }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ resource: "D1:sample-db", app: "app-a" }),
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers,
          body: " ".repeat(9000),
        })
      ).status,
    ).toBe(413);
    const db = await mf.getD1Database("DB");
    // Exercise daily rediscovery rather than only the hourly usage refresh.
    await db.prepare("DELETE FROM cf_state WHERE key='discovered'").run();
    await mf.dispatchFetch("https://example.test/_test/collect");
    expect(
      await db
        .prepare("SELECT app,manual FROM cf_resources WHERE id='D1:sample-db'")
        .first<any>(),
    ).toEqual({ app: "app-a", manual: 1 });
  });
  it("retains last successful usage on schema/permission failures and redacts provider details", async () => {
    const db = await mf.getD1Database("DB");
    const before = await db
      .prepare(
        "SELECT value FROM cf_usage WHERE day='2026-10-23' AND metric='rowsWritten'",
      )
      .first();
    await mf.dispatchFetch("https://example.test/_test/fail");
    await mf.dispatchFetch("https://example.test/_test/collect");
    expect(
      await db
        .prepare(
          "SELECT value FROM cf_usage WHERE day='2026-10-23' AND metric='rowsWritten'",
        )
        .first(),
    ).toEqual(before);
    const data = (await (
      await mf.dispatchFetch("https://example.test/api/cloudflare")
    ).json()) as any;
    expect(
      data.coverage.some(
        (c: any) => c.status === "unsupported" && c.lastSuccess,
      ),
    ).toBe(true);
    expect(JSON.stringify(data)).not.toContain("private provider detail");
  });
});
