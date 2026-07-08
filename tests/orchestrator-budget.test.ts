import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// orchestrator-lazy-diet migration tests
//
// Locks the split of the always-on `assets/orchestrator.md` into a thin core
// plus three path-substituted lazy reference files (see design.md "Core
// budget rebuilt from measured drafts" and "Appendix: drafted core texts").
//
// `getOrchestratorPrompt`'s rendered return value is memoized in a
// module-level cache (first-read-wins for the process lifetime — see design.md
// "Test seam (JD-005)"). Tests that need alternate asset roots use the
// test-only `__testing.renderOrchestratorPrompt(assetsDir)` helper instead of
// ambient environment variables, so production runtime asset resolution stays
// deterministic. The representative production assets directory below is
// populated by COPYING the real repo assets (dynamically, at test-run time)
// into a short-path tmpdir — this isolates byte-budget measurement from the
// real repo's absolute path length while keeping content representative of
// production. Tests that need to inspect the real repo files directly (the
// disposition-mapped union sweep, the core-alone token assertions) read
// `assets/*.md` directly via `readFileSync`, sidestepping the cache entirely.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dirname, "..");
const REAL_ASSETS_DIR = join(REPO_ROOT, "assets");
const FIXTURE_PATH = join(import.meta.dirname, "fixtures", "orchestrator.pre-diet.md");
const BUDGET_BYTES = 10240;

const LAZY_ASSET_NAMES = [
	"orchestrator.md",
	"sdd-orchestrator-workflow.md",
	"orchestrator-delegation.md",
	"orchestrator-memory.md",
	"orchestrator-skills.md",
] as const;

const representativeProductionAssetsDir = mkdtempSync(join(tmpdir(), "gp-b-"));
for (const name of LAZY_ASSET_NAMES) {
	const src = join(REAL_ASSETS_DIR, name);
	writeFileSync(
		join(representativeProductionAssetsDir, name),
		existsSync(src) ? readFileSync(src) : `stub placeholder for ${name} (not authored yet)\n`,
	);
}
const { __testing } = await import("../extensions/gentle-ai.ts");

const MIN_REALISTIC_INSTALL_ASSETS_PATH_CHARS = 59;

// Realistic-length assets path: mirrors an actual installed path such as
// `~/.pi/agent/npm/node_modules/gentle-pi/assets`, so the budget assertion is
// not laundered through an artificially short mkdtemp path. The helper is also
// exercised in a fresh child process (`tests/fixtures/measure-orchestrator-prompt.mjs`)
// to keep production cache behavior separate from fixture measurements.
const realisticBaseDir = mkdtempSync(join(tmpdir(), "gp-realistic-"));
const realisticDir = join(realisticBaseDir, ".pi", "agent", "npm", "node_modules", "gentle-pi", "assets");
mkdirSync(realisticDir, { recursive: true });
assert.ok(
	realisticDir.length >= MIN_REALISTIC_INSTALL_ASSETS_PATH_CHARS,
	`realistic scratch assets path is only ${realisticDir.length} chars, need >= ${MIN_REALISTIC_INSTALL_ASSETS_PATH_CHARS} to mirror a real install path`,
);
for (const name of LAZY_ASSET_NAMES) {
	const src = join(REAL_ASSETS_DIR, name);
	writeFileSync(
		join(realisticDir, name),
		existsSync(src) ? readFileSync(src) : `stub placeholder for ${name} (not authored yet)\n`,
	);
}

after(() => {
	rmSync(representativeProductionAssetsDir, { recursive: true, force: true });
	rmSync(realisticBaseDir, { recursive: true, force: true });
});

function readRealAsset(name: string): string {
	return readFileSync(join(REAL_ASSETS_DIR, name), "utf8");
}

function measureOrchestratorPromptBytes(assetsDir: string): number {
	const scriptPath = join(import.meta.dirname, "fixtures", "measure-orchestrator-prompt.mjs");
	const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, assetsDir], {
		env: process.env,
		encoding: "utf8",
	});
	assert.equal(
		result.status,
		0,
		`measure-orchestrator-prompt.mjs exited ${result.status} (stderr: ${result.stderr})`,
	);
	return Number.parseInt(result.stdout.trim(), 10);
}

// ---------------------------------------------------------------------------
// 2.2 — Byte budget (Spec: Always-On Injection Byte Budget)
// ---------------------------------------------------------------------------

