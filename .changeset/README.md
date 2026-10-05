# Versioning

Run `npm run changeset` for a consumer-visible change and name only packages with actual changes. A new dependency version is not a reason to release every dependent. Explicitly include a dependent only when its API, required validation or runtime dependency identity changes; explain the requirement. `scripts/version.mjs` filters automatic dependent bumps, preserves unselected manifests/changelogs, and records package-scoped evidence in `release.json`. The Release PR generates versions and dependency ranges only for that set; no fixed/linked groups or blanket bumps are allowed.

Preview the selected packages and excluded dependents with `npm run version:packages -- --plan`. The release guard rejects a batch without explicit scope evidence. Consumer tests may install older registry dependencies; testing a package never adds it to the publish list. See [package release boundary](../docs/releasing.md#package-release-boundary).

New public packages start at `0.0.0` and use a `minor` changeset for their first release, producing `0.1.0`. Do not copy another package's version or add a fabricated released changelog entry.

During an active prerelease, add a changeset for another RC. To prepare stable, run `npm run changeset -- pre exit`, commit the prerelease state and let the Release PR generate stable versions. Do not edit `release.json` by hand. See [release operations](../docs/releasing.md).
