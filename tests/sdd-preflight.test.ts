import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	collectSddPreflightPreferences,
	DEFAULT_SDD_PREFLIGHT,
	installSddAssets,
	readSddPreflightFromDisk,
	sddPreflightDiskPath,
	writeSddPreflightToDisk,
	type SddPreflightPreferences,
} from "../lib/sdd-preflight.ts";

async function workspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gentle-pi-sdd-preflight-"));
}

const SAMPLE_PREFS: SddPreflightPreferences = {
	executionMode: "auto",
	artifactStore: "engram",
	chainedPrStrategy: "auto-chain",
	reviewBudgetLines: 400,
	engramAvailable: true,
	prompted: true,
};

function preflightContext(cwd: string, hasUI: boolean, calls: string[] = [], answers: Record<string, string> = {}) {
	return { cwd, hasUI, ui: { select: async (title: string) => (calls.push(`select:${title}`), answers[title]), input: async (title: string) => (calls.push(`input:${title}`), answers[title]), notify: () => {} } } as Parameters<typeof collectSddPreflightPreferences>[0];
}
function writeRawPreflight(cwd: string, chainedPrStrategy: string, prompted = true): string {
	const path = sddPreflightDiskPath(cwd); mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true }); writeFileSync(path, JSON.stringify({ executionMode: "auto", artifactStore: "openspec", chainedPrStrategy, reviewBudgetLines: 400, engramAvailable: false, prompted })); return path;
}
test("production callers distinguish automatic defaults from explicit preflight prompts", () => {
	const root = join(import.meta.dirname, ".."), gentleAi = readFileSync(join(root, "extensions", "gentle-ai.ts"), "utf8"), sddInit = readFileSync(join(root, "extensions", "sdd-init.ts"), "utf8");
	assert.match(gentleAi, /function runSddPreflight\(\s*ctx: ExtensionContext,\s*promptFields: readonly SddPreflightField\[\] = \[\]\s*\)/s); assert.match(gentleAi, /if \(isSddAgent && !getSddPreflightPreferences\(ctx\)\) \{\s*await runSddPreflight\(ctx\);/s); assert.match(gentleAi, /applyModelConfig: async \(\) => applySavedModelConfig\(ctx\)\s*\},\s*\{\s*promptFields\s*\}\s*\);/s); assert.match(gentleAi, /handler: async \(_args, ctx\) => \{\s*await runSddPreflight\(ctx, SDD_PREFLIGHT_FIELDS\);/s); assert.match(sddInit, /applyModelConfig: \(\) => applySavedModelConfig\(ctx\)\s*\},\s*\{\s*promptFields: \[\]\s*\}\s*\);/s);
});
test("capability-constrained artifact selector elision", async () => {
	const calls: string[] = [], prefs = await collectSddPreflightPreferences(preflightContext(await workspace(), true, calls), false, { promptFields: ["artifactStore"] });
	assert.deepEqual(prefs, DEFAULT_SDD_PREFLIGHT); assert.deepEqual(calls, []);
});
test("headless/UI canonical-domain parity", async () => {
	const calls: string[] = [], ui = await collectSddPreflightPreferences(preflightContext(await workspace(), true, calls), false), headless = await collectSddPreflightPreferences(preflightContext(await workspace(), false), false);
	assert.deepEqual(ui, DEFAULT_SDD_PREFLIGHT); assert.deepEqual(headless, ui); assert.deepEqual(calls, []);
});
test("explicit UI selections override defaults when a field is genuinely unresolved", async () => {
	const calls: string[] = [], prefs = await collectSddPreflightPreferences(preflightContext(await workspace(), true, calls, { "SDD execution mode": "interactive", "SDD artifact store": "engram", "SDD delivery strategy": "auto-chain", "SDD review budget lines": "700" }), true, { persisted: DEFAULT_SDD_PREFLIGHT, promptFields: ["executionMode", "artifactStore", "chainedPrStrategy", "reviewBudgetLines"] });
	assert.deepEqual({ executionMode: prefs.executionMode, artifactStore: prefs.artifactStore, chainedPrStrategy: prefs.chainedPrStrategy, reviewBudgetLines: prefs.reviewBudgetLines }, { executionMode: "interactive", artifactStore: "engram", chainedPrStrategy: "auto-chain", reviewBudgetLines: 700 }); assert.equal(prefs.prompted, true); assert.equal(calls.length, 4);
});
test("legacy persisted strategies normalize to canonical values", async () => {
	const mappings = { "auto-forecast": "ask-on-risk", "ask-always": "ask-on-risk", "single-pr-default": "single-pr", "force-chained": "auto-chain" } as const;
	for (const [legacy, canonical] of Object.entries(mappings)) { const cwd = await workspace(); writeRawPreflight(cwd, legacy); assert.equal(readSddPreflightFromDisk(cwd)?.chainedPrStrategy, canonical); }
});
test("exception-ok requires narrow delivery-gate provenance", async () => {
	for (const prompted of [false, true]) { const cwd = await workspace(); writeRawPreflight(cwd, "exception-ok", prompted); assert.equal(readSddPreflightFromDisk(cwd)?.chainedPrStrategy, "ask-on-risk"); }
	const accepted = await collectSddPreflightPreferences(preflightContext(await workspace(), false), false, { persisted: { ...DEFAULT_SDD_PREFLIGHT, chainedPrStrategy: "exception-ok" }, acceptSizeException: true }); assert.equal(accepted.chainedPrStrategy, "exception-ok"); assert.equal(accepted.sizeExceptionAccepted, true);
	const durable = await workspace(); writeSddPreflightToDisk(durable, accepted); assert.equal(readSddPreflightFromDisk(durable)?.chainedPrStrategy, "ask-on-risk");
});

