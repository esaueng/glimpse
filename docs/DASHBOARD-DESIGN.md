# Dashboard implementation contract

Direction: "Aperture", a brand-led dark console built around the Reveal mark's
pale blue. Native React/CSS and SVG; no new chart or UI dependency, imagery,
gradients, tracking or fetched fonts (system sans and monospace stacks only,
within the existing `style-src 'self'` policy).

Top bar: Glimpse mark, segmented navigation (Overview, Issues, Storage,
Privacy), access label. Toolbar: page title, app filter, UTC from/to dates with
Apply, 7/30/90-day presets, last update and icon Refresh. One applied-scope line
states that basic counts cover all users and opt-in figures cover opted-in
users only. Every opt-in panel carries an "Opted-in users" badge or note.

Data: each load runs two parallel queries for the same app and dates, one
`basic` and one `optional`. Levels are never merged; panels name their source.
The collection selector is gone. `view=diagnostics` links resolve to Issues.

Pages:

- Overview, utilization: Total users shown as an explicit "Not collected" gap;
  opted-in cloud accounts, projects and revisions from the latest OpenZCAD
  snapshot with the change since the first snapshot in range; workspaces opened.
  Cloud growth charts (accounts, projects), activity by app with each app's
  main outputs and its share of API requests, top CAD operations, feature
  categories, OpenFEA workflow steps and solver backend, and part-count ranges.
- Issues: server errors with error rate, diagnostic codes, failed exports,
  solver runs and generations with failure rates, cloud request failures.
  Daily server-error and diagnostic charts, ranked diagnostic codes, cloud
  status ranking, slow-operation share (10 s or more) per timing event, the
  local report inspector, and a collapsed table of every opt-in bucket.
- Storage: stored bytes with change in range, project data, storage overhead,
  per-project and per-account averages, revisions and unknown-size artifacts;
  stored and project data over time; snapshot project-size ranges; saved,
  upload and download size observations; cloud saves under 1 s; daily snapshot
  history in a scrolling table.
- Privacy: unchanged collection boundaries and consent text.

Palette: canvas #0a0f18, surface #111a28, sunken #0d1420, line #22304a, soft
line #1c2840, control #2c3d5c, text #eef3fb, muted #9db0cc, faint #8396b3,
accent and OpenZCAD #a9c9fa, OpenFEA #e8eef7, OpenLattice3D and second tone
#6f95cf, third tone #3e5a85, warning #f6c177, error #ff8a9c (text #ffa3b1).
Apps are told apart by lightness as well as hue. 28px page titles, 16–18px
section and panel titles, 30px tabular monospace tile values. 12px panel radii,
6px control radii (squared buttons), 9px navigation group.

Charts: React-owned SVG lines in a 1000×200 view box with non-scaling strokes;
tick and date labels are HTML. At most four gridlines. Every line chart has a
"Data table · UTC" disclosure with exact values. Bars, columns and stacked
bars carry text values or an accessible label. No hover-only values, live
animation or polling. Failed refresh keeps prior results and marks them stale.

Empty, unavailable and unsupported stay distinct: "—" for not yet received,
"N/A" with the owning app named when the filter excludes it, and "Not collected"
for metrics Glimpse does not record.

Mobile (≤760px): navigation spans the width, filters collapse into a native
disclosure, tiles reflow, wide tables scroll inside labelled regions, slow-
operation bars move under their labels. No horizontal page overflow.

Proposed metrics that are not collected yet are listed in
[PROPOSED-METRICS.md](PROPOSED-METRICS.md) and are not rendered.
