# Release operations

Packages under `packages/` are independently versioned. The root is private. Changesets owns versions, dependency changes and package changelogs. No fixed/linked groups exist. The first batch is `0.6.0-rc.N`, then `0.6.0`; LLM remains one package.

## Development and Release PR

Use Node 24 and `npm ci --ignore-scripts`. Add a changeset with `npm run changeset` for consumer-visible changes. Patches fix compatible behavior, minors add compatible behavior; before 1.0 a breaking change requires a minor bump, a BREAKING note and migration instructions. Public helper subpaths and types follow the same policy.

The Version packages workflow runs Changesets on main and opens a Release PR. `npm run version:packages` also updates the lockfile and `.changeset/release.json`, which names exactly the changed versions. Review this batch, dependency ranges and each package's CHANGELOG. Never edit package versions or the batch manually. Pure documentation/CI changes may omit a changeset with a reason.

The initial changeset and prerelease state are committed, but version generation happens in the Release PR. Another changeset produces the next RC. To leave RC mode, run `npm run changeset -- pre exit`, commit that state, and merge the generated stable Release PR. Stable tarballs are new bytes and must pass their own verification.

## Frozen artifacts and release gate

Merging a Release PR changes `release.json` and starts one Release workflow for the entire batch. Package tags do not trigger publication.

1. Node 24 runs types, regression/scenario tests and isolated tarball ESM/CJS/type checks. workerd checks the same packed bytes.
2. `release:prepare` verifies clean source on main, lockfile/versions/changelogs, receipt and hashes. It installs unchanged dependencies from npm at compatible minimum versions and tests combinations with the new artifacts. If a changed dependency's range also allows an older version, that lower-bound combination is checked separately.
3. `.artifacts/release-manifest.json` freezes commit, lock digest, Node/npm versions, package dependency graphs, SHA-512/SHA-256, changelog notes and verification receipt. Tarballs and manifest are saved for 90 days.
4. Node 20/22/24 install and verify that exact artifact set, with no rebuild.
5. The job targeting the `npm` environment downloads those artifacts, preflights every existing version/tag and publishes missing packages in dependency order using OIDC/provenance. All uploads initially use `next`.
6. All packages are installed from the public registry at the recorded exact versions, integrity checked, and exercised as ESM/CJS/type consumers. `publish` writes a passing registry receipt bound to the source, manifest digest and every package integrity; it never promotes `latest` or creates GitHub releases.
7. The separate `finalize` job waits at the protected `npm` environment. For stable releases, approve it only after the registry-installed real model checks below pass against the exact release source/artifacts. The job validates the receipt and all published integrities again, promotes stable versions to `latest`, reads back every tag, and records `release-result.json`. RCs are never promoted. A newer stable `latest` is retained; a newer prerelease on `latest` blocks automatic promotion for explicit resolution.
8. Only after the entire batch's tags are confirmed are per-package tags/releases created at the source commit. Each release uses its package changelog and attaches the tarball, manifest, checksums, registry receipt and finalization report.

Internal packages currently have no third-party runtime dependencies. The resolver deliberately enforces one shared version per internal package and fails on incompatible ranges. Adding an external runtime dependency requires extending artifact verification first. Never silently drop dependency verification to make a release pass.

Run `npm run test:release` with a pending changeset for a disposable, non-publishing rehearsal of version generation, builds, packages, consumer checks and tamper rejection. Use `npm run test:release -- --stable` while in prerelease mode to rehearse the stable transition instead. The temporary checkout and artifacts are retained for inspection/live testing. Offline unit checks also simulate partial uploads/promotions, receipt mismatches, failure recovery and prevention of tag downgrades.

## npm and GitHub setup

Enable GitHub Actions to create pull requests. The `npm` environment permits only the `main` branch, requires maintainer `ziyu` to review deployments, and disables administrator bypass. Self-review remains possible for this single-maintainer repository. The upload and finalization jobs have separate deployments: approve uploads after the candidate checks, then finalization after registry/live acceptance. Configure npm Trusted Publishing for **each** package with owner `ziyu`, repository `sytem-one-sdk`, workflow `release.yml`, environment `npm`. Publication uses Node 24 and npm 11.17.0.

