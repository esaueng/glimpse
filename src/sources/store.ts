// Storage for sources and the issue inbox (migration 0006_issues.sql).
import { APPS, type App } from "../contract";
import type { IssueEvent, Status } from "./model";
import type { Issue, IssueActivity, IssueRow, SourceRow } from "./types";
export type { Issue, IssueActivity, IssueRow, SourceRow };

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async (text: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const random = (bytes: number) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const SOURCE_COLUMNS = "id,kind,name,created_at,last_received,last_status,received,rejected,shape";

export async function listSources(db: D1Database): Promise<SourceRow[]> {
  const { results } = await db
    .prepare(`SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY created_at`)
    .all<SourceRow>();
  return results;
}

/** Creates a source and returns its secret once; only the hash is stored. */
export async function createSource(db: D1Database, kind: string, name: string, now = new Date()) {
  const id = `src_${random(9)}`,
    secret = random(32);
  await db
    .prepare("INSERT INTO sources(id,kind,name,secret_hash,created_at) VALUES(?,?,?,?,?)")
    .bind(id, kind, name, await sha256(secret), now.toISOString())
    .run();
  return { id, secret };
}

export async function rotateSecret(db: D1Database, id: string): Promise<string | null> {
  const secret = random(32);
  const { meta } = await db
    .prepare("UPDATE sources SET secret_hash=? WHERE id=?")
    .bind(await sha256(secret), id)
    .run();
  return meta.changes ? secret : null;
}

/** Removes a source. Its issues stay in the inbox. */
export async function deleteSource(db: D1Database, id: string): Promise<boolean> {
  const { meta } = await db.prepare("DELETE FROM sources WHERE id=?").bind(id).run();
  return meta.changes > 0;
}

/** The source when `secret` matches, compared in constant time over the hashes. */
export async function authenticate(
  db: D1Database,
  id: string,
  secret: string | null,
): Promise<{ id: string; kind: string } | null> {
  if (!/^src_[\w-]{6,40}$/.test(id)) return null;
  const row = await db
    .prepare("SELECT id,kind,secret_hash FROM sources WHERE id=?")
    .bind(id)
    .first<{ id: string; kind: string; secret_hash: string }>();
  if (!row || !secret || secret.length > 512) {
    if (row) await recordDelivery(db, row.id, "rejected: missing or wrong secret", null, false);
    return null;
  }
  const given = new TextEncoder().encode(await sha256(secret)),
    stored = new TextEncoder().encode(row.secret_hash);
  const equal =
    given.byteLength === stored.byteLength &&
    (crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean }).timingSafeEqual(
      given,
      stored,
    );
  if (!equal) {
    await recordDelivery(db, row.id, "rejected: missing or wrong secret", null, false);
    return null;
  }
  return { id: row.id, kind: row.kind };
}

export async function recordDelivery(
  db: D1Database,
  id: string,
  status: string,
  shape: string[] | null,
  accepted: boolean,
  now = new Date(),
) {
  if (!accepted) {
    await db.prepare("UPDATE sources SET last_status=?, rejected=rejected+1 WHERE id=?").bind(status, id).run();
    return;
  }
  await db
    .prepare("UPDATE sources SET last_status=?, received=received+1, last_received=?, shape=COALESCE(?,shape) WHERE id=?")
    .bind(status, now.toISOString(), shape ? JSON.stringify(shape) : null, id)
    .run();
}

/** Maps a Worker name to an app: the Costs page mapping first, then the name itself. */
export async function appFor(db: D1Database, service: string | null): Promise<App | null> {
  if (!service) return null;
  try {
    const row = await db
      .prepare("SELECT app FROM cf_resources WHERE kind='Workers' AND name=? AND active=1")
      .bind(service)
      .first<{ app: string }>();
    if (row && (APPS as readonly string[]).includes(row.app)) return row.app as App;
  } catch {
    // The Cloudflare monitor tables (0004) are optional here.
  }
  const name = service.toLowerCase();
  return APPS.find((a) => name === a || name.startsWith(`${a}-`) || name.startsWith(`${a}_`)) ?? null;
}

/**
 * Upserts one event in single statements, so a concurrent delivery or dashboard change is
 * never overwritten with stale values. Status rules, applied against the stored row:
 * - ignored stays ignored;
 * - an end event resolves an open or acknowledged issue only if it is not older than the
 *   latest occurrence;
 * - a resolved issue reopens only on a newer occurrence (later than the last one seen and
 *   than the resolution, or a higher reported count), so replays never reopen it.
 */
