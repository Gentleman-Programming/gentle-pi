# Spec — Test tool-dependency stubs (pi, gh, relay executable)

## Context

Several test files spawn external tools that are not guaranteed present: the opaque-adapter and relay tests spawn the real `pi` CLI; release fast-path tests depend on `gh` CLI behavior and error text; the relay test harness creates a stub `gentle-ai` file name without a Windows-executable extension, so `spawn(…, ENOENT)` on win32.

## Acceptance criteria

- AC1: Tests that spawn the real `pi` CLI either (a) use a provided stub or fixture binary, or (b) skip cleanly when no `PI_BIN`/explicit test override is set — they never fail as environment noise on a clean checkout, on any platform.
- AC2: The relay harness stub used by `tests/review-host-relay.test.ts` is created with a name Windows can exec (`gentle-ai.cmd`/`.exe` or invoked through an executor), eliminating `spawn … ENOENT` on win32 without changing POSIX behavior.
- AC3: Release fast-path tests either stub the `gh` interaction honestly (fake `gh` script on PATH inside the test env) or skip on environments without `gh`; caller-supplied CI evidence remains never trusted (existing contract preserved). Any remaining error-text assertions are normalized for platform differences.
- AC4: Skipped tests report as skipped (`t.skip` semantics), not as silent passes or failures; the suite distinguishes "skipped because tool absent" from "failed".

## Non-constraints

- No change to production launch paths (`lib/review-host-relay.ts` spawn behavior stays); the changes are confined to test fixtures and test selection.
- `gh`-dependent assertions that are genuinely cross-platform (e.g. exact-error contracts) are kept, normalized, or stubbed — not removed.