// Standalone entry point spawned as a fresh Node process by
// tests/orchestrator-budget.test.ts's realistic-path-length budget test.
//
// extensions/gentle-ai.ts resolves ASSETS_DIR (from
// GENTLE_PI_TEST_ASSETS_DIR) at module-import time and memoizes
// getOrchestratorPrompt()'s return value in a module-level cache
// (first-read-wins for the process lifetime). Measuring the substituted
// return at a second, longer ASSETS_DIR therefore requires a genuinely
// separate process rather than a second dynamic import of the same module
// specifier in an already-imported test process.
//
// Reads GENTLE_PI_TEST_ASSETS_DIR from the environment (set by the caller),
// imports extensions/gentle-ai.ts fresh, and prints the rendered prompt's
// UTF-8 byte length to stdout.

import { join } from "node:path";

const { __testing } = await import(join(import.meta.dirname, "..", "..", "extensions", "gentle-ai.ts"));
const rendered = __testing.getOrchestratorPrompt();
process.stdout.write(String(Buffer.byteLength(rendered, "utf8")));
