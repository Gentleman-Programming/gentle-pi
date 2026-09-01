# How this should be published on GitHub

GitHub is not normally used like FTP and a repository is not uploaded as one ZIP archive.

A Git repository stores the **directory structure and individual files**, plus the history of changes (commits).

For this contribution there are two reasonable stages:

## 1. Publish the documentation/reference package

Create a repository in your GitHub account and commit this directory tree. GitHub will display `README.md` automatically on the repository front page.

## 2. Contribute code upstream

For actual Gentle-Pi code contributions, the normal open-source workflow is:

1. Fork `Gentleman-Programming/gentle-pi` into your GitHub account.
2. Clone your fork locally.
3. Create a branch for one bounded contribution.
4. Apply only that contribution.
5. Commit it.
6. Push the branch to your fork.
7. Open a Pull Request against the original Gentle-Pi repository.

The large reference `phase-router.ts` in this package is useful to explain and recover the implementation, but the maintainer should not have to review the entire file as one PR.
