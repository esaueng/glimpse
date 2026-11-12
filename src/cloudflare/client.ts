import {
  finite,
  resourceKey,
  text,
  type ResourceKind,
  type Usage,
} from "./model";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    public status: number,
    public reason = "Cloudflare API unavailable",
  ) {
    super(reason);
  }
}
// Provider JSON is untrusted: callers narrow every field before use.
export type Row = Record<string, unknown>;
export type Envelope = {
  success?: unknown;
  result?: unknown;
  result_info?: unknown;
  errors?: unknown;
  data?: unknown;
};
export const isRecord = (value: unknown): value is Row =>
  !!value && typeof value === "object" && !Array.isArray(value);
const ATTEMPTS = 3;
const backoff = (attempt: number, retryAfter?: string | null) =>
  new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.min(
        5000,
        Math.max(250, Number(retryAfter) * 1000 || 500 * 2 ** attempt),
      ),
    ),
  );
// Classifies GraphQL `errors`. Only schema/entitlement errors mean the dataset is unsupported
// for this account; rate limits and timeouts are transient; anything else is a failure.
export function graphqlFailure(
  errors: unknown,
): "unsupported" | "transient" | "failed" {
  const list = Array.isArray(errors) ? errors : [errors];
  const describe = (e: unknown) => {
    const v = isRecord(e) ? e : {};
    const extensions = isRecord(v.extensions) ? v.extensions : {};
    return `${typeof v.message === "string" ? v.message : ""} ${typeof extensions.code === "string" ? extensions.code : ""}`.toLowerCase();
  };
  const text = list.map(describe);
  if (
    text.some((t) =>
      /rate.?limit|budget depleted|too many requests|timeout|timed out|try again/.test(
        t,
      ),
    )
  )
    return "transient";
  if (
    text.length &&
    text.every((t) =>
      /unknown field|cannot query field|unknown type|unknown argument|does not have access|not have access|no access|not entitled|not enabled|authz/.test(
        t,
      ),
    )
  )
    return "unsupported";
  return "failed";
}
export class CloudflareClient {
  constructor(
    readonly account: string,
    private token: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
  ) {
    if (!/^[a-f0-9]{32}$/.test(account) || !token)
      throw new Error("Monitor connection not configured");
  }
  async request(
    path: string,
    body?: unknown,
    transient?: (json: Envelope) => boolean,
  ): Promise<Envelope> {
    // Fixed provider origin; no endpoint, account or credentials accepted from the browser.
    const url = `https://api.cloudflare.com/client/v4${path}`;
    // One bounded budget covers network errors, timeouts, 429/5xx and transient GraphQL errors.
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const last = attempt === ATTEMPTS - 1;
      let response: Response;
      try {
        response = await this.transport(url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15000),
          redirect: "manual",
        });
      } catch {
        if (last) throw new ApiError(0);
        await backoff(attempt);
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && !last) {
        await response.body?.cancel();
        await backoff(attempt, response.headers.get("Retry-After"));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(response.status);
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new ApiError(502, "Invalid Cloudflare response");
      }
      if (!isRecord(json)) throw new ApiError(502, "Invalid Cloudflare response");
      if (json.success === false) throw new ApiError(502);
      if (!last && transient?.(json)) {
        await backoff(attempt);
        continue;
      }
      return json;
    }
    throw new ApiError(503);
  }
  async accountRequest(path: string) {
    return this.request(`/accounts/${this.account}${path}`);
  }
  async list(path: string, nested?: string): Promise<Row[]> {
    const all: Row[] = [];
    const perPage = path.startsWith("/pages/")
      ? 10
      : path === "/subscriptions"
        ? 50
        : 100;
    let cursor: string | undefined;
    for (let page = 1; page <= 25; page++) {
      const json = await this.accountRequest(
        `${path}${path.includes("?") ? "&" : "?"}${cursor ? `cursor=${encodeURIComponent(cursor)}` : `page=${page}`}&per_page=${perPage}`,
      );
      const rows = nested
        ? isRecord(json.result)
          ? json.result[nested]
          : undefined
        : json.result;
      if (!Array.isArray(rows) || !rows.every(isRecord))
        throw new ApiError(502, "Invalid resource listing");
      all.push(...rows);
      const info = isRecord(json.result_info) ? json.result_info : undefined;
      if (info && "cursor" in info) {
        cursor = typeof info.cursor === "string" && info.cursor ? info.cursor : undefined;
        if (!cursor) return all;
        continue;
      }
      const pages = typeof info?.total_pages === "number" ? info.total_pages : 0;
      if (pages ? page >= pages : rows.length < perPage) return all;
    }
    throw new ApiError(413, "Resource listing exceeds collection limit");
  }
  async graphql(selection: string, day: string): Promise<Row[]> {
    const next = new Date(Date.parse(day) + 86400000).toISOString();
    const failed = (json: Envelope) =>
      Array.isArray(json.errors) && json.errors.length > 0;
    const json = await this.request(
      "/graphql",
      {
        query: `query { viewer { accounts(filter: { accountTag: "${this.account}" }) { ${selection.replaceAll("$start", JSON.stringify(`${day}T00:00:00Z`)).replaceAll("$end", JSON.stringify(next))} } } }`,
      },
      (json) => failed(json) && graphqlFailure(json.errors) === "transient",
    );
    if (failed(json)) {
      const kind = graphqlFailure(json.errors);
      throw kind === "unsupported"
        ? new ApiError(422, "Analytics dataset unavailable for this connection")
        : kind === "transient"
          ? new ApiError(429, "Analytics temporarily unavailable")
          : new ApiError(502, "Analytics query failed");
    }
    const viewer = isRecord(json.data) ? json.data.viewer : undefined;
    const accounts = isRecord(viewer) ? viewer.accounts : undefined;
    const account = Array.isArray(accounts) ? accounts[0] : undefined;
    const rows = isRecord(account) ? account.metrics : undefined;
    if (!Array.isArray(rows) || !rows.every(isRecord))
      throw new ApiError(502, "Analytics response missing");
    if (rows.length >= 10000)
      throw new ApiError(
        413,
        "Analytics result truncated; collection withheld",
      );
    return rows;
  }
}
export const inventories: {
  kind: ResourceKind;
  path: string;
  nested?: string;
  id: string;
  name: string;
}[] = [
  { kind: "Workers", path: "/workers/scripts", id: "id", name: "id" },
  { kind: "Pages", path: "/pages/projects", id: "name", name: "name" },
  { kind: "D1", path: "/d1/database", id: "uuid", name: "name" },
  {
    kind: "R2",
    path: "/r2/buckets",
    nested: "buckets",
    id: "name",
    name: "name",
  },
  { kind: "KV", path: "/storage/kv/namespaces", id: "id", name: "title" },
  {
    kind: "Durable Objects",
    path: "/workers/durable_objects/namespaces",
    id: "id",
    name: "name",
  },
  {
    kind: "Containers",
    path: "/containers/applications",
    id: "id",
    name: "name",
  },
  { kind: "Queues", path: "/queues", id: "queue_id", name: "queue_name" },
];
type Field = {
  field: string;
  metric: string;
  unit: string;
  group: "sum" | "max" | "quantiles";
};
export const datasets: {
  name: string;
  kind: ResourceKind;
  dimension: string;
  fields: Field[];
}[] = [
  {
    name: "workersInvocationsAdaptive",
    kind: "Workers",
    dimension: "scriptName",
    fields: [
      {
        field: "requests",
        metric: "workerRequests",
        unit: "requests",
        group: "sum",
      },
      { field: "errors", metric: "workerErrors", unit: "errors", group: "sum" },
      {
        field: "cpuTimeUs",
        metric: "workerCpuUs",
        unit: "microseconds",
        group: "sum",
      },
    ],
  },
  {
    name: "d1AnalyticsAdaptiveGroups",
    kind: "D1",
    dimension: "databaseId",
    fields: [
      { field: "rowsRead", metric: "rowsRead", unit: "rows", group: "sum" },
      {
        field: "rowsWritten",
        metric: "rowsWritten",
        unit: "rows",
        group: "sum",
      },
    ],
  },
  {
    name: "d1StorageAdaptiveGroups",
    kind: "D1",
    dimension: "databaseId",
    fields: [
      {
        field: "databaseSizeBytes",
        metric: "databaseSizeBytes",
        unit: "bytes",
        group: "max",
      },
    ],
  },
  {
    name: "r2OperationsAdaptiveGroups",
    kind: "R2",
    dimension: "bucketName",
    fields: [
      {
        field: "requests",
        metric: "r2Operations",
        unit: "operations",
        group: "sum",
      },
    ],
  },
  {
    name: "r2StorageAdaptiveGroups",
    kind: "R2",
    dimension: "bucketName",
    fields: [
      {
        field: "payloadSize",
        metric: "r2StorageBytes",
        unit: "bytes",
        group: "max",
      },
    ],
  },
  {
    name: "kvOperationsAdaptiveGroups",
    kind: "KV",
    dimension: "namespaceId",
    fields: [
      {
        field: "requests",
        metric: "kvOperations",
        unit: "operations",
        group: "sum",
      },
    ],
  },
  {
    name: "durableObjectsInvocationsAdaptiveGroups",
    kind: "Durable Objects",
    dimension: "namespaceId",
    fields: [
      {
        field: "requests",
        metric: "doRequests",
        unit: "requests",
        group: "sum",
      },
    ],
  },
  {
    name: "durableObjectsPeriodicGroups",
    kind: "Durable Objects",
    dimension: "namespaceId",
    fields: [
      {
        field: "duration",
        metric: "doDuration",
        unit: "GB-seconds",
        group: "sum",
      },
      { field: "rowsRead", metric: "doRowsRead", unit: "rows", group: "sum" },
      {
        field: "rowsWritten",
        metric: "doRowsWritten",
        unit: "rows",
        group: "sum",
      },
    ],
  },
  {
    name: "containersUsageAdaptiveGroups",
    kind: "Containers",
    dimension: "applicationId",
    fields: [
      {
        field: "cpuTimeSec",
        metric: "containerCpuSeconds",
        unit: "seconds",
        group: "sum",
      },
      {
        field: "allocatedMemory",
        metric: "containerMemory",
        unit: "byte-seconds",
        group: "sum",
      },
      {
        field: "allocatedDisk",
        metric: "containerDisk",
        unit: "byte-seconds",
        group: "sum",
      },
      {
        field: "txBytes",
        metric: "containerEgress",
        unit: "bytes",
        group: "sum",
      },
    ],
  },
  {
    name: "queueMessageOperationsAdaptiveGroups",
    kind: "Queues",
    dimension: "queueId",
    fields: [
      {
        field: "billableOperations",
        metric: "queueOperations",
        unit: "operations",
        group: "sum",
      },
    ],
  },
];
export function analyticsSelection(dataset: (typeof datasets)[number]) {
  const groups = [...new Set(dataset.fields.map((f) => f.group))]
    .map(
      (group) =>
        `${group} { ${dataset.fields
          .filter((f) => f.group === group)
          .map((f) => f.field)
          .join(" ")} }`,
    )
    .join(" ");
  return `metrics: ${dataset.name}(limit: 10000, filter: { datetime_geq: $start, datetime_lt: $end }) { dimensions { ${dataset.dimension} } ${groups} }`;
}
export function usageRows(
  dataset: (typeof datasets)[number],
  rows: Row[],
  day: string,
): Usage[] {
  return rows.flatMap((row) => {
    const dimensions = row.dimensions;
    if (!isRecord(dimensions) || !(dataset.dimension in dimensions))
      throw new ApiError(502, "Analytics resource identifier missing");
    // Account-level operations (for example R2 ListBuckets) have no bucket ID.
    const id = text(dimensions[dataset.dimension]) || "@account";
    return dataset.fields.map((f) => {
      const group = row[f.group];
      const value = finite(isRecord(group) ? group[f.field] : undefined);
      if (value === null) throw new ApiError(502, "Analytics metric missing");
      return {
        day,
        resource: resourceKey(dataset.kind, id),
        metric: f.metric,
        value,
        unit: f.unit,
        aggregation: f.group === "quantiles" ? ("quantile" as const) : f.group,
      };
    });
  });
}
