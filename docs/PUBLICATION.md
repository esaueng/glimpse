# Public-source privacy review

Reviewed 15 October 2026 against main `21edfc48526eac9ab4f7f46b1ab6ec7b1930f536` and the fetched branch history. This review prepares the repository for publication; it does not change its visibility or the dashboard's Access policy.

## Results

- All 16 commits reachable from the fetched repository branches use public GitHub identities. A local private-denylist scan covered raw commit metadata/messages, historical filenames and file contents, including deleted files. The denylist and its values remain outside the repository and CI.
- Gitleaks 8.30.1 scanned fetched history and the current source. Its three initial findings were the two public Cloudflare Access audience values in Wrangler configuration and generated types. These values identify JWT recipients and are not authentication tokens. Narrow exceptions apply only to those exact values on standalone `ACCESS_AUD` lines in those two files. Other keys, paths and credential rules remain checked.
- Source, migrations and tests contain no discovered credentials, personal contact details, private local paths, database dumps, real analytics fixtures or model/customer files. Tests generate signing keys and JWTs locally. D1 identifiers, the Access issuer/audiences and the application hostname remain intentionally visible deployment configuration.
- Current GitHub issue/PR descriptions and comments passed the local private-denylist check. There were no releases or Actions artifacts at review time.
- The reviewed collector accepts only fixed metric fields and immediately writes daily counters. Dashboard assets and data require a verified Access JWT; no raw event store or application logging was found. Existing Worker tests cover rejected identifying fields, forged/expired/wrong-audience tokens, preview isolation and aggregate retention. See [privacy limits](PRIVACY.md) for infrastructure logging, consent and rollout limits.

No confirmed sensitive disclosure requiring a history rewrite or credential rotation was found in the reviewed material. This is a bounded source/history review, not a guarantee about every unknown secret. Historical Actions logs, external Cloudflare data/logs/backups, hidden GitHub refs and third-party app storage were not audited.

## Ongoing checks

`commit-privacy` matches the public Esau/OpenFEA policy: API-only metadata checks on pull requests, pushes (including tags) and merge groups, read-only permissions, no checkout or PR-code execution, redacted failures and synthetic regressions. It protects the configured public owner login while allowing other contributors' identities. Pull requests use the base branch's policy through `pull_request_target`; the initial rollout is exercised by its push run.

`secret-scan` uses a checksum-pinned Gitleaks binary, full fetched history, commit messages and tag annotations. It runs independently of dependency installation/builds, redacts values, uploads no reports, and ignores inline suppression comments and `.gitleaksignore`. Synthetic regressions verify the narrow audience exceptions and detection of credentials deleted from the current tree. Gitleaks is a CI/developer tool only; there is no new application dependency. Scanner policy/workflow changes still require review.

Local checks:

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/verify-secret-scan.py # requires Gitleaks 8.30.1
gitleaks git . --config .gitleaks.toml --log-opts="--all --full-history" --gitleaks-ignore-path /dev/null --ignore-gitleaks-allow --redact --no-banner
npm run check
```

Before every push, run the locally installed `git-privacy-guard verify --repo .`; its shared pre-push hook scans outgoing content against the private denylist. Never copy the denylist into GitHub variables, secrets, workflows, tests or reports.

Hosted GitHub Actions were blocked before job startup by an account payment/spending-limit error at review time. Successful local checks do not establish hosted CI success. Branch protection was unavailable while this private repository's current account plan lacked that feature. After publication, require `commit-privacy`, `secret-scan` and `verify` on the default branch if supported. Repository publication, merging this change and policy changes remain separate actions.
