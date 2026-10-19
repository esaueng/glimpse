# Proposed metrics

Candidates for a future schema change. None are collected or rendered. Each
needs coordinated app adapter PRs, a `src/contract.ts` or `src/expanded.ts`
change, and a privacy review as described in [PRIVACY.md](PRIVACY.md). Several
conflict with promises the Privacy page makes today; those are called out.

## Opt-in browser counters

| Metric | Shape | Purpose | Privacy notes |
| --- | --- | --- | --- |
| Active installs | `active_day`, `active_week`, `active_month`, sent once per period on first open, gated by a local-storage date flag | Closest available answer to "how many users" | Counts browsers, not people. Conflicts with "No anonymous unique-user count exists"; the Privacy page and consent text must change first. Clearing site data counts again. |
| New installs | `install_new` on first ever open, local flag | Growth | Same caveats as active installs. |
| Time since last open | Buckets: same day, 1–7 days, 8–30 days, over 30 days | Return rate without identifiers | Derived locally from the stored last-open date; only the bucket is sent. |
| App version | Release from a fixed allowlist per app, older releases grouped, added as a dimension or bucket on opt-in counters | Spot regressions per release on the Issues page | Allowlisted values only, never free text or build hashes. |
| Session length | Buckets: under 1 min, 1–5, 5–30, 30–120 min, 2 h or more | Engagement depth | Conflicts with "sessions … never enter Glimpse"; send only the bucket on page hide, never a session ID. |
| Platform | Browser family, OS family, WebGPU available yes/no | Support and solver backend decisions | Coarse families only; no versions, user agent strings or screen sizes (fingerprinting risk). |
| File formats | Import and export format from a fixed list per app (STEP, STL, 3MF, OBJ, other) | Prioritise importers and exporters | Format only, never filenames. |
| Model size | OpenFEA mesh element count and OpenLattice3D cell count, in ranges | Performance planning | Ranges only. |
| More diagnostic codes | `error_unresponsive` (main thread blocked 5 s or more), `error_gpu_lost`, `error_out_of_memory`, `error_worker` | Failures the current codes miss | Fixed codes, no messages or stacks. |

## Server-side cloud snapshot additions

Computed by OpenZCAD inside the existing daily account census. No app change
and no new browser collection.

| Field | Shape | Purpose |
| --- | --- | --- |
| Active accounts | Accounts with a save in the last 7 and 30 days | Engagement among consenting accounts |
| Idle accounts | Accounts with no save for 90 days or more | Churn signal |
| Accounts by storage used | Counts in ranges: under 10 MB, 10–100 MB, 0.1–1 GB, 1 GB or more | Whether a few accounts drive storage cost |
| Revisions per project | Counts in ranges: 1, 2–5, 6–20, more than 20 | How projects evolve |

Snapshot fields must stay aggregate counts over consenting accounts. Never
per-account rows or totals.
