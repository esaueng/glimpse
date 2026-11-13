# ADR 0001: OpenLattice3D and the expanded (v2) analytics contract

- **Status:** Proposed — owner decision
- **Date:** 12 November 2026
- **Roadmap:** [feature candidate 3](../ROADMAP.md#feature-candidates)
- **Deciders:** the owner. Nothing here is implemented; no app repository is changed.

## Context

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

## Recommendation

**Option B, sequenced after the diagnostic-code review is approved.** The
largest operational gap is failure insight for browser-heavy lattice generation,
and the four new diagnostic codes (`error_gpu_lost`, `error_out_of_memory`,
`error_worker`, `error_unresponsive`) that are now
[drafted for OpenZCAD and OpenFEA](../PRIVACY.md#draft-review-additional-diagnostic-codes-and-account-activity)
describe exactly those failures. Option B reuses vocabulary that is already
reviewed, adds no new dimension, needs no migration, and avoids collecting
cloud, solver and CAD-command events that cannot mean anything for a browser-only
app. Full parity (A) would collect for its own sake; dropping (C) is reasonable
if the owner does not want a consent-version change in OpenLattice3D, and costs
only documentation.

Before any implementation:

1. The owner chooses A, B or C and records it here (Status: Accepted or Rejected).
2. For A or B: a privacy review entry in [PRIVACY.md](../PRIVACY.md), the
   OpenLattice3D notice and consent-version change, and the list of events
   confirmed against OpenLattice3D's actual failure sites.
3. For C: update the documents listed under option C.
