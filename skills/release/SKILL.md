---
name: release
description: "Release gentle-pi through GitHub and npm. Trigger: release, publish, npm publish, GitHub release, version bump."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

Use this skill when preparing, publishing, or verifying a `gentle-pi` release.

## Hard Rules

- Do not publish `gentle-pi` to npm from a local machine.
- npm publishing MUST go through the GitHub Actions workflow `.github/workflows/publish.yml` so provenance, environment protection, and registry credentials are controlled by GitHub.
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
   pnpm publish --dry-run --no-git-checks
   ```

   The dry run is allowed because it does not publish. It verifies package contents and lifecycle scripts.

4. **Commit and push**

   ```bash
   git add <intended-files>
   git commit -m "<type(scope): release-ready change>"
   git push origin HEAD:main
   ```

5. **Create the GitHub release**

   ```bash
   git tag -a v<version> -m "gentle-pi v<version>"
   git push origin v<version>
   gh release create v<version> \
     --repo Gentleman-Programming/gentle-pi \
     --title "gentle-pi v<version>" \
     --notes "<release notes>"
   ```

6. **Publish npm through GitHub Actions**

   ```bash
   gh workflow run publish.yml \
     --repo Gentleman-Programming/gentle-pi \
     --ref main \
     -f dist-tag=latest
   ```

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
- If a local `npm publish` fails, do not retry locally. Use the GitHub workflow instead.
- If the workflow fails, inspect logs with:

  ```bash
  gh run view <run-id> --repo Gentleman-Programming/gentle-pi --log
  ```

- If npm verification is briefly stale after a successful workflow, check the exact version first (`npm view gentle-pi@<version> version`) before assuming publish failed.

## Output Contract

Report:

- Commit SHA pushed to `main`.
- GitHub release URL.
- Publish workflow run URL and conclusion.
- npm exact version and `latest` dist-tag.
- Any remaining follow-up or warnings.
