# Spec — Orchestrator prompt-budget guard restorable on Windows

## Context

`tests/orchestrator-budget.test.ts` measures the always-on orchestrator prompt size by dynamically importing a fixture (`tests/fixtures/measure-orchestrator-prompt.mjs`) with a Windows absolute path. Node 24 rejects that with `ERR_UNSUPPORTED_ESM_URL_SCHEME` (protocol `c:`), so the 8,192 B budget guard cannot run on Windows.

## Acceptance criteria

- AC1: The measurement entry is invoked via `pathToFileURL(...).href` (or an equivalent file:// ESM specifier) instead of a bare absolute path; the `getOrchestratorPrompt … 8,192 B` and long-assets-root budget tests pass on Windows.
- AC2: The fixture itself is unchanged in contract (byte measurement, exit 0 on success); only the invocation changes.
- AC3: `pnpm test` on Linux keeps passing the same budget assertions.

## Non-constraints

- Prompt content itself is out of scope (a separate diet concern); only the guard's executability.