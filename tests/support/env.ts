// tests/support/env.ts
//
// Git environment isolation for the test suite.
//
// Problem: sandbox repos created by tests inherit whatever git configuration
// exists in the ambient environment. On developer machines this typically
// includes:
//   - user-global `core.autocrlf=true` (CRLF warnings pollute stderr that
//     tests parse strictly),
//   - agent-harness exports such as `GIT_CONFIG_COUNT=2` +
//     `GIT_CONFIG_KEY_0=credential.interactive` + `GIT_CONFIG_VALUE_0=false`,
//     which the production review authority treats as unsafe (fail-closed).
//
// The production code already isolates itself inside `reviewGitEnvironment()`
// (lib/review-repository.ts). These helpers provide the same isolation for the
// test harness's own git spawns, and scrub the ambient env at import time for
// test files that exercise production authority paths.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Keys the production review authority treats as unsafe to inherit. */
const UNSAFE_GIT_KEYS = new Set([
	"GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_QUARANTINE_PATH", "GIT_PREFIX",
	"GIT_SUPER_PREFIX", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM",
	"GIT_CONFIG", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM",
	"GIT_CONFIG_COUNT", "GIT_REPLACE_REF_BASE", "GIT_NO_REPLACE_OBJECTS", "GIT_SHALLOW_FILE",
	"GIT_GRAFT_FILE", "GIT_EXEC_PATH", "GIT_TEMPLATE_DIR", "GIT_CONFIG_PARAMETERS",
	"GIT_SSH", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT", "GIT_PROXY_COMMAND",
]);

export function isUnsafeGitEnvironmentKey(key: string): boolean {
	const normalized = key.toUpperCase();
	return UNSAFE_GIT_KEYS.has(normalized) || /^GIT_CONFIG_(?:KEY|VALUE)_/.test(normalized);
}

/**
 * Remove inherited unsafe git environment keys from a target env (defaults to
 * the current process env). Returns the removed key names.
 *
 * Use at the top of test files that exercise production review-authority code
 * (`lib/review-repository.ts` and friends): the guard reads `process.env` at
 * call time and fails closed on any of these keys. node:test isolates each
 * file in its own process, so mutating `process.env` here is file-scoped and
 * cannot contaminate sibling test files.
 */
export function scrubInheritedGitEnvironment(target: NodeJS.ProcessEnv = process.env): string[] {
	const removed: string[] = [];
	for (const key of Object.keys(target)) {
		if (isUnsafeGitEnvironmentKey(key)) {
			delete target[key];
			removed.push(key);
		}
	}
	return removed;
}

let emptyConfigPath: string | undefined;

/**
 * Path to a nonexistent/empty git config file used to neutralize inherited
 * global/system config (including `core.autocrlf` from the user's config).
 */
export function emptyGitConfigPath(): string {
	if (emptyConfigPath) return emptyConfigPath;
	const dir = mkdtempSync(join(tmpdir(), "gentle-pi-gitconfig-"));
	emptyConfigPath = join(dir, "empty.cfg");
	writeFileSync(emptyConfigPath, "");
	return emptyConfigPath;
}

/**
 * Build an isolated env for spawning git in sandbox repos: strips all
 * inherited GIT_* keys (including the ambient `GIT_CONFIG_COUNT`/scoped keys)
 * and points global/system config at empty files, so sandbox behavior is
 * deterministic regardless of the developer machine's git configuration.
 * It never inherits `core.autocrlf` state, which is what produced the
 * `LF will be replaced by CRLF` warnings in strictly-parsed stderr.
 */
export function sandboxGitEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...parent };
	for (const key of Object.keys(environment)) {
		const upper = key.toUpperCase();
		if (upper.startsWith("GIT_")) delete environment[key];
	}
	const emptyConfig = emptyGitConfigPath();
	environment.GIT_CONFIG_NOSYSTEM = "1";
	environment.GIT_CONFIG_GLOBAL = emptyConfig;
	environment.GIT_CONFIG_SYSTEM = emptyConfig;
	environment.GIT_OPTIONAL_LOCKS = "0";
	environment.LC_ALL = "C";
	environment.LANG = "C";
	return environment;
}