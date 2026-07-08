# Design: Persona single channel

## Technical Approach

Make the **wrapper block** (`extensions/gentle-ai.ts` `buildGentlePrompt` :166-201) the single
canonical home for identity + persona + reply-language STYLE inside gentle-pi's always-on parent
injection. The wrapper and `orchestrator.md` are concatenated into ONE `systemPrompt` append per
parent session (`gentle-ai.ts:2204-2208`; empty for named/SDD agents, so both channels have
identical reach). We union the two duplicated copies into the wrapper, collapse
`orchestrator.md`'s duplicated wording to pointers, and lock the pre-change union with a
frozen-fixture `pnpm test` migration test written RED-first.

Static text, no runtime detection (matches proposal Approach). The self-contained
`__testing.buildGentlePrompt(persona)` export (used by `tests/persona-neutral-voseo.test.ts`) is
the test seam.

### Proposal correction (measured, load-bearing)

The proposal's "≈ −3.1 KB" assumes ALL of `orchestrator.md` Identity Contract (~0.9 KB) **and** the
FULL Language Boundary (~2.4 KB) are removable duplicates. Verified against source, that is false:

- **Identity** copies are two DIFFERENT paraphrases overall (wrapper :179-184 vs orchestrator :5-21),
  though the opening sentence (wrapper :177 / orchestrator :7) is byte-identical, not a paraphrase —
  see Table A. Union
  keeps the SUPERSET, so dedup saves little, not the full 0.9 KB.
- **Language Boundary** is mostly UNIQUE: only LB1 (`orchestrator.md:30`) duplicates the wrapper's
  persona/language rule. LB2-LB5 (`:32,:34,:36,:38-42` — subagent-English, artifact-English,
  public-comment language, exceptions) are delegation/artifact rules that exist NOWHERE else and
  MUST NOT be deleted (that is exactly the content-loss class the `persona-canonical-channel` judges
  caught 3×). They are relocated NOWHERE (same injection ⇒ zero token benefit from moving them) and
  stay in `orchestrator.md` as their proper home. True net ≈ **−0.3 to −0.5 KB**, frozen exactly by
  `wc -c` in the apply RED test. The real win is **single ownership + drift elimination**, not bulk
  tokens.

## Decision 1 — Canonical home = wrapper (not orchestrator.md)

**Choice.** Wrapper block is canonical for identity/persona/language-style.

| Option | Tradeoff | Verdict |
|---|---|---|
| **Wrapper canonical** | The dynamic `Current persona mode: ${persona}` line (:175) and the per-persona language selection (:169-172) are computed in TS and can ONLY live in the wrapper. `orchestrator.md:30` already POINTS back to that line. Identity/persona naturally anchor here. | **CHOSEN** |
| Orchestrator canonical | Static markdown cannot carry the runtime persona value, so the dynamic line stays in the wrapper anyway → split-brain persona channel, re-introducing the drift we remove. No reach advantage (both empty for named/SDD agents, :2204-2206). | Rejected |

## Decision 2 — Section disposition (union, nothing lost)

Rule: **duplicated identity + reply-language-style → wrapper (canonical); unique orchestrator
delegation/artifact rules → stay in `orchestrator.md`.**

### Table A — Identity reconciliation (which wording wins)

