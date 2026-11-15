import { describe, expect, it } from "vitest";
import { ago } from "../web/inbox";
import { demoIssues } from "../web/issues-demo";
import { issueAttention } from "../web/pages";

describe("inbox helpers", () => {
  it("formats time since last seen", () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(ago("2026-11-15T11:59:40Z", now)).toBe("now");
    expect(ago("2026-11-15T11:20:00Z", now)).toBe("40 min");
    expect(ago("2026-11-15T07:00:00Z", now)).toBe("5 h");
    expect(ago("2026-11-12T12:00:00Z", now)).toBe("3 d");
  });
  it("lists open errors as attention items and folds low-risk issues into one", async () => {
    const list = await demoIssues().list({ status: "active", app: "all", category: "" });
    const items = issueAttention(list);
    expect(items[0]).toMatchObject({ severity: "critical", app: "openfea", view: "issues" });
    // The acknowledged D1 timeout is not repeated; five low-risk scans become one note.
    expect(items.map((i) => i.id)).toEqual(["issue:iss_0000000000000001", "issue:low"]);
    expect(items[1]!.title).toBe("5 low-risk issues open");
    expect(issueAttention(null)).toEqual([]);
  });
});

describe("demo inbox", () => {
  it("filters by status, app and category and applies status changes", async () => {
    const client = demoIssues();
    const active = await client.list({ status: "active", app: "all", category: "" });
    expect(active.counts).toEqual({ open: 6, acknowledged: 1, resolved: 1, ignored: 0 });
    expect(active.issues[0]!.severity).toBe("critical");
    const security = await client.list({ status: "active", app: "openzcad", category: "security" });
    expect(security.issues).toHaveLength(5);
    await client.update(security.issues[0]!.id, "ignored", "Scanner noise");
    const after = await client.get(security.issues[0]!.id);
    expect(after.status).toBe("ignored");
    expect(after.activity[0]).toMatchObject({ kind: "ignored by dashboard", detail: "Scanner noise" });
    expect((await client.list({ status: "ignored", app: "all", category: "" })).issues).toHaveLength(1);
  });
});
