# Esau Cloudflare usage and costs

The Cloudflare page reads Esau infrastructure and billing independently of the
application analytics contract. Public and private apps share the protected page.
Infrastructure metadata uses separate `cf_*` tables; app adapters and consent
controls are unchanged.

## Connection and coverage

Use an Esau-only account API token with Billing Read, Account Analytics Read,
Account Settings Read, Workers Metadata Read-Only, Pages Read, D1 Read, Workers
R2 Storage Read, Workers KV Storage Read, Workers Containers Read and Queues Read.
The collector verifies the account name is exactly `Esau` before collecting.

It requests binding references and aggregate metrics, not object values, database
contents, Worker source, plaintext variables, logs or customer identifiers. Tokens
still confer their provider-defined permissions; restrict and rotate them.

The coverage command runs the collector's actual queries and outputs only source
names, aggregate counts and status:

```sh
node --env-file=/absolute/path/to/private-monitor.env scripts/check-cloudflare-coverage.mjs
```

The environment file provides `CF_ACCOUNT_ID` and `CF_API_TOKEN`. Keep it outside
Git with owner-only permissions. Never use credentials in arguments or logs.
Coverage does not configure a deployed Worker or prove scheduled collection.

## Interpretation

- Metered account costs come from the alpha [Billable Usage API](https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/get_account_usage_v1/).
  Its info endpoint provides billing anchors. Queries include the entire cycle;
  arbitrary ranges omitting its anchor can return no data. Billing updates daily.
- Daily `ContractedCost`, falling back to `BilledCost`, is stored in integer
  millionths of the source currency. Stable row identities replace corrections.
  Cumulative amounts are never summed; different currencies stay separate.
- Current fixed subscriptions are separate. Annual fees show actual renewal
  amounts and monthly equivalents. Taxes, invoice credits, registrar renewals and
  one-time purchases are not inferred. The final invoice remains authoritative.
- Per-app costs allocate each reported charge proportionally using a matching
  resource metric. Account allowances are already reflected in charges and are
  not applied independently per app. Sampling and ingestion delay affect estimates.
- Worker requests/CPU, D1 rows, DO requests/duration, container CPU/memory/disk and
  Queue operations support allocation. R2 operation classes, storage duration and
  other unmatched charges remain **Unassigned**, while staying in account totals.
- Binding references suggest ownership; multiple owners produce **Shared
  infrastructure**. Names provide fallback suggestions. Manual assignments survive
  discovery. New apps start **Not classified**, except the three public integrations.
- Counters sum over dates. Storage shows daily peaks and the peak in the selected
  range, never summed or converted into billable GB-months.
- Forecasts require three reported billing days and extrapolate through the latest
  completed charge day. Missing pre-install history is not fabricated. Current
  subscriptions are not historical subscription accounting.

## Collection and monitoring

The hourly trigger `17 * * * *` runs only with `CF_MONITOR_ENABLED=true` and both
credentials. Inventory, subscriptions and billing refresh daily. Usage re-queries
today and yesterday each hour, plus one older day per run within upstream
retention. Store up to 400 UTC days (about 13 months); upstream coverage can be shorter.

A D1 lease prevents overlap. Sources fail independently and retain prior results.
Coverage displays failures and last-success times. HTTP throttling/server errors
retry with bounded backoff. Truncated datasets are withheld rather than shown as
complete. Current billing cycles are reconciled; historical billing accumulates
from collection onward.

Account/app budgets monitor USD metered usage per billing period. In-page alerts
cover 80%/100% thresholds, projected overspend, stale/failed sources, and daily
spikes above both $5 and twice the recent average. App budgets use allocations.
Optional `CF_ALERT_WEBHOOK` sends JSON `{ "text": "Glimpse · ..." }` to an explicitly
configured HTTPS destination. Delivery is deduplicated per alert and period, with
at-least-once behavior around failures. No destination is configured by default.

## Rollout

Monitoring remains disabled in Production and Previews. Under separate production
migration/deployment authorization:

1. Run the coverage command with the intended read-only token.
2. Apply migration `0004_cloudflare.sql` to the dedicated Preview database and
   validate with synthetic staging data.
3. Apply the migration to Production before enabling collection.
4. Set `CF_ACCOUNT_ID` and `CF_API_TOKEN` as Production Worker secrets. Do not
   copy credentials into ordinary vars, Preview or demo configuration.
5. Set Production `CF_MONITOR_ENABLED` to `true` in deployment configuration;
   keep Previews disabled. Previews do not run scheduled triggers.
6. Verify a real scheduled run, app mappings, coverage and billing totals against
   Cloudflare. Classify private apps and set budgets.
7. Configure an alert webhook only when desired and explicitly authorized.

The public demo uses fictional fixtures and browser-only edits. It does not
bundle the production API loader; `connect-src 'none'` blocks API calls.

To stop collecting, set `CF_MONITOR_ENABLED=false` and deploy. Existing application
analytics remain independent; stored infrastructure data follows its own retention.