test("getOrchestratorPrompt return value stays within the 10,240 B budget (short-path stub sanity check)", () => {
	const rendered = __testing.renderOrchestratorPrompt(representativeProductionAssetsDir);
	const bytes = Buffer.byteLength(rendered, "utf8");
	assert.ok(
		bytes <= BUDGET_BYTES,
		`getOrchestratorPrompt() returned ${bytes} B, exceeds the ${BUDGET_BYTES} B budget`,
	);
});

test(`getOrchestratorPrompt return value stays within the 10,240 B budget at a realistic (>= ${MIN_REALISTIC_INSTALL_ASSETS_PATH_CHARS} char) install path length`, () => {
	const bytes = measureOrchestratorPromptBytes(realisticDir);
	assert.ok(
		bytes <= BUDGET_BYTES,
		`getOrchestratorPrompt() returned ${bytes} B at a realistic ${realisticDir.length}-char ASSETS_DIR path, exceeds the ${BUDGET_BYTES} B budget`,
	);
});

// ---------------------------------------------------------------------------
// 2.3 — Disposition-mapped union sweep (Spec: No Normative Content Loss +
// Pointer reachability)
//
// Every normative line of the frozen pre-diet fixture is assigned to exactly
// one documented disposition: CORE_VERBATIM (byte-identical in the new
// core), or LAZY_VERBATIM (byte-identical in one specific lazy file, while
// core carries a freshly-authored CORE_SUMMARIZED_INTO summary sentence that
// is NOT literal-matched against the original line). Section headings that
// are reused unchanged as the new core's summary heading are CORE_VERBATIM;
// section bodies that are condensed away in core are LAZY_VERBATIM against
// their one target lazy file — never a blanket union across all three.
// ---------------------------------------------------------------------------

type Target = "core" | "delegation" | "memory" | "skills";

interface DispositionRange {
	lines: [number, number];
	target: Target;
	label: string;
}

const TARGET_FILE: Record<Target, string> = {
	core: "orchestrator.md",
	delegation: "orchestrator-delegation.md",
	memory: "orchestrator-memory.md",
	skills: "orchestrator-skills.md",
};

// Line numbers below are 1-indexed against tests/fixtures/orchestrator.pre-diet.md
// (frozen byte-identical copy of assets/orchestrator.md at 23,047 B / 312 lines).
const DISPOSITION_MAP: DispositionRange[] = [
	{ lines: [1, 4], target: "core", label: "Header + bind" },
	{ lines: [5, 8], target: "core", label: "Identity Contract" },
	{ lines: [9, 13], target: "core", label: "Core Role" },
	{ lines: [15, 15], target: "core", label: "Language Boundary heading" },
	{ lines: [17, 17], target: "core", label: "Language Boundary LB1 pointer" },
	{ lines: [19, 19], target: "delegation", label: "Language Boundary LB2 (subagent-English)" },
	{ lines: [21, 21], target: "core", label: "Language Boundary LB3 (artifact language)" },
	{ lines: [23, 23], target: "core", label: "Language Boundary LB4 (public comment language)" },
	{ lines: [25, 29], target: "delegation", label: "Language Boundary LB5 (exceptions)" },
	{ lines: [31, 40], target: "core", label: "Mental Model" },
	{ lines: [42, 42], target: "core", label: "Work Routing Ladder heading" },
	{ lines: [44, 110], target: "delegation", label: "Work Routing Ladder body + Pi Subagent Model Routing" },
	{ lines: [112, 112], target: "core", label: "Delegation Rules heading" },
	{ lines: [114, 114], target: "core", label: "Delegation Rules core question" },
	{
		lines: [116, 181],
		target: "delegation",
		label: "Delegation Rules table + Mandatory Triggers + Cost/Context Balance + Canonical Workflows + Review Lens Selection",
	},
	{ lines: [183, 191], target: "core", label: "SDD Workflow pointer" },
	{ lines: [193, 193], target: "core", label: "Memory Contract heading" },
	{ lines: [195, 195], target: "core", label: "Memory Contract intro" },
	{ lines: [197, 201], target: "core", label: "Memory Contract Non-SDD delegation" },
	{ lines: [203, 230], target: "memory", label: "Memory Contract SDD phases table + artifact keys + lifecycle rule" },
	{ lines: [232, 232], target: "core", label: "Skill Registry Protocol heading" },
	{ lines: [234, 253], target: "skills", label: "Skill Registry Protocol detail" },
	{ lines: [255, 255], target: "core", label: "Intent-Driven Skill Discovery heading" },
	{ lines: [257, 276], target: "skills", label: "Intent-Driven Skill Discovery detail" },
	{ lines: [278, 283], target: "core", label: "Safety" },
	{ lines: [285, 285], target: "core", label: "4R Review Triggers heading" },
	{ lines: [287, 312], target: "delegation", label: "4R Review Triggers body + Review Execution Contract" },
];

