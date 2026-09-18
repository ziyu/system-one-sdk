# Releasing the SDK

The repository uses two GitHub Actions workflows. Neither workflow reads a local `.env` file or calls a paid model API.

## CI

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests, and manual dispatches. It installs the lockfile, runs strict type checking and offline tests, compiles the examples, and installs the actual tarball in a temporary consumer project. The matrix covers Node.js 20, 22, and 24, including ESM, CommonJS, and both optional adapters.

## One-time npm setup

The release workflow uses npm Trusted Publishing with GitHub OIDC. No `NPM_TOKEN` repository secret is required. Configure a trusted publisher in the npm settings for `@system-one-ai/sdk` with these exact values:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `ziyu` |
| Repository | `sytem-one-sdk` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | Direct publishing with `npm publish` |

The GitHub repository must have an environment named `npm`. Repository owners can add required reviewers to it when manual approval is desired. The workflow runs on a GitHub-hosted runner with Node.js 24 and npm 11.17.0. Its job requests `id-token: write` for npm authentication and `contents: write` for the GitHub Release. Action references are pinned to commit SHAs, checkout credentials are not persisted, and release builds do not restore dependency caches.

The package's `repository.url` must stay aligned with the trusted publisher. See the official [npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/) for setup and authentication troubleshooting.

## Publish a new version

Merge the changes into `main`, then prepare a version commit and annotated tag. For example:

```sh
git switch main
git pull --ff-only
npm version patch -m "chore: release %s"
git push origin main --follow-tags
```

For an already prepared version such as `0.3.0`, tag that commit instead of incrementing it again:

```sh
git tag -a v0.3.0 -m "Release v0.3.0"
git push origin main v0.3.0
```

`.github/workflows/release.yml` starts on a `v*` tag. It verifies that the tag is a valid semantic version, matches both `package.json` and `package-lock.json`, identifies the checked-out commit, and belongs to the history of `origin/main`. A mismatched version or dirty tracked source stops the release before publication.

The workflow then runs the offline checks, builds and installs the package for verification, and publishes that exact tarball to npm. npm uses the configured trusted publisher and includes provenance. After verifying the registry's SHA-512 integrity, the workflow creates a GitHub Release with generated notes, the npm tarball, and `SHA256SUMS`.

Stable versions use the npm `latest` tag. Prereleases such as `v0.4.0-rc.1` use `next` and create a GitHub prerelease. Publish stable versions in ascending order. Release runs are serialized and do not cancel a publication in progress.

## Resume a failed release

Fix external configuration issues, such as a missing trusted publisher, and rerun the failed GitHub Actions run. Alternatively, manually run the **Release** workflow with the existing version tag:

```sh
gh workflow run release.yml --repo ziyu/sytem-one-sdk --ref main -f tag=v0.3.0
```

The tag must already exist; the workflow never creates or moves tags. If npm already has the same version, the workflow verifies that its integrity matches the newly tested tarball and skips the publish command. It then completes the GitHub Release and uploads the matching assets. An existing npm version with different contents stops the workflow; release a new version instead of overwriting or moving the old tag.

If npm accepts a publication but is still processing it, the current release script checks public metadata up to 61 times with five-second delays (five minutes of scheduled waiting, plus bounded request time). It never repeats `npm publish` during that wait. If metadata is still unavailable, the verification step fails; wait until the version is publicly readable before rerunning the workflow. Rerunning uses the same integrity check. A GitHub Release is not created until npm publication is verified. The original `v0.3.0` tag retains its shorter verification window; rerunning that release after the package becomes visible completes the same checks without moving the tag.

## Live model tests

Live integration checks stay separate from CI and publication. Run `npm run test:live` or `npm run test:live:openrouter` locally with the appropriate credentials when provider behavior changes. These commands consume real API usage. Their reports and credentials remain excluded from GitHub and npm packages.
