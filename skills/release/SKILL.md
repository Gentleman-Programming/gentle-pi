---
name: release
description: "Release gentle-pi through GitHub and npm. Trigger: release, publish, npm publish, GitHub release, version bump."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.2"
---

## When to Use

Use this skill when preparing, publishing, or verifying a `gentle-pi` release.

## Hard Rules

- Do not publish `gentle-pi` to npm from a local machine.
- npm publishing MUST go through the GitHub Actions workflow `.github/workflows/publish.yml` so provenance, environment protection, and registry credentials are controlled by GitHub.
- Dispatch the trusted workflow definition from protected default `main`, never from a release tag. Its only caller input is the exact annotated version tag.
- Use a clean worktree for release commits. Do not package unrelated local files or scratch artifacts.
- Validate the approved receipt against the exact immutable release target with zero review actors before publication.
- Release from protected `main` may bypass receipt validation only when the tag targets the current immutable `origin/main` SHA, required CI for that exact SHA is successful, the remote head is rechecked before tag push, and no fresh risk evidence exists; otherwise fail closed through native receipt validation. Never infer the tag target from local `HEAD`. Major and post-incident releases require explicit extraordinary review even when fast-path checks pass.
- Never skip package verification. The publish workflow runs verification again, but local validation should still pass before tagging.

## Release Procedure

1. **Inspect state**

   ```bash
   git status --short
   git fetch origin main --tags
   git log --oneline --decorate --max-count=5 origin/main
   ```

2. **Prepare the release commit**

   - Apply only intended changes.
   - Bump `package.json` to the next semver version.
   - Keep lockfile changes out unless dependency resolution actually changed.

3. **Verify locally**

   ```bash
   pnpm test
   node scripts/verify-package-files.mjs
   npm pack --dry-run
   ```

   `npm pack --dry-run` verifies package contents and lifecycle scripts without entering a publish path.

4. **Commit and push**

   ```bash
   git add <intended-files>
   git commit -m "<type(scope): release-ready change>"
   git push origin HEAD:main
   git fetch origin main --tags
   ```

5. **Create and verify the exact version tag**

   ```bash
   version="$(node -p "require('./package.json').version")"
   tag="v${version}"
   release_sha="$(git rev-parse 'origin/main^{commit}')"

   test "$(git rev-parse 'HEAD^{commit}')" = "${release_sha}"
   test -z "$(git ls-remote --tags origin "refs/tags/${tag}")"

   git tag -a "${tag}" "${release_sha}" -m "gentle-pi ${tag}"
   test "$(git rev-parse "${tag}^{commit}")" = "${release_sha}"

   git fetch origin main
   test "$(git rev-parse 'origin/main^{commit}')" = "${release_sha}"
   git push origin "refs/tags/${tag}"

   git fetch --no-tags origin "refs/tags/${tag}"
   test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "${release_sha}"

   gh release create "${tag}" \
     --repo Gentleman-Programming/gentle-pi \
     --verify-tag \
     --title "gentle-pi ${tag}" \
     --notes "<release notes>"
   ```

   Do not retag or overwrite an existing version. The tag target comes from the freshly fetched immutable `origin/main` commit, not an ambient local branch.

6. **Publish npm through GitHub Actions**

   ```bash
   version="$(node -p "require('./package.json').version")"
   tag="v${version}"
   gh workflow run publish.yml \
     --repo Gentleman-Programming/gentle-pi \
     --ref main \
     -f tag="${tag}"
   ```

   The workflow definition always comes from protected default `main`. It accepts only one exact `vSemVer` tag, fetches the remote annotated tag and current remote `main`, and requires the peeled tag commit, dispatch/main workflow commit, checkout, and `package.json` version to match. It re-queries remote tag and `main` immediately before npm publication, derives the dist-tag internally, and uses trusted OIDC with provenance.

   Watch the run and fail the release if it fails:

   ```bash
   gh run list --repo Gentleman-Programming/gentle-pi --workflow publish.yml --limit 3
   gh run watch <run-id> --repo Gentleman-Programming/gentle-pi --exit-status
   ```

7. **Verify npm**

   ```bash
   npm view gentle-pi@<version> version --registry=https://registry.npmjs.org/
   npm dist-tag ls gentle-pi --registry=https://registry.npmjs.org/
   ```

## Failure Handling

- A publication failure never reopens the closed review lineage. Diagnose and retry publication separately without resetting review counters.
- Never attempt or retry `npm publish` locally. Re-dispatch from trusted `main` only when the same tag still targets the current remote `main` and the failure was publication-only.
- If remote `main` advances, do not move or recreate the existing tag. Prepare a new release commit/version and create a new annotated version tag.
- If the workflow fails, inspect logs with:

  ```bash
  gh run view <run-id> --repo Gentleman-Programming/gentle-pi --log
  ```

- If npm verification is briefly stale after a successful workflow, check the exact version first (`npm view gentle-pi@<version> version`) before assuming publish failed.

## Output Contract

Report:

- Commit SHA pushed to `main`.
- Exact version tag and its peeled commit SHA.
- GitHub release URL.
- Publish workflow run URL and conclusion.
- npm exact version and the workflow-derived dist-tag (`latest`, `beta`, or `next`).
- Any remaining follow-up or warnings.