npm OIDC currently authorizes publishing, but not standalone dist-tag changes ([npm/cli#8547](https://github.com/npm/cli/issues/8547)). Store `NPM_TAG_TOKEN` only as a secret of the protected `npm` environment: a granular token with read/write access to the 11 selected independent packages, no organization-management permission, automation/2FA bypass enabled and a maximum 90-day lifetime. npm offers no tag-only write permission; restrict the selected packages and rotate the secret before expiry. Do not include the old SDK. Token identity is checked before stable uploads; a missing/expired token fails the job. The token is exposed only to the identity check and finalization step; uploads continue using OIDC with provenance. Never put it in source, artifacts or repository-wide workflow variables.

Check scope ownership and package-name permissions separately. Public registry 404 is not evidence of publish permission. If a first package cannot configure OIDC before it exists, a maintainer must bootstrap it once using the exact verified tarball and `next`, then enable Trusted Publishing and resume the same batch. This first publication remains a separate authorized operation. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

The `0.6.0-rc.0` batch used this bootstrap exception without provenance. All 11 Trusted Publisher configurations have been read back. Stable P4 must exercise a real OIDC upload and the separate tag credentials; a configured credential alone is not evidence that either mutation works.

For a new package, npm can initialize `latest` even when publication requests `next`. Inspect every package's dist-tags after bootstrap. If `latest` equals the RC, remove only that tag with `npm dist-tag rm PACKAGE latest`, then confirm `next` still resolves to the RC. Do not remove an existing stable or newer version's tag. npm may require separate security-key authentication for tag changes; the publish/trust authentication cooldown does not cover them. Before stable promotion, verify authentication for `npm dist-tag` separately: npm CLI's automatic OIDC exchange for `npm publish` does not authenticate tag mutations.

For `0.6.0-rc.0`, two authenticated removal attempts returned registry HTTP 400 with only `Request failed with status code 400`. The cause remains unknown; further authentication retries are not a verified remedy. All 11 automatic `latest` tags remain alongside `next`, so untagged installs also select the RC. Record this exception and the registry response; do not claim a `next`-only release, republish existing bytes, or publish a stable placeholder to hide it. Tag cleanup remains blocked pending resolution of the registry error.

## Recovery

Prefer **Re-run failed jobs**: successful prepare jobs retain the original artifact. If manually resuming, supply both the original full commit and original run ID:

```sh
gh workflow run release.yml --repo ziyu/sytem-one-sdk --ref main \
  -f commit=FULL_SOURCE_SHA -f artifact-run-id=ORIGINAL_RUN_ID
```

The workflow downloads `release-FULL_SOURCE_SHA`, verifies its source, receipt and hashes, and never rebuilds it in the publisher. Existing candidate versions are reused only if npm SHA-512 matches. Unchanged dependencies use their registry SHA-512; their locally rebuilt bytes are irrelevant. A conflicting version or Git tag blocks the entire batch before new uploads. Never replace a published version or move a tag. Prefer rerunning the original workflow attempt when recovering an older release whose script predates the split finalization job.

If finalization fails after some tags were promoted, rerun only the failed job: it downloads the same frozen artifacts and `registry-verification-RUN_ID`, validates them again, and skips equal/newer stable tags. The receipt artifact name remains constant across attempts so this recovery does not require another upload job. Resolve credential expiry by rotating the environment secret, not by rebuilding or republishing. The finalization job has no OIDC upload permission. A failed receipt, integrity check, promotion or tag readback prevents GitHub release creation for that attempt.

An npm upload can succeed before metadata appears. The job polls bounded requests for up to 61 attempts with five-second delays, never repeating publication during that wait. Installation indexes may lag even after exact-version metadata appears; an installation 404 after a successful upload is a reason to retry verification against the same artifacts once indexes synchronize, not to republish. A later retry rechecks metadata. A failed consumer check does not promote stable tags or create new package tags; separately inspect npm's automatic `latest` initialization for new packages. Partial stable promotion/tag creation is safe to resume. npm has no atomic multi-package publish or tag update; announce completion only after the workflow succeeds and dist-tags match the intended channel. Preserve the original artifacts beyond retention if recovery is still needed.

## Real model checks and migration

`npm run test:release:live -- /path/to/typesafe.env /path/to/llm.env` tests the frozen manifest in an isolated consumer, using seven native TypeSafe requests and two LLM requests. Run from the candidate checkout after `release:prepare`. Supply only the first env file to check TypeSafe alone. Reports include source/manifest digests, exact package integrities, models, times and results. Credentials are never copied into artifacts. These checks are explicit, can incur model usage, and do not run in ordinary PR CI.

For both RC and stable releases, run these checks again with `--registry` after publication to test npm-installed bytes before approving finalization. Cloudflare's workerd tests use fixture inference; real Cloudflare inference needs separate credentials. See [0.5.3 migration](migration-0.6.md) for import mappings and runnable examples.

After every stable package is available and verified, complete the planned migration announcement and old SDK deprecation with its migration link. Keep historical SDK versions installable. Fix published bugs with a new version; if necessary, restore `latest` to a previously verified stable version manually.