| Normative rule | Wrapper | orchestrator.md | Union verdict |
|---|---|---|---|
| "You are el Gentleman: …controlled development work." | :177 | :7 (identical) | KEEP once (wrapper) |
| "If the user asks who or what you are, answer as el Gentleman, not as a generic assistant." | :180 | :9 (fuller, translated paragraph) | **MERGE into self-description block** (subsumed by the richer translated paragraph, next row) |
| "Say you are a Pi-specific coding-agent harness with senior architect persona." | :181 | :9,:12 (fuller, translated paragraph) | **MERGE into self-description block** (subsumed by the richer translated paragraph, next row) |
| Self-description block ("I am el Gentleman: …not a generic chatbot"), "translated into the user's language" | :180-181 (terser; superseded) | :9,:12 | **ADD to wrapper** (richer; wrapper :180-181 above are subsumed) |
| Never introduce yourself as only "your assistant"/"default assistant" | — | :17 | **ADD to wrapper** (orchestrator-only) |
| Follow the currently selected persona mode (persona-mode selection only — language-match is a SEPARATE concept, owned solely by `GENTLEMAN_PERSONA_PROMPT`/`NEUTRAL_PERSONA_PROMPT`, see Table B and Decision 3) | — | :18 (trimmed: drop the "in the user's language" clause to avoid re-duplicating Table B's language-match concept) | KEEP (wrapper), trimmed |
| SDD/OpenSpec artifacts + subagents are core capabilities | :182 | :12 (in block) | KEEP once |
| Memory only when active — **+ "never invent persistent memory"** | :183 (+never-invent) | :19 (no never-invent) | **KEEP (wrapper)**: wrapper's :183 phrasing already carries the "never invent" clause; orchestrator's :19 phrasing is superseded, not merged |
| Do not claim portability outside Pi runtime | :184 | :20 (identical) | KEEP once |

Known residual (out of scope for this change): the Harness principles block (`gentle-ai.ts:198`, "Never claim persistent memory is available because of this package…") is a THIRD copy of the memory rule, distinct from the Identity contract's memory bullet above. It is not touched by this change; tracked as a follow-up cleanup, not a blocking finding.

### Table B — Language reconciliation

| Normative rule | Source | Union verdict |
|---|---|---|
| Per-persona Spanish variant (Rioplatense/voseo vs neutral) | wrapper :150,:158-160,:171-172 (dynamic) | KEEP (wrapper; runtime-selected) |
| "User-facing conversation stays in user's language, follow active persona mode" (LB1) | orchestrator :30 | **→ pointer** to wrapper (duplicated) |
| Explicit "match the user's current language in your reply" | NEUTRAL :158 has it (verified); GENTLEMAN lacks it (verified — `GENTLEMAN_PERSONA_PROMPT` has no language-match bullet) | **FOLD one clause into `GENTLEMAN_PERSONA_PROMPT`**, mirroring NEUTRAL :158, so dropping LB1 loses nothing for gentleman mode. This clause is the concept's SOLE owner per rendered mode: NEUTRAL's :158 line remains its single copy; no persona-independent wrapper line is added (that would re-duplicate against the trimmed Identity-contract bullet, Table A) |
| LB2 subagent-English delegation | orchestrator :32 | **KEEP in orchestrator** (unique) |
| LB3 artifacts-English | orchestrator :34 | **KEEP in orchestrator** (unique) |
| LB4 public-comment target language | orchestrator :36 | **KEEP in orchestrator** (unique) |
| LB5 exceptions (quotes/UI, Spanish-only-when-pasted, SDD artifact language) | orchestrator :38-42 | **KEEP in orchestrator** (unique) |

## Decision 3 — Single persona-constant source

**Choice.** Keep the two `*_PERSONA_PROMPT` constants (:148-164) as the ONLY persona text source
feeding `${personaPrompt}`; factor the 4 shared bullets (5 after the JD-001 fix adds the byte-identical language-match clause to both persona constants — reconcile SHARED_PERSONA_BULLETS scope accordingly if adopted) (senior architect, AI-as-tool, push-back,
correct-errors — identical at :151-154 and :161-164) into one `SHARED_PERSONA_BULLETS` base, leaving
each persona only its language-specific bullets. Kills intra-constant drift.
**Alternative rejected:** leave both constants fully duplicated — simpler diff but preserves the
4-bullet duplication the change exists to remove. Frozen-fixture test asserts the composed output
equals the pre-change constant union byte-for-byte on the shared bullets.

## Exact post-change text

### Wrapper Identity contract (replaces :179-184)

```
Identity contract:
- When the user asks who or what you are, answer as el Gentleman, not as a generic assistant, and never introduce yourself as only "your assistant" or "the default assistant". Convey this meaning, translated into the user's language: "I am el Gentleman: a Pi-specific coding-agent harness for controlled development, with a senior architect persona. I work with SDD/OpenSpec when the task justifies it, coordinate subagents, use phase artifacts, run commands, and edit files. I am not a generic chatbot."
- Follow the currently selected persona mode.
- Mention SDD/OpenSpec phase artifacts and subagents as core capabilities.
- Mention memory only when memory packages or callable memory tools are actually active; never invent persistent memory.
- Do not claim portability outside the Pi runtime.
```

Note: the Identity contract bullet above deliberately drops the "in the user's language" clause that
:18 originally carried (Table A). Language-matching is a SEPARATE concept, owned solely by the
persona prompts (below), so it appears exactly once per rendered mode instead of being restated
here too. Scoped exception, deliberately distinct: Identity-contract bullet 1's "translated into
the user's language" (merged from orchestrator.md:9) is a self-description conveyance directive,
not a general reply-language rule; the concept-level guard intentionally does not count it, and
this sentence documents that boundary explicitly (round-2 judge finding).

### `GENTLEMAN_PERSONA_PROMPT` (add one clause, mirrors `NEUTRAL_PERSONA_PROMPT` :158)

No line is added after `${languageBoundary}`. Instead, `GENTLEMAN_PERSONA_PROMPT` (:148-154) gains the
one clause `NEUTRAL_PERSONA_PROMPT` already has at :158, so both persona prompts carry their own
single, unambiguous language-match rule and the wrapper's Identity contract does not restate it:
```
- Always respond in the same language the user writes in.
```
`NEUTRAL_PERSONA_PROMPT`'s existing :158 line is unchanged and remains its own single copy.

### orchestrator.md `## Identity Contract` (replaces :5-21)

Terse (one line — the diet counts every core byte):
```
## Identity Contract

Defined once in the identity/harness section injected above (the `Current persona mode:` line). Honor it; do not restate here.
```

### orchestrator.md `## Language Boundary` (replaces :28-42)

LB1 (:30) collapses to the one-line pointer below; **LB2-LB5 (:32,:34,:36,:38-42) are kept VERBATIM** (unique delegation/artifact rules — the diet may later relocate them to a lazy file, see Sequencing):
```
## Language Boundary

Reply-language style and the active persona's Spanish variant are defined once in the identity/harness section above (its `Current persona mode:` line). The rules below are delegation/artifact-scoped and not restated there:

<LB2 :32 verbatim> <LB3 :34 verbatim> <LB4 :36 verbatim> <Exceptions :38-42 verbatim>
```

## Data Flow

    readPersonaMode(cwd) ─→ buildGentlePrompt(persona) ─────────────┐
       (persona.json)          │ wrapper: identity+persona+lang line │
                               │ + SHARED_PERSONA_BULLETS            │
                               ▼                                     ▼
                     getOrchestratorPrompt() ── orchestrator.md ── systemPrompt append
                     (Identity→pointer, LB1→pointer, LB2-5 kept)   (:2208, parent only)

## Byte estimates (judge-verified where noted; authoritative `wc -c` lands in the apply RED test)

Judgment-day (Round 1, both judges) re-measured the sandbox's Bash-less estimates against the real
files and found several cells materially wrong. The table below uses the judges' measured figures;
cells not independently re-measured are marked "estimate".

| Region | Before | After | Δ | Source |
|---|---|---|---|---|
| Language Boundary LB1 only (`orchestrator.md` :30, the duplicated pointer target) | 262 B | → folded into the LB pointer line | (included in orchestrator.md total delta) | judge-measured |
| Language Boundary total (`orchestrator.md` :28-42) | 2,117 B | LB1 (262 B) collapses to pointer; LB2-5 (unique) unchanged | not separately re-measured post-change | judge-measured (before) |
| Identity Contract (`orchestrator.md` :5-21) | 831 B | 148 B (one-line pointer) | −682 B | judge-measured |
| wrapper Identity contract block (`gentle-ai.ts` :179-184, pre-change) | 438 B | 817 B (post-change; measured from the exact block quoted in this document — both round-2 judges and the orchestrator converged on 817 B) | ≈ +379 B (817 − 438; the GENTLEMAN_PERSONA_PROMPT clause is a separate ~60 B line item, not part of this block) (includes the JD-001 correction) | judge-measured |
| `orchestrator.md` (Identity + Language Boundary dispositions combined) | 22,626 B | — | ≈ −720 B | judge-measured estimate |
| **Net injection / parent session (gentleman)** | — | — | **≈ −0.28 KB (measured: −283 B gentleman / −341 B neutral)** | judge-measured estimate, pending the apply RED test's authoritative `wc -c` |
| gentle-ai `APPEND_SYSTEM.md` | 37,276 B | unchanged | 0 | gentle-ai follow-up, out of scope |

## File Changes

| File | Action | Description |
|---|---|---|
| `extensions/gentle-ai.ts` | Modify | Union identity into wrapper (:179-184), trimming the "in the user's language" clause from the persona-mode bullet; fold one language-match clause into `GENTLEMAN_PERSONA_PROMPT` (mirrors `NEUTRAL_PERSONA_PROMPT` :158); factor `SHARED_PERSONA_BULLETS` (:148-164); keep "never invent memory" (wrapper phrasing) |
| `assets/orchestrator.md` | Modify | Identity Contract (:5-21) → pointer; Language Boundary LB1 (:30) → pointer; LB2-LB5 kept verbatim |
| `tests/persona-single-channel.test.ts` | Create | Frozen-fixture line-level union + duplication guard + byte-delta (`wc -c`) |
| `openspec/changes/persona-single-channel/cross-tool-persona-ownership-contract.md` | Create | gentle-pi owns Pi-session persona; gentle-ai follow-up expectation |

## Cross-tool ownership contract (required outline)

Path: `openspec/changes/persona-single-channel/cross-tool-persona-ownership-contract.md`
(pattern: gentle-ai `engram-protocol-dedup/upstream-protocol-flag-contract.md`).

1. **Title/intent** — Pi-session persona ownership handoff (gentle-pi ↔ gentle-ai Pi adapter);
   slimming `APPEND_SYSTEM.md` is out of scope here, a gentle-ai follow-up.
2. **Guarantee 1 — gentle-pi is canonical**: the always-on injection (wrapper + `orchestrator.md`)
   is the SINGLE source of Pi-parent identity/persona/language.
3. **Guarantee 2 — upstream MUST slim to a residual/pointer**: gentle-ai's Pi adapter
   `<!-- gentle-ai:persona -->` section (37,276 B) must reduce to an action/tooling residual that
   does NOT restate identity/persona/language tone (mirrors `persona-canonical-channel` residual).
4. **Guarantee 3 — marker idempotency**: section is marker-delimited; slim must converge on
   re-inject without orphaning (gentle-ai `InjectMarkdownSection` full-replace).
5. **Drift control** — doc referenced from both repos' proposals; gentle-pi wording wins on conflict.
6. **Cross-reference** — proposal Dependencies, this design, gentle-ai follow-up change id (TBD).

## Testing Strategy (strict TDD, `pnpm test` → `node --experimental-strip-types --test tests/*.test.ts`,
which also runs `pnpm run test:harness` — `tests/runtime-harness.mjs` — as its second step, see
`package.json:38`)

