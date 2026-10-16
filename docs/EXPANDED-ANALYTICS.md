# Expanded opt-in analytics

The owner selected **detailed aggregates and user-shared reports**, with **all
expanded collection after opt-in**. Basic backend request/error/latency counters
retain their original deployment controls. Expanded scope never inherits an old
usage grant: the browser must store `granted-v2` after the updated notice. Old
`granted-v1` grants stop optional sends until the person chooses again.

## What the numbers mean

| Measurement | Source and denominator | Limits |
| --- | --- | --- |
| Cloud accounts | OpenZCAD accounts with a separate, unexpired account-statistics grant | Not all registered accounts, visitors, active people or cross-app uniques |
| Cloud projects / revisions | Retained projects owned by those accounts, including trash | Shared projects count once under their consenting owner; never infer their collaborators |
| Stored cloud bytes | Numeric metadata for retained R2 objects/assets/artifacts plus D1 document bytes without R2 pointers | Known bytes only; legacy artifacts with missing sizes are counted separately. Not Cloudflare billable disk usage, DB indexes, logs, backups or bandwidth |
| Logical cloud bytes | Current documents, revisions, assets and artifacts before compression | Not a physical capacity total; retained R2 staging/orphan objects can make physical metadata exceed logical totals |
| Cloud document size | Distribution of current `document_bytes` across those projects | Excludes external assets; do not call this complete project disk size |
| Saved project size observations | Complete saved local project files in both apps | Repeated saves count repeatedly; app-specific scopes, not unique projects |
| Part observations | OpenZCAD body-node count after successful edits; OpenFEA display body count on a project-file save | Coarse ranges, repeatable observations; no part IDs, names or geometry |
| Transfer observations | Successful OpenZCAD cloud JSON writes; OpenFEA encrypted backup upload/download | Size ranges and operation counts, not exact network bandwidth or billing |
| Diagnostics | Fixed codes at explicit failure sites, plus generic runtime errors | Counts are signals, may overlap for one failure; no raw errors, stacks, URLs or automatic issue creation |
| Feature operations | Exact allowlisted CAD command kinds; fixed FEA mesh/solve/export categories | No command labels, payloads or parameters |

OpenFEA has no registered cloud-account system. Its encrypted recovery backups
are not cloud accounts or a project inventory. Show **not supported**, rather
than a zero that implies account measurement. Neither app measures anonymous
unique users. Summing app account totals would still not produce unique people.

Cloud snapshots refresh on OpenZCAD’s existing hourly cron, plus on consent changes. Each UTC day retains its latest received snapshot. Display the latest snapshot
**inside the selected date range** and its UTC day. Do not sum stocks across days.
Snapshots use monotonically increasing app-wide generations to discard duplicate
or out-of-order deliveries. Generations identify aggregate revisions, not users.
After restoring an app database, reconcile its generation above the latest
Glimpse generation before resuming; a restored lower counter is safely rejected.

## Consent and reports

Browser analytics is app-local, off until fresh affirmative consent, suppressed
by DNT/GPC, and rechecked before every send. Withdrawal aborts pending sends and
clears this page's in-memory diagnostic counts. Accepted aggregates cannot be
attributed back to remove one person's contribution. Other live tabs clear their
counts on the storage event. No optional queues/retries or persistent report data.

OpenZCAD's **separate account permission** covers numeric account/storage totals
across devices for 30 days. It lives alongside the existing account inside
OpenZCAD, contains only its existing user key and expiry, and is never forwarded
to Glimpse. No individual analytics history is stored. It is not inferred from
browser consent, sign-in, other devices or the other app. Its checkbox reads the
server state, displays expiry, and reports save failure honestly. Withdrawal
remains available when collection is disabled. Acknowledgement confirms account
withdrawal. If the request or its reply fails, the outcome is unconfirmed: the
request may already have reached the server. Refresh the server state and retry
as needed; the UI must not claim the old permission definitely remains in force.
Erasing accounts are excluded;
permission rows cascade when an account is deleted. DNT/GPC suppress browser
sends; revoke the separate account permission in Settings to stop account totals.
Already-published snapshots are historical aggregates with 90-day retention.

A user can explicitly download a bounded JSON report containing only allowlisted
counts from the current opted-in page. They can inspect that JSON before sharing
it through their chosen support channel. There is no automatic report upload,
ID, session, event order, device fingerprint, free-text description or timestamp.
The owner opens reports **locally** in the protected dashboard; strict validation
rejects unknown keys, raw messages, duplicate rows and oversized files. Reports
are not imported into the aggregate database and disappear on reload/clear.

## Rollout order and verification boundary

The owner subsequently authorized this rollout explicitly. All three service/app
PRs are merged and deployed, the required Production and isolated Preview
migrations are applied. Collection was subsequently enabled for all three apps,
with browser analytics still requiring opt-in. See the current
[validation record](VALIDATION.md) for live checks and remaining limits.
The sequence below also applies when preparing another installation.

1. Review the updated notices and deployment-specific privacy/legal basis.
2. Authorize and apply Glimpse migration `0003_census.sql`; deploy the service.
3. Authorize and apply OpenZCAD migration `0028_glimpse_consent.sql`; deploy its
   integration. OpenFEA needs no new database. Keep existing collection switches
   off until the end-to-end staging checks pass. The prior authorization for
   the initial database and initial deployment does not apply to these migrations.
4. Test fresh consent, old-grant refusal, DNT/GPC, withdrawal while pending,
   cross-tab revocation, account expiry/withdrawal, app separation, missing
   bindings, delayed/out-of-order snapshots, anonymous Access boundaries and
   real opted-in operations. Do not seed production with synthetic user events.
5. Enable each app's optional deployment switch only deliberately; the user's
   separate affirmative choices are still required. Roll back by disabling the
   flags; withdrawal remains available. Roll back app code before service code.

Service and app statistics are best effort, not billing data. Custom clients can
spoof allowed browser events; rate limits and lost sends can bias the sample.
Small opted-in populations can be sensitive even without names. Restrict access,
limit retention, and never claim these aggregates are legally anonymous.

## Preserved existing integrations

Current main also supports OpenLattice3D and isolated authenticated Preview
databases. This revision preserves those entrypoints, app filters, generation
outcomes, tables, migrations and environment boundaries. The expanded v2 wire
contract and local reports currently apply to OpenZCAD/OpenFEA only; other apps
cannot send new detailed fields. Legacy failure outcomes remain visible as fixed
diagnostic categories, so one issue can produce both an outcome and a diagnostic
signal. Preview environments need the new census migration too, with separate
authorization; they never bind the production database or audience.
