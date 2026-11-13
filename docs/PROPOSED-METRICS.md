# Proposed metrics

Candidates for a future schema change. None are collected. Each needs
coordinated app adapter PRs, a `src/contract.ts` or `src/expanded.ts` change,
and a privacy review as described in [PRIVACY.md](PRIVACY.md). Several
conflict with promises the Privacy page makes today; those are called out.
Priorities and sequencing are tracked in the [roadmap](ROADMAP.md#feature-candidates).

Status values: **Implemented in Glimpse** (accepted and rendered by Glimpse;
app adapters pending), **Next** (proposed for the next schema change),
**Deferred** (blocked on a privacy or consent revision), **Needs redesign**
(does not fit the current contract), **Overlaps** (largely covered by existing
metrics), **Later** (no blocker, not prioritised). Only the implemented items
have a privacy review; the owner approved them on 13 November 2026.

## Implemented in Glimpse, app adapters pending

Glimpse accepts, stores and renders these, but no app sends them yet, so
nothing is collected. Their privacy reviews ([diagnostic codes and account activity](PRIVACY.md#review-additional-diagnostic-codes-and-account-activity), [OpenLattice3D subset](PRIVACY.md#review-openlattice3d-targeted-subset-adr-0001))
were approved by the owner on 13 November 2026; the app adapter PRs can proceed.
Retention is identical to existing data (90 UTC days).

| Metric | Shape | Glimpse side | Still needed | Privacy notes |
| --- | --- | --- | --- | --- |
| More diagnostic codes (priority 1) | `error_unresponsive` (main thread blocked 5 s or more), `error_gpu_lost`, `error_out_of_memory`, `error_worker` | Added to the fixed `DIAGNOSTICS` list in `src/expanded.ts`; labels on Issues → Diagnostic codes; accepted in local reports; synthetic values in the demo. No migration | OpenZCAD, OpenFEA and OpenLattice3D adapter PRs | Fixed codes, no messages or stacks, no new dimension. Accepted from OpenLattice3D too since [ADR 0001](decisions/0001-openlattice3d-v2-parity.md) Option B (13 Nov 2026). |
| Model size, OpenLattice3D half (priority 3) | `lattice_cells`: unit cells per generated lattice in `lt_1k`, `1k_10k`, `10k_100k`, `gte_100k` | Part of the OpenLattice3D targeted subset ([ADR 0001](decisions/0001-openlattice3d-v2-parity.md) Option B): `CELLS` and `LATTICE_EXPANDED` in `src/expanded.ts`; accepted in local reports; Overview → Model complexity → Unit cells per generated lattice (N/A row for other apps); demo. No migration | OpenLattice3D adapter PR with a new consent version and notice | [Reviewed](PRIVACY.md#review-openlattice3d-targeted-subset-adr-0001) and accepted 13 Nov 2026. Decade ranges with a wide, open top range so rare very large lattices never get a range of their own; never the exact count. OpenLattice3D only. |
| Active and idle accounts (priority 2) | `active7d`, `active30d` (accounts with a save in the last 7 and 30 days) and `idle90d` (no save for 90 days or more), optional fields of the OpenZCAD snapshot | Contract validation in `census()`; k-threshold `ACTIVITY_MIN_COUNT` = 5 at ingest, in storage and at read; migration `0005_census_activity.sql` (nullable, optional for the guard); `/api/stats`; Overview → Cloud growth → Account activity; demo | Owner approval (including the account-permission wording and differencing risk); OpenZCAD adapter PR; apply `0005` to Preview and Production | A count below 5, or with fewer than 5 accounts outside it, is withheld and stored as `NULL`. Aggregate counts over consenting accounts only; never per-account rows or dates. |

## Opt-in browser counters

| Metric | Shape | Purpose | Status | Privacy notes |
| --- | --- | --- | --- | --- |
| Active installs | `active_day`, `active_week`, `active_month`, sent once per period on first open, gated by a local-storage date flag | Closest available answer to "how many users" | **Deferred** | Counts browsers, not people. Conflicts with "No anonymous unique-user count exists" on the Privacy page and "no unique count" in [PRIVACY.md](PRIVACY.md#two-distinct-purposes); both and the consent text must change first. Clearing site data counts again. |
| New installs | `install_new` on first ever open, local flag | Growth | **Deferred** | Same caveats as active installs. |
| Time since last open | Buckets: same day, 1–7 days, 8–30 days, over 30 days | Return rate without identifiers | **Deferred** | Derived locally from a stored last-open date; only the bucket is sent. Even so, it is a returning-visitor metric, which [PRIVACY.md](PRIVACY.md#two-distinct-purposes) says is not possible. It also needs a new persistent date in browser storage. Requires a PRIVACY.md and consent revision first. |
| Session length | Buckets: under 1 min, 1–5, 5–30, 30–120 min, 2 h or more | Engagement depth | **Deferred** | Conflicts with the Privacy page's "sessions or individual histories" never entering application analytics. Would send only the bucket on page hide, never a session ID, but still needs a PRIVACY.md and consent revision. |
| Platform | Browser family, OS family, WebGPU available yes/no | Support and solver backend decisions | **Deferred** | Coarse families still narrow a small opted-in population and act as a fingerprinting dimension. No versions, user agent strings or screen sizes. WebGPU use is already covered by `solver_backend` (`cpu`, `webgpu`, `unknown`) for OpenFEA solves. |
| App version | Release from a fixed allowlist per app, older releases grouped | Spot regressions per release on the Issues page | **Needs redesign** | Allowlisted values only, never free text or build hashes. The ingestion contract is exactly `record({ level, event, bucket })`; `bucket` already carries each event's value, so a version cannot be added as a bucket, and there is no field for a dimension. Needs a contract and storage redesign across all apps. |
| File formats | Import and export format from a fixed list per app (STEP, STL, 3MF, OBJ, other) | Prioritise importers and exporters | **Overlaps** | Format only, never filenames. Partly covered already: `feature_operation` has `import.step` and `import.mesh` for OpenZCAD, and `feature_category` has `import` and `export`. Only export formats would be new. |
| Model size, OpenFEA half | OpenFEA mesh element count, in ranges | Performance planning | **Later** | Ranges only, with a wide top range as for lattice cells. The OpenLattice3D cell count moved to [Implemented in Glimpse, app adapters pending](#implemented-in-glimpse-app-adapters-pending) with [ADR 0001](decisions/0001-openlattice3d-v2-parity.md). |

## Server-side cloud snapshot additions

Computed by OpenZCAD inside the existing daily account census. No browser
collection change. Each adds columns to `daily_census`, so it needs a Glimpse
migration and a matching OpenZCAD change.

| Field | Shape | Purpose | Status | Privacy notes |
| --- | --- | --- | --- | --- |
| Accounts by storage used | Counts in ranges: under 10 MB, 10–100 MB, 0.1–1 GB, 1 GB or more | Whether a few accounts drive storage cost | **Later** | Upper ranges may hold one or two accounts. Needs a k-threshold, with small ranges merged or withheld; reuse `ACTIVITY_MIN_COUNT` and the withheld-as-`NULL` storage of the activity counts. |
| Revisions per project | Counts in ranges: 1, 2–5, 6–20, more than 20 | How projects evolve | **Later** | Counts projects, not accounts; still apply the k-threshold to sparse ranges. |

Active and idle accounts moved to
[Implemented in Glimpse, app adapters pending](#implemented-in-glimpse-app-adapters-pending).

Snapshot fields must stay aggregate counts over consenting accounts. Never
per-account rows or totals.
