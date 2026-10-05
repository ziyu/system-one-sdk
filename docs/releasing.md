# Release operations

Packages under `packages/` are independently versioned. The root is private. Changesets owns versions, dependency changes and package changelogs. No fixed/linked groups exist. The original split batch used `0.6.0`; later packages start at `0.0.0` and use a `minor` changeset for their first `0.1.0` release.

## Development and Release PR

Use Node 24 and `npm ci --ignore-scripts`. Add a changeset with `npm run changeset` for consumer-visible changes. Patches fix compatible behavior, minors add compatible behavior; before 1.0 a breaking change requires a minor bump, a BREAKING note and migration instructions. Public helper subpaths and types follow the same policy.

The Version packages workflow runs `scripts/version.mjs` on main and opens a Release PR. It uses Changesets to calculate versions and changelogs, but applies only packages explicitly named by reviewed changesets. Automatic dependent bumps are excluded. `npm run version:packages -- --plan` previews the selected packages and excluded dependents without changing files. The generated `.changeset/release.json` records each selected package's old/new version, reason and changeset evidence; prepare, verify and publication require this scope to match the frozen manifest.

Version generation happens in the Release PR. During an active prerelease, another changeset produces the next RC. To leave RC mode, run `npm run changeset -- pre exit`, commit that state, and merge the generated stable Release PR. Stable tarballs are new bytes and must pass their own verification.

## Package release boundary

Only release packages with an actual change to their runtime, public types, exports, required assets or dependency contract. A new version of a dependency is **not** by itself a change to every dependent. No repository-wide bump, fixed group or linked version cohort is allowed.

- A changeset must name each affected package and explain why it needs a release. An unchanged sibling is omitted, even when it is tested in the same CI run.
- An unchanged package retains its exact version, dependency ranges and changelog. Version generation verifies its manifest byte-for-byte. Do not widen or raise its dependencies solely to make the workspace share the latest version.
- A dependent that actually consumes a new API, validation behavior or required shared runtime identity is affected: explicitly list it with that reason and test its new minimum dependency. This is a dependency-contract release, not permission to recursively bump the rest of the graph.
- Before 1.0, changing a shared runtime compatibility line may require a minor dependent release. For example, moving an error-producing transport from core `^0.6` to `^0.7` must not arrive as a `0.6` patch in existing clients. Mixing core generations can invalidate `instanceof`, retries and cancellation. Retain older compatible registry dependency graphs instead.
- Repository/docs/CI maintenance alone does not authorize republishing all packages. Defer incidental package metadata changes until that package has its own justified release, or explain a genuinely required metadata-only release separately.
- The only implicit version transition allowed is exiting an already-published prerelease package to stable. Unrelated stable dependents still remain untouched.

`test:package` tests compatible dependency graphs separately, resolving historical dependencies from npm where their existing ranges require them. This does not expand the upload list. `release:prepare` still requires one consistent dependency version within the selected release graph, validates lower bounds and fails if the selected set omits a genuinely required dependency update. Fix the explicit package scope; never force all siblings to upgrade merely to make a single artificial workspace cohort install.

Source integration (`npm test`, `test:scenarios`) resolves internal ESM imports to the checked-out workspace exports using a test-only loader. It tests the current implementations together; it is not installation evidence. `test:package`, workerd and live release consumers never load that resolver: they install exact tarballs/registry versions and retain error-identity, retry and cancellation checks. The release rehearsal performs a fresh `npm ci` after version generation so nested historical dependencies match a clean CI checkout.

For the image feature the reviewed scope is eight packages: `core`, `adapter-cloudflare`, `adapter-local`, `decisions`, `evaluation`, `batch`, `protocol-system-one`, and `transport-fetch`. The first five change implementation/types; batch requires the new core snapshot; protocol/transport move with core's runtime error identity. LLM, OpenRouter, TypeSafe, Vercel, WebGPU, Laya, ONNX and policies are not released. Package versions are generated, not manually synchronized.

## Frozen artifacts and release gate

Merging a Release PR changes `release.json` and starts one Release workflow for the entire batch. Package tags do not trigger publication.

