## Exploration: gentle-pi-identity-memory

### Current State
`packages/coding-agent` currently assembles a **generic Pi assistant** prompt by default in `src/core/system-prompt.ts` (`"You are an expert coding assistant operating inside pi..."`). Gentle Pi standards are only appended in one specific path: when `PI_GENTLE_PI_PHASE` is set and `gentlePi.standardsPrompt` exists (`src/core/agent-session.ts`). That means regular interactive Pi runs can miss the Gentle persona/identity contract entirely.

Tool/capability visibility is runtime-driven. The prompt’s “Available tools” section is derived from active tool definitions/snippets, while anything else is only described as possible custom tools. Core tools are `read|bash|edit|write|grep|find|ls` (`src/core/tools/index.ts`), and there is no first-class Engram memory tool/harness in coding-agent runtime today.

Resource loading already supports AGENTS/CLAUDE context files, custom system prompt, append prompt files, and skills (`src/core/resource-loader.ts`), but there is no dedicated Gentle Pi identity module (persona + self-description + memory capability detection) under `src/core/gentle-pi/` yet.

Existing Gentle Pi modules focus on SDD orchestration internals (phase/readiness, OpenSpec storage, security policy, model routing, standards) rather than runtime self-description/memory truthfulness (`src/core/gentle-pi/*`).

### Affected Areas
- `packages/coding-agent/src/core/system-prompt.ts` — default identity/persona text is generic and should become Gentle Pi-aware.
- `packages/coding-agent/src/core/agent-session.ts` — system prompt rebuild path and phase-standards gating seam; best hook for identity/memory capability injection.
- `packages/coding-agent/src/core/agent-session-services.ts` — service composition seam to inject a memory capability detector/service once per cwd runtime.
- `packages/coding-agent/src/core/resource-loader.ts` — context file and append prompt loading that can conflict/compose with new identity blocks.
- `packages/coding-agent/src/core/gentle-pi/types.ts` — likely extension point for typed identity/memory capability contract.
- `packages/coding-agent/src/core/gentle-pi/` (new module expected) — missing home for persona/self-description/memory protocol logic.
- `packages/coding-agent/test/system-prompt.test.ts` — current prompt tests are generic; needs Gentle Pi identity assertions.
- `packages/coding-agent/test/suite/harness.ts` + `test/suite/regressions/*` — existing faux-provider harness patterns for behavioral regressions (no false Engram claims, self-description correctness).
- `GENTLE_PI_HARNESSES.md` — architecture intent includes Engram/memory harnesses and Pi-specific direction; runtime behavior currently lags this contract.

### Approaches
1. **Prompt-only patch** — update default system prompt text and append static memory guidance.
   - Pros: Fast, low code churn.
   - Cons: Still brittle; cannot truthfully detect whether Engram bridge/tools are actually wired at runtime; risk of “prompt theater”.
   - Effort: Low.

2. **Typed identity + memory capability harness (recommended)** — add `gentle-pi` runtime service that computes identity profile + memory capability state, then injects structured blocks into system prompt and self-description behavior.
   - Pros: Truthful runtime behavior, testable seams, avoids false no-Engram/yes-Engram claims, keeps Pi-specific architecture explicit.
   - Cons: Moderate refactor across session/services/prompt assembly and new regression coverage.
   - Effort: Medium.

### Recommendation
Use **typed identity + memory capability harness**.

Reason: the reported failure mode (generic tone + incorrect “no Engram” claim) is a **runtime truth/assembly problem**, not just phrasing. Fixing it at service composition + prompt assembly seams preserves Pi-specific direction and allows deterministic tests.

### Risks
- Identity block can be overridden by user/system prompt files if precedence is unclear; precedence rules must be explicit.
- Capability detection can produce false negatives/positives if it only checks one source (e.g., env but not tool registry/bridge config).
- Overly rigid persona text can reduce answer adaptability if tests assert exact wording instead of principles.
- If memory protocol instructions mention unavailable operations, model may hallucinate support; gating by detected capability is required.

### Ready for Proposal
Yes — proposal should define:
1) typed `GentlePiIdentityMemory` service contract,
2) runtime capability detection strategy (tool presence + configured bridge signals),
3) prompt assembly precedence and fallback behavior,
4) regression suite for persona/self-description/memory truthfulness.
