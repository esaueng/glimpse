# Dashboard implementation contract

Direction: "Aperture", a brand-led dark console built around the Reveal mark's
pale blue. Native React/CSS and SVG; no new chart or UI dependency, imagery,
gradients, tracking or fetched fonts (system sans and monospace stacks only,
within the existing `style-src 'self'` policy).

Shell: a 224px sidebar with the Glimpse mark, grouped navigation and the access
label. Groups: Monitor (Home, Issues, Performance), Product (Usage, Storage),
Infrastructure (Costs) and Settings (Sources, Privacy). Each item has a 17px line
icon; the current page has a selected background and an accent icon. No
coloured accent edges or stripes on cards, rows or navigation; status is
carried by pills and text. At 900px
and below the sidebar becomes a sticky top bar with a menu button
(`aria-expanded`, Escape closes) that reveals the same navigation.

Page head, sticky above 900px so the scope stays in reach while the page
scrolls. One row when it fits: the title, then app tabs (All apps and one per app,
`aria-pressed`, selection shown by underline, weight and colour, with the
underline on the header's bottom edge), then the timeframe picker, an
"Updated HH:MM UTC" status and icon Refresh on the right. Below a 1080px content
width the tabs take their own row under the title. The OpenZCAD channel toggle
(Beta, Stable) sits right after the OpenZCAD tab whenever OpenZCAD data is in
scope (All apps or OpenZCAD). On Sources, which has no tabs, it appears beside
the timeframe as "OpenZCAD Beta | Stable". Changes apply immediately. Pages
without the analytics controls render their own actions into the header area
(Costs puts its Refresh and status there). No subtitle, scope sentence or
footer: the controls show the scope, and every opt-in panel or figure carries an
"Opted-in users" badge or an asterisk explained on the page. A failed load shows
one error line and keeps the last results. Copy stays short: labels and values,
with explanations in `title` attributes or on Privacy. The demo shows a one-line
"Demo · All numbers are made up." strip (the demo build check requires that text).

URLs use `view=home|issues|performance|usage|storage|costs|sources|privacy`; the
default is Home. Earlier links are rewritten in place: `overview` → Usage,
`diagnostics` → Issues, `cloudflare` → Costs.

Timeframe picker: a trigger showing a day-count badge and the formatted range
opens a popover with rolling presets (past 7, 14, 30, 90 days), calendar presets
in two columns (today/yesterday, this/previous week, this/previous month; weeks
start Monday, all UTC) and a custom range with two date inputs. The selection
shows a check mark. Presets are stored in the URL as `range=7d` and roll forward
each UTC day; custom ranges store `from` and `to`. The default is past 30 days.
Data is daily, so there are no sub-day options, and the API caps ranges at 90
days. Escape and outside clicks close it and return focus to the trigger.

Data: each load runs two parallel queries for the same app and dates, one
`basic` and one `optional`. Levels are never merged; panels name their source.
The collection selector is gone. `view=diagnostics` links resolve to Issues.

Pages:

- Home, health: one card per app in scope with a status (Healthy, Degraded,
  Failing, No traffic), API requests with a daily sparkline, server-error share,
  share of API requests at 1 s or more, diagnostics and the last day with data.
  Degraded at 1% server errors, 10% of timed requests at 1 s or more, or an open
  critical inbox issue; failing at
  5% server errors (`web/health.ts`; the thresholds are stated on the page). A
  "Needs attention" list ranks signals as critical, warning or note, each with
  its evidence and a link to the page that explains it: error rate, slow
  responses, a one-day error spike (at least 5 errors and 3× the median day),
  export, solver or generation failure shares of 10% or more with at least 5
  attempts, apps with no requests, and the top three diagnostic codes. "At a
  glance" shows opted-in workspaces, exports, cloud accounts and storage; a chart
  pair shows daily requests by app and server errors.
- Performance: a stat strip of API requests, server-error rate and the share of
  timed requests under 100 ms and at 1 s or more; daily requests by app and daily
  error rate; API response-time ranges per app; and the slow-operations panel
  (moved from Issues).
- Sources: Webhooks first: Connect Workers Issues shows the URL and the secret
  once, with copy buttons and the setup steps. Rows show received and rejected
  counts, last delivery and status, unrecognised key paths, and actions to
  rotate the secret or remove the source. "Agent access" shows the MCP URL with a
  copy button. Then connected sources (each app's analytics binding with its last data
  day, OpenZCAD cloud snapshots, Cloudflare usage and billing with a link to
  Costs) and planned ones, each with its delivery method (push, pull, probe)
  and state. Planned sources are labelled Planned and never shown as data.
  Sources always reads all apps; the app filter is hidden there.
- Usage (formerly Overview), utilization: a four-cell stat strip of opted-in cloud accounts, projects and revisions
  from the latest OpenZCAD snapshot with the change since the first snapshot in
  range; workspaces opened. Cloud growth as compact sparkline rows (accounts,
  projects, revisions, stored bytes with start, end and change) and, under them, an
  account-activity row from the latest snapshot (saved in the last 7 and 30 days,
  no save for 90 days or more, each with its share of accounts), activity by app with each app's
  main outputs and its share of API requests, top CAD operations, feature
  categories (only those an app in scope can send), OpenFEA workflow steps and
  solver backend, and model complexity: part-count ranges (OpenZCAD and OpenFEA)
  and lattice cell-count ranges (OpenLattice3D), each with an N/A row when the
  filter excludes its apps.
- Issues, inbox first: grouped problems from webhook sources, with Active
  (open and acknowledged), Resolved and Ignored tabs showing counts, and All,
  Errors and Security filters. The app filter applies. Rows show severity,
  title, Worker and app, occurrences, time since last seen and status, and
  expand to show first and last seen, error type, stack frames, note, recent
  activity, a note field and the actions for the status (Acknowledge, Resolve,
  Ignore, Reopen), plus a Cloudflare link. With no source it offers "Connect
  Workers Issues". Then "App diagnostics":
  a six-cell stat strip of server errors with error rate, diagnostic codes, failed exports,
  solver runs and generations with failure rates, cloud request failures.
  Daily server-error and diagnostic charts, ranked diagnostic codes (all three
  apps), cloud status ranking, the local report inspector, and a collapsed table
  of every opt-in bucket. Slow operations moved to Performance.
- Storage: stored bytes with change in range, project data, storage overhead,
  per-project and per-account averages, revisions and unknown-size artifacts;
  stored and project data over time; snapshot project-size ranges; saved,
  upload and download size observations (OpenLattice3D: saved only, with an N/A
  row for transfers and cloud saves); cloud saves under 1 s; daily snapshot
  history in a scrolling table.
- Costs (formerly Cloudflare): Esau infrastructure usage and costs, separate from application
  analytics and read from the private `cf_*` tables (see
  [CLOUDFLARE.md](CLOUDFLARE.md)). A stat strip of metered or allocated usage
  cost, fixed subscriptions, projected metered cost and account budget
  remaining; a "Needs attention" list of cost and collection alerts; daily
  metered cost by product with its data table; product usage and cost;
  applications with allocated costs and owner-editable app mappings and
  budgets; resource usage and ownership; fixed subscriptions; budget
  monitoring; and collection coverage per source with status and last
  success. Until the monitor is configured it shows connection guidance
  instead. Budget and app-mapping edits are sent to
  `POST /api/cloudflare/settings` behind Access; the analytics pages are
  read-only.
- Privacy: unchanged collection boundaries and consent text.

Palette: canvas #090e17, surface #0f1724, sunken #0c131e, line #213049, soft
line #19243a, control #53688f, text #eef3fb, muted #9db0cc, faint #8396b3,
sidebar #0b111b, raised #16223a, hover #142033, selected #17243c,
accent and OpenZCAD #a9c9fa, OpenFEA #e8eef7, OpenLattice3D #6f95cf, second tone
#7aa6c2, third tone #5577aa, warning #f6c177, error #ff8a9c (text #ffa3b1), healthy #7fd4a6.
Status is never shown by colour alone: pills and severities carry their word.
Control borders and every data tone reach at least 3:1 against the surface
(WCAG 1.4.11). Apps are told apart by lightness as well as hue; stacked bars
also carry visible values and legends, so no reading depends on color alone.

Type: one system sans stack. Figures use tabular digits in that face;
monospace is kept for code, URLs, IDs and stack frames. 24px page titles, 16px
section titles, 15px panel titles, 26px semibold strip values, 20px page gaps.
12px panel radii, 6px control radii, 8px segmented controls and navigation
items; pills, badges and bar tracks are fully rounded.

Structure: panels sit on a soft line; figures inside a card never get boxes of
their own. Grouped figures (health-card stats, At a glance, feature categories,
account activity) share 1px hairline dividers, like the stat strip. Rows that
lead elsewhere (health cards, Needs attention) are clickable across their
whole area through their existing link button. With one app in scope, its
health card puts the request figure and its stats side by side instead of
stretching them across the page.

Motion: 140ms colour and border transitions on controls and rows, a 220ms
fade-in when a page opens, a short pop for the timeframe popover and a pulsing
skeleton while the first data loads. `prefers-reduced-motion` removes all of it.

Charts: React-owned SVG lines in a 1000×200 view box with non-scaling strokes;
tick and date labels are HTML. At most four gridlines. A chart with more than
one series shows a text legend under its date axis. Pointing at a line chart
shows a crosshair and a readout of each series for the nearest day (the peak
chip hides meanwhile); Costs' daily stacked columns show the day's total on
hover. Readouts are aria-hidden conveniences: every chart has a
"Data table · UTC" disclosure with exact values, and bars, columns and stacked
bars carry text values or an accessible label, so no value is hover-only. No
live animation or polling. Failed refresh keeps prior results and marks them stale.

Empty, unavailable and unsupported stay distinct: "—" for not yet received,
"N/A" with the owning app named when the filter excludes it (owners follow the
per-app allowlist in `src/expanded.ts`; a panel with several measures shows an
N/A row for each excluded one, after those that apply), and "Not collected"
for metrics Glimpse does not record, or that the snapshot did not carry (the note
says whether OpenZCAD did not send it or migration 0005 is pending). A count held
back by the k-threshold shows "Withheld (fewer than 5)", never a number.

Mobile (≤760px): the timeframe trigger and Refresh share a row, the app tabs
scroll sideways under them, the timeframe trigger and its
popover span the width, stat strips reflow, wide tables scroll inside labelled regions, slow-
operation bars move under their labels. No horizontal page overflow.

Proposed metrics that are not collected yet are listed in
[PROPOSED-METRICS.md](PROPOSED-METRICS.md) and are not rendered, except those
implemented in Glimpse with app adapters pending, which render in their
"Not collected" state until an app sends them.