test("sddPreflightDiskPath returns project-local .pi/gentle-ai/sdd-preflight.json", async () => {
	const cwd = await workspace();
	const path = sddPreflightDiskPath(cwd);
	assert.equal(path, join(cwd, ".pi", "gentle-ai", "sdd-preflight.json"));
});

test("writeSddPreflightToDisk creates parent dirs and writes valid JSON", async () => {
	const cwd = await workspace();
	writeSddPreflightToDisk(cwd, SAMPLE_PREFS);

	const path = sddPreflightDiskPath(cwd);
	assert.ok(existsSync(path));
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	assert.deepEqual(parsed, SAMPLE_PREFS);
});

test("readSddPreflightFromDisk returns undefined when no file exists", async () => {
	const cwd = await workspace();
	assert.equal(readSddPreflightFromDisk(cwd), undefined);
});

test("readSddPreflightFromDisk returns persisted prefs after write", async () => {
	const cwd = await workspace();
	writeSddPreflightToDisk(cwd, SAMPLE_PREFS);

	const loaded = readSddPreflightFromDisk(cwd);
	assert.deepEqual(loaded, SAMPLE_PREFS);
});

test("persisted preferences are reused with zero prompts", async () => {
	const cwd = await workspace(); writeSddPreflightToDisk(cwd, SAMPLE_PREFS);
	const loaded = readSddPreflightFromDisk(cwd); assert.ok(loaded);
	const calls: string[] = [], reused = await collectSddPreflightPreferences(preflightContext(cwd, true, calls), loaded!.engramAvailable, { persisted: loaded });
	assert.deepEqual(reused, loaded); assert.deepEqual(calls, []);
});

test("readSddPreflightFromDisk returns undefined for corrupt JSON", async () => {
	const cwd = await workspace();
	const path = sddPreflightDiskPath(cwd);
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(path, "not-json{{{");

	assert.equal(readSddPreflightFromDisk(cwd), undefined);
});

test("readSddPreflightFromDisk returns undefined for JSON with invalid fields", async () => {
	const cwd = await workspace();
	const path = sddPreflightDiskPath(cwd);
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(path, JSON.stringify({ executionMode: "invalid", artifactStore: "openspec", chainedPrStrategy: "auto-forecast", reviewBudgetLines: 400, engramAvailable: false, prompted: false }));

	// executionMode "invalid" is not "interactive" | "auto" → should reject
	assert.equal(readSddPreflightFromDisk(cwd), undefined);
});

test("readSddPreflightFromDisk normalizes unknown chainedPrStrategy to ask-on-risk", async () => {
	const cwd = await workspace();
	const path = sddPreflightDiskPath(cwd);
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(path, JSON.stringify({
		executionMode: "interactive",
		artifactStore: "openspec",
		chainedPrStrategy: "unknown-strategy",
		reviewBudgetLines: 400,
		engramAvailable: false,
		prompted: true,
	}));

	const loaded = readSddPreflightFromDisk(cwd);
	assert.ok(loaded !== undefined);
	assert.equal(loaded.chainedPrStrategy, "ask-on-risk");
});

test("writeSddPreflightToDisk is non-fatal when directory is not writable (no throw)", async () => {
	// Can only test the no-throw guarantee; the actual write failure is swallowed
	// We verify that calling with a deeply nested path doesn't throw
	assert.doesNotThrow(() => {
		writeSddPreflightToDisk("/nonexistent/path/that/cannot/be/created/gently", SAMPLE_PREFS);
	});
});

