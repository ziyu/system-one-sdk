# Versioning

Run `npm run changeset` for a consumer-visible change. Packages are independently versioned; there are no fixed or linked groups. The Version packages workflow opens a Release PR containing package versions, dependency updates, changelogs, lockfile and `release.json` (the exact batch).

New public packages start at `0.0.0` and use a `minor` changeset for their first release, producing `0.1.0`. Do not copy another package's version or add a fabricated released changelog entry.

During an active prerelease, add a changeset for another RC. To prepare stable, run `npm run changeset -- pre exit`, commit the prerelease state and let the Release PR generate stable versions. Do not edit `release.json` by hand. See [release operations](../docs/releasing.md).
