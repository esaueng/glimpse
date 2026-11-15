// Client for the issue inbox and sources API. The demo supplies an in-memory version.
import { responseError } from "./api";
import type { Issue, IssueActivity, SourceRow } from "../src/sources/types";
import type { Status } from "../src/sources/model";

export type { Issue, SourceRow };
export type IssueStatus = Status;
export type IssueFilter = { status: "active" | Status; app: string; category: string };
export type IssueList = { issues: Issue[]; counts: Record<Status, number> };
export type IssueDetail = Issue & { activity: IssueActivity[] };
export type SourceList = { sources: SourceRow[]; kinds: { kind: string; label: string; header: string }[] };
export type NewSecret = { id: string; secret: string; url: string; header?: string };

export type IssuesClient = {
  list(filter: IssueFilter, signal?: AbortSignal): Promise<IssueList>;
  get(id: string, signal?: AbortSignal): Promise<IssueDetail>;
  update(id: string, status: Status, note?: string): Promise<void>;
  sources(signal?: AbortSignal): Promise<SourceList>;
  createSource(kind: string, name: string): Promise<NewSecret>;
  sourceAction(id: string, action: "rotate" | "delete"): Promise<NewSecret | null>;
};

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { cache: "no-store", signal });
  if (!res.ok) throw await responseError(res, "Issues unavailable");
  return res.json() as Promise<T>;
}
async function write(path: string, body: unknown): Promise<Response> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await responseError(res, "Change not saved");
  return res;
}

export const liveIssues: IssuesClient = {
  list: (f, signal) =>
    read(`/api/issues?${new URLSearchParams({ status: f.status, app: f.app, ...(f.category ? { category: f.category } : {}) })}`, signal),
  get: (id, signal) => read(`/api/issues/${encodeURIComponent(id)}`, signal),
  update: async (id, status, note) => {
    await write(`/api/issues/${encodeURIComponent(id)}`, note ? { status, note } : { status });
  },
  sources: (signal) => read("/api/sources", signal),
  createSource: async (kind, name) => (await write("/api/sources", { kind, name })).json(),
  sourceAction: async (id, action) => {
    const res = await write(`/api/sources/${encodeURIComponent(id)}`, { action });
    return res.status === 204 ? null : res.json();
  },
};