function isNormativeLine(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) return false;
	if (trimmed.startsWith("```")) return false;
	if (/^\|[\s\-:|]+\|$/.test(trimmed)) return false;
	return true;
}

const fixtureLines = readFileSync(FIXTURE_PATH, "utf8").split("\n");

for (const range of DISPOSITION_MAP) {
	test(
		`disposition-mapped union: ${range.label} (fixture:${range.lines[0]}-${range.lines[1]}) -> ${range.target}`,
		() => {
			const targetContent = readRealAsset(TARGET_FILE[range.target]);
			for (let ln = range.lines[0]; ln <= range.lines[1]; ln++) {
				const raw = fixtureLines[ln - 1];
				if (raw === undefined || !isNormativeLine(raw)) continue;
				const trimmed = raw.trim();
				assert.ok(
					targetContent.includes(trimmed),
					`normative line lost: fixture:${ln} "${trimmed}" not found verbatim in ${TARGET_FILE[range.target]} (disposition: ${range.target}, section: ${range.label})`,
				);
			}
		},
	);
}

// ---------------------------------------------------------------------------
// 2.4 — Core-alone load-bearing tokens (JD-007) — assert on the raw core
// string alone, no lazy union.
// ---------------------------------------------------------------------------

test("core-alone: load-bearing delegation tokens present without lazy union", () => {
	const core = readRealAsset("orchestrator.md");
	assert.match(core, /4-file rule/);
	assert.match(core, /Multi-file write rule/);
	assert.match(core, /PR rule/);
	assert.match(core, /Incident rule/);
	assert.match(core, /Long-session rule/);
	assert.match(core, /Fresh review rule/);
});

test("core-alone: 400 changed lines threshold present without lazy union", () => {
	const core = readRealAsset("orchestrator.md");
	assert.match(core, /400 changed lines/);
});

test("core-alone: all four review lens names present without lazy union", () => {
	const core = readRealAsset("orchestrator.md");
	assert.match(core, /review-risk/);
	assert.match(core, /review-reliability/);
	assert.match(core, /review-resilience/);
	assert.match(core, /review-readability/);
});

// ---------------------------------------------------------------------------
// 2.5 — No double-delivery (Spec: No Double-Delivery of On-Demand Content)
// ---------------------------------------------------------------------------

test("relocated lazy bodies are not double-delivered in the always-on core", () => {
	const rendered = __testing.getOrchestratorPrompt();
	assert.doesNotMatch(
		rendered,
		/### Canonical Lightweight Workflows/,
		"delegation-only body leaked into the always-on core",
	);
	assert.doesNotMatch(
		rendered,
		/### Pi Subagent Model Routing/,
		"delegation-only body leaked into the always-on core",
	);
	assert.doesNotMatch(
		rendered,
		/### SDD phases/,
		"memory-only body leaked into the always-on core",
	);
	assert.doesNotMatch(
		rendered,
		/Common intent hints, not hard routing:/,
		"skills-only body leaked into the always-on core",
	);
});

test("relocated lazy files are reachable via in-core pointer paths", () => {
	const rendered = __testing.getOrchestratorPrompt();
	assert.ok(
		rendered.includes(join(REAL_ASSETS_DIR, "orchestrator-delegation.md")),
		"core is missing a reachable pointer to orchestrator-delegation.md",
	);
	assert.ok(
		rendered.includes(join(REAL_ASSETS_DIR, "orchestrator-memory.md")),
		"core is missing a reachable pointer to orchestrator-memory.md",
	);
	assert.ok(
		rendered.includes(join(REAL_ASSETS_DIR, "orchestrator-skills.md")),
		"core is missing a reachable pointer to orchestrator-skills.md",
	);
});

// ---------------------------------------------------------------------------
// 2.6 — Cache and path-substitution integrity (Spec: Cache and Path
// Substitution Integrity)
// ---------------------------------------------------------------------------

test("getOrchestratorPrompt substitutes every placeholder", () => {
	const rendered = __testing.getOrchestratorPrompt();
	assert.doesNotMatch(rendered, /\{\{/, "unresolved {{...}} placeholder leaked into the rendered prompt");
});

test("getOrchestratorPrompt memoizes the return across calls", () => {
	const first = __testing.getOrchestratorPrompt();
	const second = __testing.getOrchestratorPrompt();
	assert.equal(second, first, "second call must return the memoized string");
});
