# Releasing workspace packages

The repository root is private and cannot be published. Every runtime package under `packages/` is independently versioned. The release workflow publishes one package selected by a tag such as `core-v0.5.2` or `adapter-llm-v0.6.0-rc.1`. Old `v*` SDK tags no longer trigger publication.

## CI and artifacts

CI runs on Node.js 20, 22 and 24. It checks types, builds all packages, runs offline regression and workflow tests, then installs each package's tarball with only its dependency closure outside the repository. ESM/CJS runtime contracts and all installed declaration inference checks must pass. Neither CI nor releases read local credentials or call paid models.

`npm run test:package` records workspace filenames and SHA-512 integrities in `.artifacts/package-manifest.json` only after every package passes. Release commands use these exact tarballs; they do not rebuild during publication.

## npm setup

Configure npm Trusted Publishing separately for each package, with GitHub Actions publisher, owner `ziyu`, repository `sytem-one-sdk`, workflow `release.yml`, and environment `npm`. Create the GitHub environment with that name. The workflow uses Node.js 24, npm 11.17.0 and OIDC; no stored `NPM_TOKEN` is used.

Package metadata must retain the repository URL and its own `repository.directory`. For packages that do not yet exist on npm, complete the initial package/bootstrap setup permitted by your npm account before relying on OIDC. No package has been published by the workspace refactor. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) for current requirements.

## Prepare a release

Choose an unpublished version for the affected package. For example:

```sh
npm version patch --workspace @system-one-ai/adapter-llm --no-git-tag-version
npm install --ignore-scripts
npm run check
npm run test:package
```

Update dependent package ranges when changing a shared contract, especially across a major version. Commit the manifest and lockfile changes, merge them into `main`, and tag that commit with the package directory and its exact version:

```sh
git tag -a adapter-llm-v0.5.3 -m "Release adapter-llm 0.5.3"
git push origin adapter-llm-v0.5.3
```

The version above is illustrative; it must match `packages/adapter-llm/package.json` and the workspace entry in the lockfile. The release guard also requires the tagged commit to match the checkout, belong to `origin/main`, and have clean tracked source. Private packages and unexpected repository/registry settings are rejected.

Publish dependencies first: core; protocol-system-one and transport-fetch; adapters and composition packages. A package release verifies that every local dependency in its closure is already on npm with the exact version and SHA-512 integrity tested by that run. It never publishes dependencies automatically. If an unchanged dependency's bytes differ from its published artifact, resolve the build/source mismatch or release a new dependency version before proceeding.

The workflow publishes the selected tarball with provenance, verifies npm's SHA-512 integrity, then creates a GitHub Release with the tarball and `SHA256SUMS`. Stable releases use `latest`; prereleases use `next`. Release runs are serialized. Publish versions in ascending order for each package.

## Resume a failed release

Fix the external configuration and rerun the failed workflow, or dispatch the existing tag:

```sh
gh workflow run release.yml --repo ziyu/sytem-one-sdk --ref main -f tag=adapter-llm-v0.5.3
```

Tags are never created or moved by the workflow. An existing npm version is reused only when its integrity matches the tested tarball exactly; different contents require a new version. After publication, the script waits for public metadata for up to 61 attempts with five-second delays and bounded request time. It does not repeat `npm publish` during that wait. GitHub Release creation requires successful npm verification.

## Live verification

Run `npm run test:live:llm -- /path/to/llm.env` for an OpenAI-compatible LLM service, or the dedicated TypeSafe/OpenRouter/Cloudflare live commands with their credentials. These are separate from publication, consume actual usage, and keep credentials and generated reports out of npm and Git.