export async function ingest(db: D1Database, source: string, event: IssueEvent, now = new Date()) {
  const at = now.toISOString(),
    fingerprint = await sha256(`${source}\n${event.fingerprint}`),
    id = `iss_${fingerprint.slice(0, 16)}`,
    seen = event.lastSeen && event.lastSeen <= at ? event.lastSeen : at,
    detail = JSON.stringify(event.detail),
    app = await appFor(db, event.service),
    occ = event.occurrences;
  const inserted = await db
    .prepare(
      `INSERT INTO issues(id,source,fingerprint,app,service,category,severity,title,detail,url,status,first_seen,last_seen,occurrences,deliveries,updated_at,status_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(source,fingerprint) DO NOTHING`,
    )
    .bind(
      id,
      source,
      fingerprint,
      app,
      event.service,
      event.category,
      event.severity,
      event.title,
      detail,
      event.url,
      event.resolved ? "resolved" : "open",
      event.firstSeen && event.firstSeen <= seen ? event.firstSeen : seen,
      seen,
      occ ?? 1,
      at,
      at,
    )
    .run();
  if (inserted.meta.changes) {
    await activity(db, id, at, "opened", occ !== null ? `${occ} occurrences` : null);
    return { id, created: true };
  }
  // SET expressions read the row as it was before this statement.
  const next = `CASE
      WHEN status='ignored' THEN 'ignored'
      WHEN ?1 = 1 THEN CASE WHEN status IN ('open','acknowledged') AND ?2 >= last_seen THEN 'resolved' ELSE status END
      WHEN status='resolved' AND ?2 > status_at AND (?2 > last_seen OR (?3 IS NOT NULL AND ?3 > occurrences)) THEN 'open'
      ELSE status END`;
  const row = await db
    .prepare(
      `UPDATE issues SET
        prev_status=status,
        status=${next},
        status_at=CASE WHEN ${next} <> status THEN ?4 ELSE status_at END,
        occurrences=CASE WHEN ?3 IS NULL THEN occurrences + (CASE WHEN ?1 = 1 THEN 0 ELSE 1 END) ELSE MAX(occurrences, ?3) END,
        last_seen=CASE WHEN ?1 = 0 AND ?2 > last_seen THEN ?2 ELSE last_seen END,
        app=COALESCE(?5,app), service=COALESCE(?6,service), category=?7, severity=?8, title=?9, detail=?10,
        url=COALESCE(?11,url), deliveries=deliveries+1, updated_at=?4
       WHERE source=?12 AND fingerprint=?13
       RETURNING prev_status, status`,
    )
    .bind(
      event.resolved ? 1 : 0,
      seen,
      occ,
      at,
      app,
      event.service,
      event.category,
      event.severity,
      event.title,
      detail,
      event.url,
      source,
      fingerprint,
    )
    .first<{ prev_status: Status; status: Status }>();
  if (!row) return { id, created: false };
  await activity(
    db,
    id,
    at,
    row.status !== row.prev_status ? (row.status === "open" ? "reopened" : `source ${row.status}`) : "recurred",
    occ !== null ? `${occ} occurrences` : null,
  );
  return { id, created: false };
}

async function activity(db: D1Database, issue: string, at: string, kind: string, detail: string | null) {
  await db.prepare("INSERT INTO issue_events(issue,at,kind,detail) VALUES(?,?,?,?)").bind(issue, at, kind, detail).run();
}

const toIssue = (row: IssueRow): Issue => {
  let detail: IssueEvent["detail"] = {};
  try {
    detail = row.detail ? JSON.parse(row.detail) : {};
  } catch {
    // Stored by this code, so only a manual edit could break it.
  }
  return { ...row, detail };
};

export type IssueFilter = { status?: Status | "active"; app?: string; category?: string; limit?: number };

export async function listIssues(db: D1Database, filter: IssueFilter = {}) {
  const where: string[] = [],
    args: unknown[] = [];
  if (filter.status === "active") where.push("status IN ('open','acknowledged')");
  else if (filter.status) {
    where.push("status=?");
    args.push(filter.status);
  }
  if (filter.app && filter.app !== "all") {
    where.push("app=?");
    args.push(filter.app);
  }
  if (filter.category) {
    where.push("category=?");
    args.push(filter.category);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const scoped = [
    ...(filter.app && filter.app !== "all" ? ["app=?"] : []),
    ...(filter.category ? ["category=?"] : []),
  ];
  const scopeArgs = [
    ...(filter.app && filter.app !== "all" ? [filter.app] : []),
    ...(filter.category ? [filter.category] : []),
  ];
  const [list, counts] = await db.batch([
    db
      .prepare(
        `SELECT * FROM issues ${clause} ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen DESC LIMIT ?`,
      )
      .bind(...args, Math.min(filter.limit ?? 200, 500)),
    db
      .prepare(`SELECT status, COUNT(*) AS n FROM issues ${scoped.length ? `WHERE ${scoped.join(" AND ")}` : ""} GROUP BY status`)
      .bind(...scopeArgs),
  ]);
  const totals = { open: 0, acknowledged: 0, resolved: 0, ignored: 0 };
  for (const r of (counts!.results as { status: Status; n: number }[])) totals[r.status] = r.n;
  return { issues: (list!.results as IssueRow[]).map(toIssue), counts: totals };
}

export async function getIssue(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM issues WHERE id=?").bind(id).first<IssueRow>();
  if (!row) return null;
  const { results } = await db
    .prepare("SELECT at,kind,detail FROM issue_events WHERE issue=? ORDER BY at DESC, rowid DESC LIMIT 50")
    .bind(id)
    .all<IssueActivity>();
  return { ...toIssue(row), activity: results };
}

/** A status change from the dashboard or an agent. `actor` is a role, never a person. */
export async function setStatus(
  db: D1Database,
  id: string,
  status: Status,
  note: string | null,
  actor: "dashboard" | "agent",
  now = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  const { meta } = await db
    .prepare(
      "UPDATE issues SET prev_status=status, status=?, status_at=?, note=COALESCE(?,note), updated_at=? WHERE id=?",
    )
    .bind(status, at, note, at, id)
    .run();
  if (!meta.changes) return false;
  await activity(db, id, at, `${status} by ${actor}`, note);
  return true;
}

/** Closed issues and old activity expire after 90 days; open and acknowledged issues stay. */
export async function retainIssues(db: D1Database) {
  await db.batch([
    db.prepare(
      "DELETE FROM issue_events WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')",
    ),
    db.prepare(
      "DELETE FROM issues WHERE status IN ('resolved','ignored') AND last_seen < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')",
    ),
  ]);
}