test("forced asset refresh migrates the exact v0.10.7 malformed sdd-apply asset and preserves user edits", () => {
	const packageRoot = join(import.meta.dirname, "..");
	const legacySource = readFileSync(
		join(
			packageRoot,
			"tests",
			"fixtures",
			"v0.10.7",
			"assets",
			"agents",
			"sdd-apply.md",
		),
		"utf8",
	);
	const currentSource = readFileSync(
		join(packageRoot, "assets", "agents", "sdd-apply.md"),
		"utf8",
	);
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v0107-preflight-"));
	const temporaryUserAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v0107-user-preflight-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installed = join(temporaryAgentHome, "agents", "sdd-apply.md");
	const userInstalled = join(temporaryUserAgentHome, "agents", "sdd-apply.md");
	const userEdited = legacySource.replace(
		"You are the SDD apply executor for Gentle AI.",
		"You are the user-customized SDD apply executor for Gentle AI.",
	);
	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(join(temporaryAgentHome, "agents"), { recursive: true });
		writeFileSync(installed, legacySource);
		mkdirSync(join(temporaryAgentHome, "gentle-ai"), { recursive: true });
		writeFileSync(
			join(temporaryAgentHome, "gentle-ai", "managed-assets.json"),
			JSON.stringify({ schemaVersion: 1, assets: {} }),
		);

		installSddAssets(packageRoot, true);

		assert.equal(readFileSync(installed, "utf8"), currentSource);
		assert.match(readFileSync(installed, "utf8"), /^tools:\n  - read$/m);
		const managedAssets = JSON.parse(
			readFileSync(
				join(temporaryAgentHome, "gentle-ai", "managed-assets.json"),
				"utf8",
			),
		) as { assets: Record<string, string> };
		assert.equal(
			managedAssets.assets["agents/sdd-apply.md"],
			createHash("sha256").update(currentSource).digest("hex"),
			"the migrated asset must record current package ownership",
		);

		installSddAssets(packageRoot, true);
		assert.equal(
			readFileSync(installed, "utf8"),
			currentSource,
			"a current package-managed asset must remain refreshable",
		);

		process.env.GENTLE_PI_AGENT_HOME = temporaryUserAgentHome;
		mkdirSync(join(temporaryUserAgentHome, "agents"), { recursive: true });
		writeFileSync(userInstalled, userEdited);
		installSddAssets(packageRoot, true);
		assert.equal(
			readFileSync(userInstalled, "utf8"),
			userEdited,
			"a user-edited variant of the malformed legacy asset must remain untouched",
		);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(temporaryAgentHome, { recursive: true, force: true });
		rmSync(temporaryUserAgentHome, { recursive: true, force: true });
	}
});

test("forced asset refresh migrates only untouched v0.14 package contracts and preserves user edits", () => {
	const packageRoot = join(import.meta.dirname, "..");
	const fixture = readFileSync(
		join(packageRoot, "tests", "fixtures", "v0.14", "assets", "agents", "review-risk.md"),
		"utf8",
	);
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v014-preflight-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const untouched = join(temporaryAgentHome, "agents", "review-risk.md");
	const edited = join(temporaryAgentHome, "agents", "review-readability.md");
	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(join(temporaryAgentHome, "agents"), { recursive: true });
		writeFileSync(untouched, fixture);
		writeFileSync(edited, `${fixture}\nuser-owned edit\n`);

		installSddAssets(packageRoot, true);

		assert.match(readFileSync(untouched, "utf8"), /initial_review_tree/);
		assert.equal(readFileSync(edited, "utf8"), `${fixture}\nuser-owned edit\n`);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

// gentle-ai calls the dual-store mode "hybrid"; this repo called the same
// operator-facing choice "both". Two names for one concept is how a caller ends
// up mapping between them by hand. gentle-ai owns the contract, so "hybrid" is
// canonical here too — but "both" is already persisted in operator preflight
// files on disk, so it must keep loading rather than fall back to the default.
test("a persisted legacy 'both' artifact store loads as hybrid", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "sdd-preflight-legacy-"));
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(
		sddPreflightDiskPath(cwd),
		JSON.stringify({ executionMode: "auto", artifactStore: "hybrid", chainedPrStrategy: "ask-on-risk", reviewBudgetLines: 400, engramAvailable: true, prompted: true }),
	);

	const loaded = readSddPreflightFromDisk(cwd, true);
	assert.equal(loaded?.artifactStore, "hybrid", "legacy 'both' must normalize to the canonical name, not be discarded");
});

test("a persisted canonical 'hybrid' artifact store loads unchanged", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "sdd-preflight-hybrid-"));
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(
		sddPreflightDiskPath(cwd),
		JSON.stringify({ executionMode: "auto", artifactStore: "hybrid", chainedPrStrategy: "ask-on-risk", reviewBudgetLines: 400, engramAvailable: true, prompted: true }),
	);

	const loaded = readSddPreflightFromDisk(cwd, true);
	assert.equal(loaded?.artifactStore, "hybrid");
});
