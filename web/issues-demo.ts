// Fictional inbox for the public demo. In memory only: changes last until reload.
import type { Issue, IssueDetail, IssuesClient, IssueStatus, SourceRow } from "./issues-api";

const hours = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
const base = {
  source: "src_demo_issues",
  url: null,
  note: null,
  detail: {},
} as const;
const seed = (): IssueDetail[] =>
  [
    {
      ...base,
      id: "iss_0000000000000001",
      app: "openfea",
      service: "openfea-api",
      category: "error",
      severity: "critical",
      title: "TypeError: Cannot read properties of undefined (reading 'mesh')",
      status: "open",
      first_seen: hours(5),
      last_seen: hours(0.2),
      occurrences: 214,
      deliveries: 3,
      detail: { errorType: "TypeError", frames: ["loadMesh (mesh.ts:88:14)", "handleSolve (solve.ts:41:9)", "fetch (index.ts:22:5)"] },
    },
    {
      ...base,
      id: "iss_0000000000000002",
      app: "openlattice3d",
      service: "openlattice3d",
      category: "error",
      severity: "warning",
      title: "D1_ERROR: query timed out after 30000 ms",
      status: "acknowledged",
      first_seen: hours(30),
      last_seen: hours(3),
      occurrences: 37,
      deliveries: 2,
      note: "Looking at the project list query",
      detail: { errorType: "D1_ERROR", frames: ["listProjects (projects.ts:57:11)"] },
    },
    ...["wordpress", "secret-files", "known-scanner-path", "debug-endpoints", "source-control"].map(
      (path, i) => ({
        ...base,
        id: `iss_00000000000001${i}0`,
        app: "openzcad",
        service: "openzcad",
        category: "security",
        severity: "info",
        title: `Potential vulnerability scan · ${path} · low risk`,
        status: "open",
        first_seen: hours(70 - i * 6),
        last_seen: hours(1 + i * 2),
        occurrences: [96, 61, 38, 27, 18][i]!,
        deliveries: 1,
        detail: { risk: "low" },
      }),
    ),
    {
      ...base,
      id: "iss_0000000000000003",
      app: "openzcad",
      service: "openzcad",
      category: "error",
      severity: "warning",
      title: "Error: R2 put failed: 503 Service Unavailable",
      status: "resolved",
      first_seen: hours(120),
      last_seen: hours(52),
      occurrences: 9,
      deliveries: 1,
      note: "Retry with backoff shipped",
      detail: { errorType: "Error", frames: ["saveRevision (cloud.ts:203:7)"] },
    },
  ].map((issue) => ({
    ...issue,
    updated_at: issue.last_seen,
    activity: [{ at: issue.first_seen, kind: "opened", detail: `${issue.occurrences} occurrences` }],
  })) as IssueDetail[];

export function demoIssues(): IssuesClient {
  const issues = seed();
  const sources: SourceRow[] = [
    {
      id: "src_demo_issues",
      kind: "cloudflare-issues",
      name: "Workers Issues",
      created_at: hours(200),
      last_received: hours(0.2),
      last_status: "ok: 1 issue",
      received: 42,
      rejected: 0,
      shape: null,
    },
  ];
  const strip = ({ activity: _, ...issue }: IssueDetail): Issue => issue;
  return {
    async list(f) {
      const scoped = issues.filter(
        (i) => (f.app === "all" || i.app === f.app) && (!f.category || i.category === f.category),
      );
      const counts = { open: 0, acknowledged: 0, resolved: 0, ignored: 0 };
      for (const i of scoped) counts[i.status]++;
      const rank = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
      return {
        counts,
        issues: scoped
          .filter((i) => (f.status === "active" ? i.status === "open" || i.status === "acknowledged" : i.status === f.status))
          .sort((a, b) => rank[a.severity]! - rank[b.severity]! || b.last_seen.localeCompare(a.last_seen))
          .map(strip),
      };
    },
    async get(id) {
      const issue = issues.find((i) => i.id === id);
      if (!issue) throw new Error("Issue not found");
      return { ...issue, activity: [...issue.activity] };
    },
    async update(id, status: IssueStatus, note) {
      const issue = issues.find((i) => i.id === id);
      if (!issue) throw new Error("Issue not found");
      issue.status = status;
      if (note) issue.note = note;
      issue.activity.unshift({ at: new Date().toISOString(), kind: `${status} by dashboard`, detail: note ?? null });
    },
    async sources() {
      return { sources, kinds: [{ kind: "cloudflare-issues", label: "Cloudflare Workers Issues", header: "cf-webhook-auth" }] };
    },
    async createSource() {
      throw new Error("The demo cannot connect sources.");
    },
    async sourceAction() {
      throw new Error("The demo cannot change sources.");
    },
  };
}
