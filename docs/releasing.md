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
5. The protected `npm` job downloads those artifacts, preflights every existing version/tag and publishes missing packages in dependency order using OIDC/provenance. All uploads initially use `next`.
6. All packages are installed from the public registry at the recorded exact versions, integrity checked, and exercised as ESM/CJS/type consumers. Only then are stable versions promoted to `latest`; an already newer `latest` is never downgraded. RCs stay on `next`.
7. Per-package tags are created at the source commit and GitHub releases use that package's changelog. The matching tarball, manifest, checksums and registry verification report are attached.

Internal packages currently have no third-party runtime dependencies. The resolver deliberately enforces one shared version per internal package and fails on incompatible ranges. Adding an external runtime dependency requires extending artifact verification first. Never silently drop dependency verification to make a release pass.

Run `npm run test:release` for a disposable, non-publishing rehearsal of the initial RC and stable Changesets transitions, builds, packages, consumer checks, and tamper rejection. The temporary checkout and RC artifacts are retained for inspection/live testing. Offline unit checks also simulate partial publication and recovery. After the initial release, update this first-release rehearsal's expected versions when changing the release baseline.

## npm and GitHub setup

Enable GitHub Actions to create pull requests. Create a protected GitHub environment named `npm`; configure npm Trusted Publishing for **each** package with owner `ziyu`, repository `sytem-one-sdk`, workflow `release.yml`, environment `npm`. Publication uses Node 24 and npm 11.17.0. No long-lived npm token is stored in the workflow.

Check scope ownership and package-name permissions separately. Public registry 404 is not evidence of publish permission. If a first package cannot configure OIDC before it exists, a maintainer must bootstrap it once using the exact verified tarball and `next`, then enable Trusted Publishing and resume the same batch. This first publication remains a separate authorized operation. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

## Recovery

Prefer **Re-run failed jobs**: successful prepare jobs retain the original artifact. If manually resuming, supply both the original full commit and original run ID:

```sh
gh workflow run release.yml --repo ziyu/sytem-one-sdk --ref main \
  -f commit=FULL_SOURCE_SHA -f artifact-run-id=ORIGINAL_RUN_ID
```

The workflow downloads `release-FULL_SOURCE_SHA`, verifies its source, receipt and hashes, and never rebuilds it in the publisher. Existing candidate versions are reused only if npm SHA-512 matches. Unchanged dependencies use their registry SHA-512; their locally rebuilt bytes are irrelevant. A conflicting version or Git tag blocks the entire batch before new uploads. Never replace a published version or move a tag.

An npm upload can succeed before metadata appears. The job polls bounded requests for up to 61 attempts with five-second delays, never repeating publication during that wait. A later retry rechecks metadata. A failed consumer check leaves `latest` unchanged and creates no new package tags. Partial stable promotion/tag creation is safe to resume. npm has no atomic multi-package publish or tag update; announce completion only after the workflow succeeds. Preserve the original artifacts beyond retention if recovery is still needed.

## Real model checks and migration

`npm run test:release:live -- /path/to/typesafe.env /path/to/llm.env` tests the frozen manifest in an isolated consumer, using seven native TypeSafe requests and two LLM requests. Run from the candidate checkout after `release:prepare`. Supply only the first env file to check TypeSafe alone. Reports include source/manifest digests, exact package integrities, models, times and results. Credentials are never copied into artifacts. These checks are explicit, can incur model usage, and do not run in ordinary PR CI.

For the RC, run these checks again on a manifest with `--registry` after publication to test npm-installed bytes. Cloudflare's workerd tests use fixture inference; real Cloudflare inference needs separate credentials. See [0.5.3 migration](migration-0.6.md) for import mappings and runnable examples.

After every stable package is available and verified, authorize the migration announcement and old SDK deprecation separately. Keep historical SDK versions installable. Fix published bugs with a new version; if necessary, restore `latest` to a previously verified stable version manually.