1. Node 24 runs types, regression/scenario tests and isolated tarball ESM/CJS/type checks. workerd checks the same packed bytes.
2. `release:prepare` verifies clean source on main, explicit per-package scope evidence, lockfile/versions/changelogs, receipt and hashes. It installs unchanged dependencies from npm at compatible minimum versions and tests combinations with the new artifacts. If a changed dependency's range also allows an older version, that lower-bound combination is checked separately.
3. `.artifacts/release-manifest.json` freezes the selected scope, commit, lock digest, Node/npm versions, dependency graphs, SHA-512/SHA-256, changelog notes and verification receipt. Tarballs and manifest are saved for 90 days. Only the explicitly selected entries have upload filenames; registry dependencies are verification inputs, never republished.
4. Node 20/22/24 install and verify that exact artifact set, with no rebuild.
5. The job targeting the `npm` environment downloads those artifacts, preflights every existing version/tag and publishes missing packages in dependency order using OIDC/provenance. All uploads initially use `next`.
6. All packages are installed from the public registry at the recorded exact versions, integrity checked, and exercised as ESM/CJS/type consumers. `publish` writes a passing registry receipt bound to the source, manifest digest and every package integrity; it never promotes `latest` or creates GitHub releases.
7. The separate `finalize` job waits at the protected `npm` environment. For stable releases, approve it only after the registry-installed real model checks below pass against the exact release source/artifacts. The job validates the receipt and all published integrities again, promotes stable versions to `latest`, reads back every tag, and records `release-result.json`. RCs are never promoted. A newer stable `latest` is retained; a newer prerelease on `latest` blocks automatic promotion for explicit resolution.
8. Only after the entire batch's tags are confirmed are per-package tags/releases created at the source commit. Each release uses its package changelog and attaches the tarball, manifest, checksums, registry receipt and finalization report. GitHub has one repository-level `Latest` marker, so package releases are created with `latest=false`; finalization then marks the highest stable package version as the canonical repository `Latest`, preferring `core` on a version tie. This marker is only a GitHub display/ navigation aid; npm `latest` remains independent for every package.

Runtime dependencies in the internal graph are independently versioned. The resolver enforces one shared version per internal package **within a compatible consumer graph**, not across every workspace package. Adding an external runtime dependency requires extending artifact verification first. Never silently drop dependency verification to make a release pass.

Run `npm run test:release` with a pending changeset for a disposable, non-publishing rehearsal of scoped version generation, unchanged-manifest preservation, builds, packages, consumer graphs and tamper rejection. Use `npm run test:release -- --stable` while in prerelease mode to rehearse the stable transition instead. The temporary checkout and artifacts are retained for inspection/live testing. Tests cover core-only changes without dependent version churn, explicit dependent updates, historical registry dependencies, partial uploads/promotions, receipt mismatches and prevention of tag downgrades.

## npm and GitHub setup

Enable GitHub Actions to create pull requests. The `npm` environment permits only the `main` branch, requires maintainer `ziyu` to review deployments, and disables administrator bypass. Self-review remains possible for this single-maintainer repository. The upload and finalization jobs have separate deployments: approve uploads after the candidate checks, then finalization after registry/live acceptance. Configure npm Trusted Publishing for **each** package with owner `ziyu`, repository `system-one-sdk`, workflow `release.yml`, environment `npm`. Publication uses Node 24 and npm 11.17.0.

This workflow uses OIDC for publication and `NPM_TAG_TOKEN` only for identity/tag operations. Store the token only in the protected `npm` environment with read/write access limited to maintained independent packages, no organization-management permission, automation/2FA bypass enabled and a maximum 90-day lifetime. Credential scope is not release scope: access to 16 packages never authorizes a 16-package upload. Keep the old SDK excluded. Missing/expired credentials fail before upload; never put tokens in source, artifacts or repository-wide workflow variables. npm now offers a separate OIDC dist-tag permission, but migrating the workflow to it is a distinct reviewed change.

Check scope ownership and package-name permissions separately. Public registry 404 is not evidence of publish permission. If a first package cannot configure OIDC before it exists, a maintainer must bootstrap it once using the exact verified tarball and `next`, then enable Trusted Publishing and resume the same batch. This first publication remains a separate authorized operation. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

The `0.6.0-rc.0` batch used this bootstrap exception without provenance. All 11 Trusted Publisher configurations have been read back. Stable `0.6.0` subsequently exercised both paths successfully: all 11 packages were uploaded with OIDC/provenance, verified by `npm audit signatures`, and promoted with the protected tag credential. The initial tag token expires on 2026-12-18; rotate the environment secret before then.

