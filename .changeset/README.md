# Versioning

Run `npm run changeset` for a consumer-visible change. Packages are independently versioned; there are no fixed or linked groups. The Version packages workflow opens a Release PR containing package versions, dependency updates, changelogs, lockfile and `release.json` (the exact batch).

The first batch is in `rc` prerelease mode. For another RC, add a changeset and merge the next Release PR. To prepare stable, run `npm run changeset -- pre exit`, commit the prerelease state and let the Release PR generate stable versions. Do not edit `release.json` by hand. See [release operations](../docs/releasing.md).
