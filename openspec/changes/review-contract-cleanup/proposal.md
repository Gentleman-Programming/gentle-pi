# Proposal: review-contract-cleanup

## Problem

An external cross-runtime review (user's Pi/OpenCode session, GPT-5.5,
2026-07-09) of main `HEAD~2..HEAD` (#72, #74), run with the shipped
review-ledger contract itself, surfaced 5 findings recorded in
`review-ledger.md`:

- **EXT-001**: the 4 review-*.md agents' own Output contract line ("If clean,
  say exactly: `No findings.`") contradicted the ledger contract's "persist an
  empty ledger record" rule in the same files — the chain wording was fixed
  under JD-004, but the agents' own Output contract sentence was never
  tracked in any ledger.
- **EXT-002**: `scripts/verify-package-files.mjs` did not require
  `skills/_shared/review-ledger-contract.md`, so a published package could
  omit the canonical contract source and the verifier would still pass.
- **EXT-003**: the review-* agents' "read-only reviewer" framing plus
  write-style persistence bullets ("write `openspec/changes/...`", "upsert
  topic ...") read like direct write instructions to the agent, even though
  the execution-mode clause (at the end of the file) assigns persistence to
  the orchestrator.
- **EXT-004**: the `engram` persistence branch had no degraded path — if the
  engram upsert fails or the tool is unavailable, the ledger (the recovery
  artifact for the fix/re-review loop) could be silently lost.
- **EXT-005**: `tests/persona-single-channel.test.ts` repeated byte literals
  (438/831/2117/817, deltas 379/682/-283/-341) across multiple assertions
  instead of naming them once.

## Solution

- EXT-001: replaced the Output contract sentence in all 4 review-*.md agents
  with wording aligned to the ledger contract (return an empty ledger record,
  never skip it). No test asserted the old sentence outside the already-fixed
  chain file, so no RED/GREEN cycle was required for this fix.
- EXT-002: added `skills/_shared/review-ledger-contract.md` to
  `requiredPaths` in `scripts/verify-package-files.mjs` (verifier now reports
  45 files).
- EXT-003: added one ownership line directly before the
  `**Ledger persistence honors the artifact store.**` block in all 4
  review-*.md and jd-judge-a/b.md, outside the canonical hand-copied clause
  so the existing drift-guard test keeps asserting the clause verbatim.
- EXT-004 (canonical clause change): extended the canonical `engram:` bullet
  in `skills/_shared/review-ledger-contract.md` with a fallback sentence, then
  hand-copied the extended bullet into every adopting surface that carries
  the persistence block (the 4 review-*.md, jd-judge-a/b.md,
  `skills/judgment-day/SKILL.md`, the Judge Prompt fence in
  `references/prompts-and-formats.md`, and `assets/orchestrator-delegation.md`).
  `assets/orchestrator.md` core only carries a summarized (non-verbatim)
  engram bullet, so per the delegate's budget guard it was left untouched;
  `tests/orchestrator-budget.test.ts` stayed green (36/36) confirming this.
  The clause was added to `tests/review-ledger-contract.test.ts`
  (`ledgerPersistenceClauses`) first, confirmed RED (10 failing), then the
  assets were updated to GREEN (27/27).
- EXT-005: extracted the repeated byte literals in
  `tests/persona-single-channel.test.ts` into a grouped, commented block of
  named constants (`PRE_WRAPPER_BYTES`, `POST_WRAPPER_BYTES`,
  `WRAPPER_IDENTITY_DELTA_BYTES`, `PRE_ORCH_IDENTITY_BYTES`,
  `ORCH_IDENTITY_DELTA_BYTES`, `PRE_ORCH_LANGBOUNDARY_BYTES`,
  `GENTLEMAN_NET_DELTA_BYTES`, `NEUTRAL_NET_DELTA_BYTES`); pure refactor, the
  frozen PRE_*/POST_* fixtures and assertion outcomes are unchanged (28/28
  green).

## Source

External cross-runtime review, user's Pi/OpenCode session, GPT-5.5,
2026-07-09, run with the shipped review-ledger contract against main
`HEAD~2..HEAD` (#72, #74). See `review-ledger.md` for the full finding table.
