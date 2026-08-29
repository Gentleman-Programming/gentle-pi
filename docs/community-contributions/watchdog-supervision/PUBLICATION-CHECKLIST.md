# Publication checklist

Before publishing:

- [x] Include the exact current `src/phase-router.ts`.
- [x] Exclude private project source, raw logs, Engram data, backups and local runtime state.
- [x] Scan router source for private project names and absolute local paths.
- [x] Document failure modes, rationale and observed results.
- [ ] Compare the implementation with current Gentle-Pi `main`.
- [ ] Decide with the maintainer whether the work belongs in issues/discussions first or directly in PRs.
- [ ] Fork `Gentleman-Programming/gentle-pi` under the contributor GitHub account when ready to submit code.
- [ ] Split implementation into small commits/PRs instead of proposing the complete router at once.
- [ ] Preserve upstream MIT licensing and attribution where required.
