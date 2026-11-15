// Row shapes shared by the Worker and the dashboard (no Worker-only types here).
import type { IssueEvent, Status } from "./model";

export type SourceRow = {
  id: string;
  kind: string;
  name: string;
  created_at: string;
  last_received: string | null;
  last_status: string | null;
  received: number;
  rejected: number;
  shape: string | null;
};
export type IssueRow = {
  id: string;
  source: string;
  app: string | null;
  service: string | null;
  category: string;
  severity: string;
  title: string;
  detail: string | null;
  url: string | null;
  status: Status;
  first_seen: string;
  last_seen: string;
  occurrences: number;
  deliveries: number;
  note: string | null;
  updated_at: string;
  status_at: string;
};
export type Issue = Omit<IssueRow, "detail"> & { detail: IssueEvent["detail"] };
export type IssueActivity = { at: string; kind: string; detail: string | null };
