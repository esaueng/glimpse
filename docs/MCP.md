# Agent access (MCP)

Glimpse serves a Model Context Protocol endpoint at `https://glimpse.esau.app/mcp`, so
Claude, Codex and other MCP clients can read app health and issues and triage them.

- **Transport:** Streamable HTTP. Each `POST` carries one JSON-RPC message, or a batch
  from older clients, and gets a JSON reply. Notifications get 202. There are no
  sessions and no server-initiated stream, so `GET` and `DELETE` return 405. Protocol
  versions 2025-11-25, 2025-06-18 and 2025-03-26 are accepted.
- **Access:** the endpoint sits behind Cloudflare Access like the dashboard. The Worker
  verifies the Access JWT before any tool runs and rejects a browser `Origin` from
  another site. No separate login, key or session store exists in Glimpse.
- **Implementation:** `src/mcp.ts`, with no SDK dependency. Tools reuse the dashboard's
  queries (`src/stats.ts`, `web/health.ts`, `src/sources/store.ts`).

## Tools

| Tool | Does | Writes |
| --- | --- | --- |
| `get_health` | Status per app (healthy, degraded, failing, idle), requests, server-error and slow-request shares, opted-in diagnostics, ranked "needs attention", open issue counts | No |
| `get_metrics` | Daily requests and errors per app, response-time ranges, failure counts, top diagnostic codes | No |
| `list_issues` | Inbox issues by status, app and category | No |
| `get_issue` | One issue: Worker, error type, stack frames, counts, times, Cloudflare link, note, activity | No |
| `update_issue` | Set the status and/or note; logged as "by agent" | Yes |
| `list_sources` | Webhook sources and delivery status (never secrets) | No |

The prompt `investigate_issue(issue_id)` gives the steps an agent should follow:
acknowledge, read the issue and health, pull logs and traces from the Cloudflare MCP
server, fix with a regression test, open a pull request, and note it on the issue.

Glimpse holds aggregates and scrubbed issue metadata only. For raw logs and traces, also
connect the Cloudflare API MCP server (`https://mcp.cloudflare.com/mcp`) with Workers
Observability read access.

## Sign-in

Each step below needs owner authorization in Zero Trust.

**People: Access managed OAuth.** **Done in Production:** the Glimpse Access application
has **Managed OAuth** on (Zero Trust → Access → Applications → Glimpse → Advanced
settings), with Cloudflare's default dynamic client registration for localhost and
loopback redirects. An MCP client then gets a 401 that
points at Access's OAuth metadata. It opens the browser for the normal Access login and
receives a token, and Access forwards the request with the same JWT the dashboard uses.
This changes the unauthenticated response for non-browser clients on the whole
hostname from a login redirect to a 401. The `/hooks/` bypass is unaffected.

```sh
# Claude Code; add -s user to use it from any directory
claude mcp add --transport http glimpse https://glimpse.esau.app/mcp
```

`claude mcp get glimpse` then shows "Needs authentication". In an interactive Claude
Code session, run `/mcp`, choose **glimpse**, then **Authenticate**, and sign in with
Access in the browser.

For Codex, add an HTTP MCP server with that URL in `~/.codex/config.toml` and sign in
when prompted. The exact keys depend on the Codex version; check `codex mcp --help`.

**Unattended automations: Access service token.** Under Access → Service credentials,
create a token. Add a **Service Auth** policy that includes it to the Glimpse
application. Then send its two headers from the client, keeping them in the client's
secret store and never in a repository:

```sh
claude mcp add --transport http glimpse https://glimpse.esau.app/mcp \
  --header "CF-Access-Client-Id: $GLIMPSE_ACCESS_CLIENT_ID" \
  --header "CF-Access-Client-Secret: $GLIMPSE_ACCESS_CLIENT_SECRET"
```

The Worker's JWT check requires a `sub` claim to be present, but not non-empty. A
service-token JWT with `"sub": ""` passes, as covered by a test. Not yet verified: that
this account's service-token JWTs carry a `sub` claim at all. Confirm with one call
during rollout and record the result in [VALIDATION.md](VALIDATION.md).

## Example automation

A scheduled agent (for example a Claude Code routine) with both the Glimpse and the
Cloudflare MCP servers:

> Call `list_issues` with status `open`. For each critical or warning issue not
> acknowledged in the last day, run the `investigate_issue` prompt. Stop after two
> issues per run.

Workers Issues can also start a Claude Code routine directly from a Cloudflare Issues
automation. Glimpse adds the cross-app view, the health context and shared triage state,
so two runs don't pick up the same issue.
