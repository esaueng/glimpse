# ADR 0001: OpenLattice3D and the expanded (v2) analytics contract

- **Status:** Accepted — Option B (owner, 13 November 2026)
- **Date:** proposed 12 November 2026; accepted 13 November 2026
- **Roadmap:** [feature candidate 3](../ROADMAP.md#feature-candidates)
- **Deciders:** the owner. The Glimpse side is implemented; no app repository is changed.

## Decision

On 13 November 2026 the owner chose **Option B, targeted subset**. Glimpse now
accepts exactly the events in the table below from OpenLattice3D, in live
counts and in local reports (`app: "openlattice3d"`), and rejects every other
v2 event from it. The privacy review is
[Review: OpenLattice3D targeted subset (ADR 0001)](../PRIVACY.md#review-openlattice3d-targeted-subset-adr-0001).

| Event | Buckets | Lattice meaning |
| --- | --- | --- |
| `error_runtime` | `none` | An uncaught error anywhere in the page, the generic fallback |
| `error_import` | `none` | Opening an input model or a saved project failed. Included because OpenLattice3D imports models, as the `import` feature category records |
| `error_export` | `none` | Writing an export file failed (alongside the v1 `export_failed` outcome, as for the other apps) |
| `error_storage` | `none` | Saving or restoring the project locally failed |
| `error_render` | `none` | The 3D viewport failed to draw |
| `error_unresponsive` | `none` | The main thread was blocked for 5 s or more, typically during a large generation |
| `error_gpu_lost` | `none` | The WebGPU or WebGL device or context was lost |
| `error_out_of_memory` | `none` | An allocation failed or the browser signalled out of memory |
| `error_worker` | `none` | A generation or export Web Worker failed or stopped unexpectedly |
| `export_latency` | the five timing ranges | Export time |
| `project_size` | the four size ranges | Saved project file size |
| `feature_category` | `create`, `import`, `export`, `measure`, `other` | Coarse category of a completed action |
| `lattice_cells` (new) | `lt_1k`, `1k_10k`, `10k_100k`, `gte_100k` | Unit cells in a successfully generated lattice, one observation per generation |

Excluded diagnostic codes: `error_mesh` and `error_solver` (no meshing or
solving), `error_cloud_save` and `error_cloud_load` (no cloud storage), and
`error_feature`: OpenLattice3D has no feature tree, and a failed generation is
already the v1 outcome `generation_failed`, with its cause in the codes above.
No `error_generation` code was added; that would be new vocabulary needing its
own review. Everything else in v2 stays rejected for OpenLattice3D:
`cloud_status`, `transfer_upload`, `transfer_download`, `save_latency`,
`mesh_latency`, `solver_latency`, `solver_backend`, `part_count`,
`feature_operation`, the `edit`, `mesh` and `solve` feature categories, and the
census. The v1 scope (`LATTICE_OPTIONAL` in `src/contract.ts`) is unchanged.

**Cell-count ranges.** Four decade ranges: under 1,000, 1,000–9,999,
10,000–99,999, and 100,000 or more. The top range is deliberately wide and open:
very large lattices are likely rare among opted-in users, so splitting them (for
example at 1,000,000) could leave a range holding one or two people. Merging
everything from 100,000 cells up keeps the rarest models in the same range as
merely large ones, while still separating the sizes where browser memory and GPU
limits start to matter, which is the planning question. The app counts cells
and sends only the range; the count itself never leaves OpenLattice3D.

No migration: rows go to `daily_counts`, whose `app` check already allows
`openlattice3d` (`0002_openlattice3d.sql`) and whose `event`/`bucket` columns
are not constrained in SQL. Retention is unchanged (90 UTC days).

**Not done here.** The OpenLattice3D side is in the OpenLattice3D repository and
is not part of this change: the adapter at its failure sites, export and save
paths and generation step, a new consent version with an updated notice for the
broader scope (its legacy grant does not carry over), the local report download,
and confirmation of this event list against its actual failure sites. Until that
adapter ships, OpenLattice3D sends none of these events. Glimpse cannot verify
app-side consent, as for the other apps.

The analysis that led to the decision follows unchanged.

## Context (as of 12 November 2026, before the decision)

Glimpse has two optional-analytics vocabularies.

1. **The v1 vocabulary** in [`src/contract.ts`](../../src/contract.ts): fixed outcome
   and workflow events (`workspace_opened`, `export_completed`, …) with bucket
   `none`, plus `operation_latency` in timing ranges. OpenLattice3D uses a
   subset of it, `LATTICE_OPTIONAL`: workspace opens, export outcomes, lattice
   generation outcomes (`generation_*`, which only OpenLattice3D may send) and
   operation timing.
2. **The expanded (v2) vocabulary** in [`src/expanded.ts`](../../src/expanded.ts):
   size, part-count and transfer ranges, feature categories, CAD operations,
   cloud request statuses, mesh/solver/export/save timings, solver backend and
   the fixed `DIAGNOSTICS` codes. `expandedMetric()` returns false for any app
   other than `openzcad` and `openfea`, so OpenLattice3D cannot send any of it.
   The local report format (`parseReport`, `schema: 2`) accepts only
   `app: "openzcad"` or `"openfea"`, so OpenLattice3D users cannot share a
   diagnostic report either.

"Expanded v2 metrics and local reports do not apply" (README coverage table,
[EXPANDED-ANALYTICS.md](../EXPANDED-ANALYTICS.md#preserved-existing-integrations))
means exactly this. It is a consequence of rollout order rather than a recorded
decision: OpenLattice3D's integration (#74, `0002_openlattice3d.sql`) was built on
the v1 contract, and the v2 revision was scoped to the two apps that had
consent-v2 work under way. OpenLattice3D keeps its own legacy consent scope and
version; it never asked its users for the broader `granted-v2` scope.

What the gap costs today, in this repository:

- The dashboard hides OpenLattice3D from v2 panels with `EXPANDED_APPS`
  (`web/views.tsx`): Issues shows "App diagnostics" for OpenZCAD and OpenFEA
  only; Storage says no storage data applies; feature categories and model
  complexity show N/A when the filter is OpenLattice3D.
- A failed lattice generation is visible only as `generation_failed`, with no
  failure-site code. Nothing tells a WebGPU device loss from an out-of-memory
  failure, which matters most for the largest lattices.
- The [model-size candidate](../PROPOSED-METRICS.md) (lattice cell count in
  ranges) is blocked on this decision.

OpenLattice3D processes models in the browser; it has no account system, cloud
storage or server-side geometry API. Several v2 events therefore have no meaning
for it: `cloud_status`, `transfer_*`, `save_latency`, `solver_*`, `mesh_latency`,
`feature_operation` (CAD command kinds) and any census.

## Options

### A. Full parity

Accept every v2 event for OpenLattice3D that OpenZCAD or OpenFEA can send, and
`app: "openlattice3d"` in local reports.

- **Privacy:** largest change. Most events would be meaningless for a
  browser-only app, which conflicts with the data-minimisation stance of
  [PRIVACY.md](../PRIVACY.md) (collect fixed values for a stated purpose).
  Requires a new consent version in OpenLattice3D with an updated notice;
  existing grants cannot carry over, as `granted-v1` did not for the other apps.
- **Cost, glimpse:** small code change (`expandedMetric` app list, `parseReport`
  app list, `EXPANDED_APPS`), but every event needs a stated meaning for the
  third app, tests per event, and docs. No migration: rows go to `daily_counts`.
- **Cost, OpenLattice3D:** large. A v2 consent flow, an adapter for each event,
  a report download, and tests for DNT/GPC, withdrawal and cross-tab revocation,
  mirroring the OpenZCAD/OpenFEA work.

### B. Targeted subset (recommended)

Extend v2 to OpenLattice3D for the events that describe what it actually does,
and nothing else:

| Event | Lattice meaning |
| --- | --- |
| `DIAGNOSTICS` codes, excluding `error_mesh`, `error_solver` and the cloud codes | Failure sites in generation, export, rendering, storage, GPU loss, memory, workers |
| `export_latency` | Export time in the existing timing ranges |
| `project_size` | Saved project file size in the existing size ranges |
| `feature_category` (`create`, `export`, `import`, `measure`, `other`) | Coarse category of a completed action |
| A new lattice cell-count range event | The model-size candidate, in fixed ranges |

Local reports would accept `app: "openlattice3d"` with the same per-app scoping.

- **Privacy:** a bounded extension of already-reviewed shapes (fixed codes and
  ranges, no new dimension). Still needs a privacy review entry, an updated
  OpenLattice3D notice and a fresh consent version for the broader scope. The
  cell-count ranges need their own bounds review: very large lattices may be
  rare, and a top range could hold few users, so the top range should be wide.
- **Cost, glimpse:** moderate. Per-app scoping in `expandedMetric` (as is
  already done for OpenZCAD/OpenFEA), the report app list, one new range
  vocabulary, labels, dashboard panels that stop treating OpenLattice3D as N/A
  where it now applies, demo data and tests. No migration.
- **Cost, OpenLattice3D:** moderate. A consent-version bump and notice, adapters
  at the failure sites and the export/save paths, and the report download.

### C. Explicitly drop

Record that OpenLattice3D stays on the v1 vocabulary. Remove the conditional
language ("currently", "do not apply") and drop the OpenLattice3D half of the
model-size candidate.

- **Privacy:** none; the smallest collection surface stays as it is.
- **Cost, glimpse:** documentation only (README, EXPANDED-ANALYTICS,
  PROPOSED-METRICS, ROADMAP).
- **Cost, OpenLattice3D:** none.
- **Downside:** lattice failures stay opaque (`generation_failed` only), and
  the dashboard keeps N/A panels for one of three apps.

## Recommendation (as proposed, 12 November 2026)

**Option B, sequenced after the diagnostic-code review is approved.** The
largest operational gap is failure insight for browser-heavy lattice generation,
and the four new diagnostic codes (`error_gpu_lost`, `error_out_of_memory`,
`error_worker`, `error_unresponsive`) that are now
[approved for OpenZCAD and OpenFEA](../PRIVACY.md#review-additional-diagnostic-codes-and-account-activity)
describe exactly those failures. Option B reuses vocabulary that is already
reviewed, adds no new dimension, needs no migration, and avoids collecting
cloud, solver and CAD-command events that cannot mean anything for a browser-only
app. Full parity (A) would collect for its own sake; dropping (C) is reasonable
if the owner does not want a consent-version change in OpenLattice3D, and costs
only documentation.

Before any implementation:

1. Done: the owner chose B on 13 November 2026 (see Decision).
2. For A or B: a privacy review entry in [PRIVACY.md](../PRIVACY.md) (done for
   B), the OpenLattice3D notice and consent-version change, and the list of
   events confirmed against OpenLattice3D's actual failure sites (both pending,
   in the OpenLattice3D repository).
3. For C: update the documents listed under option C (not applicable).
