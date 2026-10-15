# Glimpse

A small, protected analytics dashboard for OpenZCAD and OpenFEA. One Cloudflare Worker, one D1 table of daily counters, and two fixed service-binding entrypoints. No public ingest endpoint or raw event history.

- Basic statistics: server-side API activity, 5xx errors, coarse response times.
- Optional usage: explicit opt-in only; browser-local exports, solver outcomes, feature actions and workflow-step counts. Withdrawal stops future collection immediately. Optional figures represent opted-in users only.
- Combined totals and per-app views, UTC date filters (up to 90 days), activity bars, event counts and timing histograms. App and collection level remain distinct in storage and queries.

Primary domain: [glimpse.esau.app](https://glimpse.esau.app), protected by Cloudflare Access with the owner's exact account identity and Cloudflare login required. The hostname, issuer and application audience are configured in Wrangler; the dedicated database ID is configured. The live Worker currently serves its initial placeholder, pending schema initialization and dashboard deployment.

See [setup](docs/SETUP.md), [privacy and consent limits](docs/PRIVACY.md), and [validation status](docs/VALIDATION.md). The database must be provisioned before dashboard deployment. No deploy command runs automatically in GitHub Actions CI.

```sh
npm ci
npm run check
```

`npm run check` typechecks, runs real Worker/RPC/D1/auth regression tests, removes generated `dist` output and proves a Wrangler deployment dry-run builds the dashboard and bundles the Worker without a separate build step. `npm run dev` serves the dashboard UI only; the authenticated API needs `wrangler dev` and Access configuration. A missing API shows an error instead of fake data. Do not expose the Vite development server to the internet.

The event vocabulary is maintained in `src/contract.ts` and mirrored by the small app adapters. Changing the schema requires coordinated PRs and a privacy review. Backend API counters do not measure browser-local work or people; optional workflow counts cannot reconstruct individual workflows.

Cloudflare Workers Builds must have **Build command: `npm run build`**, **Deploy command: `npx wrangler deploy`**, and **Root directory: `/`**. The Wrangler custom build also covers direct CLI use; see [setup](docs/SETUP.md#cloudflare-workers-builds).
