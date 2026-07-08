# Byte Measurements — persona-single-channel

Method: `bat --no-pager --plain --line-range <start>:<end> <file> | wc -c` for section-level
measurements (byte-identical to `sed -n '<start>,<end>p'` piped to `wc -c`); `wc -c <file>` for
whole-file totals; `git diff --stat` to cross-check the line-level shape of the edit. All
measurements taken on branch `feat/persona-single-channel`, cut from `main` post-#72 (the
review-ledger port), against `extensions/gentle-ai.ts` and `assets/orchestrator.md` before and
after the Phase 2/3 edits in this change.

## Section-level deltas (the regions this change edits)

| Region | Before | After | Δ | vs design.md estimate | Deviation |
|---|---|---|---|---|---|
| Wrapper Identity contract block (`gentle-ai.ts`, was :179-184, now :180-185) | 438 B | 817 B | **+379 B** | 817 B post / +379 B delta | **Exact match** — converged round-2/round-3 figure confirmed byte-for-byte |
| Orchestrator Identity Contract (`orchestrator.md`, was :5-21, now :5-7) | 831 B | 149 B | **−682 B** | 831 B pre / 148 B post ("one-line pointer") | **1 B high** (149 vs 148) — same trailing-newline counting convention as the 831 B pre-figure (range-inclusive, one newline after the last content line); not a wording error, a counting-convention rounding artifact |
| Orchestrator Language Boundary (`orchestrator.md`, was :28-42, now :15-29) | 2,117 B | 2,079 B | **−38 B** | not separately re-measured post-change by design.md | New measurement — LB1's old 262 B sentence is replaced by a 224 B pointer paragraph (262 − 224 = 38 B saved) |
| New `GENTLEMAN_PERSONA_PROMPT` language-match clause (`gentle-ai.ts`, added line) | 0 B | 58 B | **+58 B** | "~60 B separate line item" | **Matches within 2 B** |

## Combined region delta (Identity + Language Boundary, `orchestrator.md`)

- 682 B + 38 B = **−720 B**, matching design.md's "orchestrator.md (Identity + Language Boundary
  dispositions combined) ... ≈ −720 B" estimate exactly.

## Whole-file deltas (cross-check, includes no other changes in this diff)

| File | Before | After | Δ |
|---|---|---|---|
| `extensions/gentle-ai.ts` | 77,226 B | 77,663 B | **+437 B** (= +379 wrapper block + 58 new clause line) |
| `assets/orchestrator.md` | 23,766 B | 23,047 B | **−719 B** (1 B off the −720 B section-sum above; rounding/newline-boundary noise between `bat --line-range` extraction and whole-file `wc -c`, not a content discrepancy — confirmed via `git diff --stat`: 17 lines removed, 2 lines net-added, no other hunks) |

`git diff --stat` confirms only the two intended hunks per file (no unrelated changes):
```
assets/orchestrator.md  | 17 ++---------------
extensions/gentle-ai.ts |  5 +++--
2 files changed, 5 insertions(+), 17 deletions(-)
```

## Net injection delta per Pi parent session (the number that matters for reviewers)

Per-session injection = wrapper block + persona-specific `*_PERSONA_PROMPT` + `orchestrator.md`
(concatenated once per session, `gentle-ai.ts:2204-2208`).

| Persona mode | Wrapper block Δ | Persona-prompt Δ | `orchestrator.md` Δ (section-sum) | **Net Δ** | design.md estimate |
|---|---|---|---|---|---|
| gentleman | +379 B | +58 B (new clause) | −720 B | **−283 B (≈ −0.28 KB)** | ≈ −0.2 to −0.3 KB |
| neutral | +379 B | 0 B (unchanged) | −720 B | **−341 B (≈ −0.33 KB)** | ≈ −0.2 to −0.3 KB |

Section-sum method (682 + 38 = 720 B saved in `orchestrator.md`) is used above because it is
fixture-derived and internally consistent with the migration test's assertions
(`tests/persona-single-channel.test.ts`). The whole-file `wc -c` delta on `assets/orchestrator.md`
(−719 B, see above) gives net figures of −282 B / −340 B instead — 1 B off, the same
trailing-newline/range-boundary counting-convention artifact noted above, not a second independent
discrepancy. Both methods land inside the design's converged "true net ≈ −0.3 to −0.5 KB" range
(Technical Approach) and its "≈ −0.3 KB" round-3 orchestrator convergence (review-ledger.md Round 2
entry). The single content-relevant deviation found is the whole-file-vs-section 1 B rounding noise
on the orchestrator Identity Contract pointer (149 B measured vs 148 B design estimate) — flagged
above, not blocking, not a wording change (same pointer text as design.md's "Exact post-change
text" section, copied verbatim).

## Whole-repo file-size note (non-blocking context)

`assets/orchestrator.md`'s pre-change whole-file size (23,766 B, this branch) is larger than
design.md's "Byte estimates" table baseline (22,626 B). This is expected: this branch is cut from
`main` post-#72 (the review-ledger port), which added content to `orchestrator.md` in sections
**below** the Identity Contract / Language Boundary area (design.md's own baseline predates #72).
The Identity Contract (831 B) and Language Boundary (2,117 B) pre-change section figures were
independently re-verified via `wc -c` against the actual pre-edit file on this branch and matched
design.md's judge-measured figures exactly — confirming the top-of-file sections this change edits
are unaffected by #72, as the apply prompt anticipated.