For a new package, npm can initialize `latest` even when publication requests `next`, and the registry has rejected removing that automatic tag. The bootstrap workflow therefore verifies both tags and accepts `latest` only when it points to the exact frozen first version. Treat this as an unavoidable first-publication exception: approve bootstrap only after artifact verification, configure Trusted Publishing immediately, and resume the original release so normal registry checks and stable finalization verify the same bytes again. Before later stable promotion, verify authentication for `npm dist-tag` separately: npm CLI's automatic OIDC exchange for `npm publish` does not authenticate tag mutations.

Use the protected `Bootstrap new npm packages` workflow for this one-time first publication. It downloads the already frozen `release-COMMIT` artifact from the original Release run, verifies source/run binding plus SHA-256/SHA-512, and publishes only explicitly named registry-missing packages to `next` with the protected tag token. It never rebuilds packages. After bootstrap, configure GitHub Actions Trusted Publishing for every new package (`ziyu/system-one-sdk`, `release.yml`, environment `npm`, allow `npm publish`) before resuming the original Release batch. `npm trust` itself requires an existing package and interactive/2FA-capable authentication, so that trust step is intentionally not automated with the bypass-2FA tag token.

For `0.6.0-rc.0`, two authenticated removal attempts returned registry HTTP 400 with only `Request failed with status code 400`; the current bootstrap token likewise received HTTP 403 after successfully creating a new package. Further authentication retries are not a verified remedy. The RC tags remained until the verified stable release replaced them through normal finalization; no placeholder version or republished bytes were used.

## Recovery

Prefer **Re-run failed jobs**: successful prepare jobs retain the original artifact. If manually resuming, supply both the original full commit and original run ID:

```sh
gh workflow run release.yml --repo ziyu/system-one-sdk --ref main \
  -f commit=FULL_SOURCE_SHA -f artifact-run-id=ORIGINAL_RUN_ID
```

The workflow downloads `release-FULL_SOURCE_SHA`, verifies its source, receipt and hashes, and never rebuilds it in the publisher. Existing candidate versions are reused only if npm SHA-512 matches. Unchanged dependencies use their registry SHA-512; their locally rebuilt bytes are irrelevant. A conflicting version or Git tag blocks the entire batch before new uploads. Never replace a published version or move a tag. Prefer rerunning the original workflow attempt when recovering an older release whose script predates the split finalization job.

If finalization fails after some tags were promoted, rerun only the failed job: it downloads the same frozen artifacts and `registry-verification-RUN_ID`, validates them again, and skips equal/newer stable tags. The receipt artifact name remains constant across attempts so this recovery does not require another upload job. Resolve credential expiry by rotating the environment secret, not by rebuilding or republishing. The finalization job has no OIDC upload permission. A failed receipt, integrity check, promotion or tag readback prevents GitHub release creation for that attempt.

An npm upload can succeed before version metadata or the dist-tag endpoint appears. The job polls both with bounded requests for up to 61 attempts and five-second delays, never repeating publication during that wait. Installation indexes may lag even after exact-version metadata appears; an installation 404 after a successful upload is a reason to retry verification against the same artifacts once indexes synchronize, not to republish. A later retry rechecks metadata. A failed consumer check does not promote stable tags or create new package tags; separately inspect npm's automatic `latest` initialization for new packages. Partial stable promotion/tag creation is safe to resume. npm has no atomic multi-package publish or tag update; announce completion only after the workflow succeeds and dist-tags match the intended channel. Preserve the original artifacts beyond retention if recovery is still needed.

## Real model checks and migration

`npm run test:release:live -- /path/to/typesafe.env /path/to/llm.env` tests the frozen manifest in an isolated consumer, using seven native TypeSafe requests and two LLM requests. Run from the candidate checkout after `release:prepare`. Supply only the first env file to check TypeSafe alone. Reports include source/manifest digests, exact package integrities, models, times and results. Credentials are never copied into artifacts. These checks are explicit, can incur model usage, and do not run in ordinary PR CI.

For both RC and stable releases, run these checks again with `--registry` after publication to test npm-installed bytes before approving finalization. Cloudflare's workerd tests use fixture inference; real Cloudflare inference needs separate credentials. See [0.5.3 migration](migration-0.6.md) for import mappings and runnable examples.

After every stable package is available and verified, complete the planned migration announcement and old SDK deprecation with its migration link. Keep historical SDK versions installable. Fix published bugs with a new version; if necessary, restore `latest` to a previously verified stable version manually.
