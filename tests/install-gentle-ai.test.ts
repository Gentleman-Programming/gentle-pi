// Covers scripts/install-gentle-ai.mjs — the postinstall entrypoint — for the
// GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1 escape hatch (P2b, task 4.5). The
// production check lives before installGentleAi() is ever called (see
// scripts/install-gentle-ai.mjs), so skipping is symmetric for the binary AND
// the assets bundle by construction: there is only ONE guarded call site, not
// two independent ones that could disagree.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { resolveGentleAiInstallerPackageRoot } from "../scripts/gentle-ai-installer.mjs";

const execFileAsync = promisify(execFile);

async function runtimeEntries(runtimeRoot: string): Promise<string[]> {
	return existsSync(runtimeRoot) ? (await readdir(runtimeRoot)).sort() : [];
}

test("GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1 skips binary and assets symmetrically, leaving no partially configured bundle directory", async () => {
	const packageRoot = resolveGentleAiInstallerPackageRoot();
	const runtimeRoot = join(packageRoot, ".gentle-ai");
	const before = await runtimeEntries(runtimeRoot);
	const script = join(packageRoot, "scripts", "install-gentle-ai.mjs");

	const result = await execFileAsync(process.execPath, [script], {
		cwd: packageRoot,
		env: { ...process.env, GENTLE_PI_SKIP_GENTLE_AI_INSTALL: "1" },
	});

	const after = await runtimeEntries(runtimeRoot);
	assert.deepEqual(
		after,
		before,
		"GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1 must leave the package-local runtime directory exactly as it was — no partial binary, no partial assets, no new staging or bundle directory",
	);
	assert.match(result.stderr, /GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1: skipped package-local Gentle AI installation/);
	assert.match(result.stderr, /native review operations will fail with package-local-binary-missing/);
});
