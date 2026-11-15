// The issue inbox: grouped problems from connected sources, with triage actions.
import { useState } from "react";
import { appName, number } from "./data";
import { useLoader } from "./hooks";
import type { IssueDetail, IssuesClient, IssueStatus, Issue } from "./issues-api";
import { Panel } from "./ui";

const tabs = [
  ["active", "Active"],
  ["resolved", "Resolved"],
  ["ignored", "Ignored"],
] as const;
const categories = [
  ["", "All"],
  ["error", "Errors"],
  ["security", "Security"],
] as const;
const severityLabel: Record<string, string> = { critical: "Critical", warning: "Warning", info: "Info" };
const statusLabel: Record<IssueStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  ignored: "Ignored",
};
const actions: Record<IssueStatus, [IssueStatus, string][]> = {
  open: [
    ["acknowledged", "Acknowledge"],
    ["resolved", "Resolve"],
    ["ignored", "Ignore"],
  ],
  acknowledged: [
    ["resolved", "Resolve"],
    ["ignored", "Ignore"],
    ["open", "Reopen"],
  ],
  resolved: [["open", "Reopen"]],
  ignored: [["open", "Reopen"]],
};

/** "now", "40 min", "5 h" or "3 d" since an ISO time. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, (now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${Math.floor(minutes)} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
}
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const where = (i: Issue) =>
  [i.service, i.app && i.app !== i.service ? appName(i.app) : null].filter(Boolean).join(" · ");

function Detail({ client, id, onChanged }: { client: IssuesClient; id: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [failed, setFailed] = useState("");
  const { data, error, refresh } = useLoader<IssueDetail>((signal) => client.get(id, signal), [id, client], {
    errorMessage: (e) => (e instanceof Error ? e.message : "Issue unavailable"),
  });
  if (error) return <p className="error-message">{error}</p>;
  if (!data) return <p className="muted small">Loading…</p>;
  const act = async (status: IssueStatus) => {
    setBusy(true);
    setFailed("");
    try {
      await client.update(id, status, note.trim() || undefined);
      setNote("");
      refresh();
      onChanged();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Change not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="issue-detail">
      <div className="issue-facts">
        <dl>
          <div>
            <dt>First seen</dt>
            <dd>{utc(data.first_seen)}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{utc(data.last_seen)}</dd>
          </div>
          <div>
            <dt>Occurrences</dt>
            <dd>{number(data.occurrences)}</dd>
          </div>
          {data.detail.errorType && (
            <div>
              <dt>Error</dt>
              <dd>{data.detail.errorType}</dd>
            </div>
          )}
        </dl>
        {data.detail.frames?.length ? (
          <ol className="frames" aria-label="Stack frames">
            {data.detail.frames.map((f, i) => (
              <li key={i}>
                <code>{f}</code>
              </li>
            ))}
          </ol>
        ) : null}
        {data.note && <p className="issue-note">{data.note}</p>}
      </div>
      <div className="issue-side">
        <ol className="activity" aria-label="Activity">
          {data.activity.slice(0, 5).map((a, i) => (
            <li key={i}>
              <span>{a.kind}</span>
              <span className="muted">{ago(a.at)}</span>
            </li>
          ))}
        </ol>
        <label className="sr-only" htmlFor={`note-${id}`}>
          Note
        </label>
        <input
          id={`note-${id}`}
          className="note-input"
          placeholder="Note (optional)"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="issue-actions">
          {actions[data.status].map(([status, text]) => (
            <button key={status} type="button" disabled={busy} onClick={() => act(status)}>
              {text}
            </button>
          ))}
          {data.url && (
            <a className="button-link" href={data.url} target="_blank" rel="noreferrer">
              Cloudflare <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
        {failed && (
          <p className="error-message small" role="alert">
            {failed}
          </p>
        )}
      </div>
    </div>
  );
}

export function Inbox({
  client,
  app,
  onConnect,
}: {
  client: IssuesClient;
  app: string;
  onConnect: () => void;
}) {
  const [status, setStatus] = useState<"active" | IssueStatus>("active"),
    [category, setCategory] = useState(""),
    [open, setOpen] = useState<string | null>(null);
  const list = useLoader(
    (signal) =>
      Promise.all([client.list({ status, app, category }, signal), client.sources(signal)]).then(([l, s]) => ({
        ...l,
        sourceCount: s.sources.length,
      })),
    [client, status, app, category],
    { errorMessage: (e) => (e instanceof Error ? e.message : "Issues unavailable") },
  );
  const counts = list.data?.counts;
  return (
    <Panel
      title="Inbox"
      className="inbox-panel"
      note={
        <span className="inbox-filters">
          <span className="segmented" role="group" aria-label="Status">
            {tabs.map(([id, text]) => (
              <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)}>
                {text}
                {counts && (
                  <span className="count">
                    {id === "active" ? counts.open + counts.acknowledged : counts[id]}
                  </span>
                )}
              </button>
            ))}
          </span>
          <span className="segmented" role="group" aria-label="Category">
            {categories.map(([id, text]) => (
              <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>
                {text}
              </button>
            ))}
          </span>
        </span>
      }
    >
      {list.error ? (
        <p className="error-message" role="alert">
          {list.error}
        </p>
      ) : !list.data ? (
        <p className="muted small">Loading…</p>
      ) : !list.data.issues.length ? (
        list.data.sourceCount ? (
          <p className="all-clear">
            <span aria-hidden="true">✓</span> {status === "active" ? "All clear" : "Nothing here"}
          </p>
        ) : (
          <div className="inbox-empty">
            <p className="muted">No sources connected.</p>
            <button type="button" className="primary" onClick={onConnect}>
              Connect Workers Issues
            </button>
          </div>
        )
      ) : (
        <ul className={list.loading ? "inbox is-loading" : "inbox"}>
          {list.data.issues.map((issue) => (
            <li key={issue.id} className={open === issue.id ? "is-open" : undefined}>
              <button
                type="button"
                className="issue-row"
                aria-expanded={open === issue.id}
                onClick={() => setOpen(open === issue.id ? null : issue.id)}
              >
                <span className={`severity ${issue.severity}`}>{severityLabel[issue.severity]}</span>
                <span className="issue-title">
                  <strong>{issue.title}</strong>
                  <span className="muted small">
                    {where(issue)}
                    {issue.category === "security" ? " · security" : ""}
                  </span>
                </span>
                <span className="issue-count numeric">{number(issue.occurrences)}</span>
                <span className="issue-age muted small">{ago(issue.last_seen)}</span>
                <span className={`issue-status ${issue.status}`}>{statusLabel[issue.status]}</span>
              </button>
              {open === issue.id && <Detail client={client} id={issue.id} onChanged={list.refresh} />}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