| Layer | What | Approach |
|---|---|---|
| Unit RED | `tests/persona-single-channel.test.ts`: freeze `PRE_WRAPPER_{GENTLEMAN,NEUTRAL}`, `PRE_ORCH_IDENTITY` (:5-21), `PRE_ORCH_LANGBOUNDARY` (:28-42) VERBATIM from HEAD as string literals; post-change side is the LIVE combined output `buildGentlePrompt(persona)`, which calls `getOrchestratorPrompt()`. That function resolves `assets/orchestrator.md` via `PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))` (`gentle-ai.ts:51-52`) — NOT `process.cwd()` — and memoizes the read in a module-level cache (`orchestratorPromptCache`, `gentle-ai.ts:125-134`): first read wins for the lifetime of the process. Tests that mutate `assets/orchestrator.md` on disk mid-process will NOT see the change on a second call; reset the cache (or spawn a fresh process) between mutation-based fixtures | HEAD-frozen fixtures vs live read (seam: `__testing.buildGentlePrompt`, `tests/persona-neutral-voseo.test.ts`) |
| Unit RED | **Line-level union sweep** (not section-level — precedent caught 3 losses this way): split each frozen fixture into lines, filter to normative lines, assert each survives in `buildGentlePrompt(persona)` output either verbatim OR via a documented `MERGED`/`POINTER` disposition map. Each assertion carries its OWN message naming the exact rule + source line → **per-rule loud failure**. Includes NAMED assertions for wrapper :180 and :181 (each merges into the self-description block, Table A) | table-driven, one assert per rule |
| Unit RED | **Duplication guard (exact-string)**: assert the identity self-description sentence, "Do not claim portability…", and each LB2-LB5 rule each appear EXACTLY once (`occurrences === 1`) in the combined injection (wrapper + `getOrchestratorPrompt()`) | count-based |
| Unit RED | **Duplication guard (concept-level, closes JD-001's paraphrase gap)**: a language-match REGEX (matching phrasings like `match(es)? .* language`, `respond .* same language`, `in the user'?s language`) MUST match EXACTLY ONCE in each fully-rendered mode (gentleman, neutral) — catches paraphrases that an exact-string guard misses | regex count per rendered mode |
| Unit RED | **Added-rule assertion**: gentleman-mode output now contains the language-match clause added to `GENTLEMAN_PERSONA_PROMPT` (mirrors NEUTRAL :158, e.g. "Always respond in the same language the user writes in.") — fails pre-change | regex on gentleman prompt |
| Unit RED | **Byte delta**: `Buffer.byteLength(post) < Buffer.byteLength(pre)`; freeze exact pre/post `wc -c` byte counts per persona and assert the delta within ±1 B | byte assert (the exact `wc -c` lands here, authoritative over the estimates in Measured bytes below) |
| Regression | Preserve `tests/persona-neutral-voseo.test.ts` green (neutral has no positive voseo directive); `SHARED_PERSONA_BULLETS` refactor must not leak voseo into neutral | run existing suite |
| Unit GREEN | After reconciliation: full sweep + guards + byte delta pass | `pnpm test` |

## Sequencing contract (vs `orchestrator-lazy-diet`)

This change lands **FIRST** — it owns CONTENT; the diet owns PLACEMENT (the diet's just-completed
design plans a core summary + three lazy files and repoints `tests/gentle-ai.test.ts:40`).

**Content-final regions** the diet MUST treat as frozen wording (may relocate, must not re-edit text
or re-duplicate the wrapper's identity/persona/language content):

- `## Identity Contract` (:5-21) → one-line pointer (final).
- `## Language Boundary` (:28-42) → LB1 one-line pointer + LB2-LB5 verbatim (final).

**Budget benefit (the real ~1 KB the diet needs) — derivation.** The dedup does NOT come from a
large raw `orchestrator.md` file shrink (that net is only ≈ −0.28 KB (measured: −283 B gentleman / −341 B neutral) gentleman, see Byte estimates
above). It comes from making the wrapper canonical, so the diet's core summary can point at it
instead of paraphrasing identity/language content in-core. Without this change, the diet's own
design (`orchestrator-lazy-diet/design.md:16`) budgets a ~350 B in-core summary for Language
Boundary alone, plus a comparable in-core summary it would otherwise need for Identity Contract
(pre-dedup Identity is 830 B, too large to inline — it would need its own ~300-400 B core
paraphrase). With this change already collapsing Identity Contract to a 148 B pointer and removing
LB1's 262 B duplicate, the diet's core only needs a single existing pointer, not a fresh in-core
paraphrase for either section:

- Avoided Identity in-core paraphrase: ≈ 300-400 B
- Avoided Language Boundary in-core paraphrase (diet's own estimate): ≈ 350 B
- LB1 duplicate removed from what the diet would otherwise have condensed: 262 B
- Total avoided core-budget pressure: ≈ 900 B-1.0 KB

— consistent with, and reconciling against, the diet design's own "freeing ~1 KB"
(`orchestrator-lazy-diet/design.md:46`) estimate. LB2-5 (~1.9 KB of delegation/artifact reference
rules) become **lazy-file candidates**, not core, which is the diet's placement call.

**Reconciling the :28-42 / :28-43 range and the 2,117 B figure with the diet's numbers.** This
design measures `orchestrator.md`'s Language Boundary as lines :28-42 = **2,117 B** (judge-verified,
excludes the trailing blank line before `## Mental Model`). The diet's design
(`orchestrator-lazy-diet/design.md:16`) uses the range **:28-43** (includes that one trailing blank
line) and estimates **2,350 B**. Re-measured: :28-43 = 2,118 B — only 1 B more than :28-42 (the
trailing newline), NOT 2,350 B. The diet's 2,350 B is an unverified estimate (≈ 11% high, made
without Bash access per its own design constraints), not a second independent measurement; the two
designs' line ranges are otherwise consistent (off by exactly the trailing blank line). The diet
should adopt this design's judge-verified 2,117 B (or 2,118 B for :28-43) once it applies against
this change's frozen wording.

**Terseness.** Both pointers are one line each because the diet counts every core byte; keep them
that way through apply. Do not expand the pointers back into restated rules.

## Migration / Rollout

File-level, no data migration. Single-repo revert of the `gentle-ai.ts` + `orchestrator.md` + test +
contract-doc commits re-baselines. `pnpm test` re-runs.

## Open Questions

- [ ] Confirm the contract doc lives in the change folder (chosen) vs `docs/`.
- [ ] Confirm `SHARED_PERSONA_BULLETS` refactor is in scope now vs a follow-up (affects diff size only; union guarantee holds either way).
- [x] Spec interpretation resolved (JD-003): `specs/session-persona/spec.md:11` is amended to state
  the Language Boundary's duplicated portion (LB1) MUST reduce to a single-line pointer, while the
  unique rules (LB2-LB5) are retained verbatim; the Identity Contract MUST still reduce to a pointer
  (unchanged). The spec's scenarios and acceptance criteria are amended to match. Spec and design
  now agree; no open contradiction remains.
