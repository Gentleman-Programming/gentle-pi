import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolveGentleAiBinary } from "../lib/gentle-ai-binary.ts";
import { NativeReviewCliV216 } from "../lib/native-review-cli.ts";
import { requireNativeBinary } from "./support/native-binary-gate.ts";
import {
	EVIDENCE_CLASS,
	MISSING_EVIDENCE_DEPENDENCY,
	PROVIDER_BEHAVIOR_ISSUE,
	type ProviderBehaviorAssertion,
	type ProviderBehaviorEvidenceRecord,
	evaluateProviderBehaviorAssertion,
	listTestFiles,
	scanForPattern,
	scanForReconstructionSymbols,
} from "./support/provider-behavior-evidence.ts";

// This file implements W3 (tasks.md W3.1-W3.11) of the Wave 1 (#2028)
// provider-behavior-parity capability: #1819/#1915 evidence consumption and
// the #2074/#910 no-action absence assertions. See
// openspec/changes/gentle-ai-main-behavior-parity/specs/provider-behavior-parity/spec.md
// for the acceptance criteria this file proves.

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// --- W3.10 setup: real installed binary, used only to prove the RDD ------
// boundary and delivery-evidence shape. Gated the same way every other
// binary-verified suite in this repository gates itself
// (tests/native-review-parity-runtime.test.ts): silently skip when the
// pinned binary is unresolved locally, fail loudly under
// GENTLE_PI_REQUIRE_NATIVE_BINARY=1 (CI). This is an environment-capability
// gate, not the evidence self-skip the spec forbids -- W3.5 below never
// uses it.
const resolvedBinary = (() => {
	try {
		return resolveGentleAiBinary(packageRoot, process.platform);
	} catch {
		return undefined;
	}
})();
const nativeBinaryGate = requireNativeBinary({ resolvedBinary, digestsPinned: true, env: process.env });
if (!nativeBinaryGate.run) console.log(`native-review-parity-issue-evidence: ${nativeBinaryGate.reason}`);
const rddTest = nativeBinaryGate.run ? test : test.skip;
const binary = resolvedBinary ?? "";

function nativeClient(): NativeReviewCliV216 {
	return new NativeReviewCliV216(async (request) => {
		try {
			const result = await execFileAsync(request.file, [...request.arguments], { cwd: request.cwd, encoding: "utf8" });
			return { stdout: result.stdout, stderr: result.stderr, exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		} catch (error) {
			const failure = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
			if (typeof failure.code !== "number") throw error;
			return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", exitCode: failure.code, signal: null, timedOut: false, outputLimitExceeded: false };
		}
	}, binary);
}

async function freshGitRepository(): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), "gentle-pi-issue-evidence-"));
	const repository = join(workspace, "repository");
	await mkdir(repository);
	await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: repository });
	await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: repository });
	await execFileAsync("git", ["config", "user.name", "Gentle Pi test"], { cwd: repository });
	await writeFile(join(repository, "tracked.txt"), "base\n");
	await execFileAsync("git", ["add", "--", "tracked.txt"], { cwd: repository });
	await execFileAsync("git", ["commit", "-m", "base"], { cwd: repository });
	return repository;
}

// ---------------------------------------------------------------------------
// W3.10 (part 1 of 2, deliberately placed first): the RDD boundary is
// asserted at the START of this file's run, not assumed. Evidence
// consumption below must start, recover, retry, reset, or reclaim no RDD
// authority -- so the global/effective mode must read `off` before anything
// else in this file executes.
// ---------------------------------------------------------------------------
rddTest("W3.10: gentle-ai review mode reports global and effective off BEFORE this file's other tests run", async () => {
	const repository = await freshGitRepository();
	try {
		const mode = await nativeClient().reviewMode({ cwd: repository, operation: "status" });
		assert.equal(mode.status.global, "off", "RDD must already be globally off in this environment; evidence consumption must never turn it on");
		assert.equal(mode.status.effective, "off");
	} finally {
		await rm(dirname(repository), { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// W3.1 / W3.2 -- #1819/#1915 development/bootstrap lane against fakes.
// ---------------------------------------------------------------------------

test("W3.1/W3.2: #1819 bootstrap-lane evidence is labelled development/bootstrap and never reaches final acceptance", () => {
	const assertion: ProviderBehaviorAssertion = { issue: PROVIDER_BEHAVIOR_ISSUE.CORRECTED_DELIVERY, evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, expectedOutcome: "allow" };
	const bootstrapEvidence: ProviderBehaviorEvidenceRecord = { evidenceClass: EVIDENCE_CLASS.BOOTSTRAP, outcome: "allow" };
	const result = evaluateProviderBehaviorAssertion(assertion, bootstrapEvidence);
	assert.notEqual(result.status, "pass", "a development/bootstrap result must never be recorded as final acceptance");
	assert.deepEqual(result, { status: "unsupported", capability: "final-acceptance-requires-live-signed-release" });
});

test("W3.1/W3.2: #1915 bootstrap-lane evidence is labelled development/bootstrap and never reaches final acceptance", () => {
	const assertion: ProviderBehaviorAssertion = { issue: PROVIDER_BEHAVIOR_ISSUE.RETRY_SUCCESSOR, evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, expectedOutcome: "approved" };
	const bootstrapEvidence: ProviderBehaviorEvidenceRecord = { evidenceClass: EVIDENCE_CLASS.BOOTSTRAP, outcome: "approved" };
	const result = evaluateProviderBehaviorAssertion(assertion, bootstrapEvidence);
	assert.notEqual(result.status, "pass");
	assert.deepEqual(result, { status: "unsupported", capability: "final-acceptance-requires-live-signed-release" });
});

test("live signed-release evidence reaches final acceptance and records the exact release identity it relied on", () => {
	const assertion: ProviderBehaviorAssertion = { issue: PROVIDER_BEHAVIOR_ISSUE.CORRECTED_DELIVERY, evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, expectedOutcome: "allow" };
	const evidence: ProviderBehaviorEvidenceRecord = { evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, outcome: "allow", releaseIdentity: "sha256:deadbeef" };
	assert.deepEqual(evaluateProviderBehaviorAssertion(assertion, evidence), { status: "pass", releaseIdentity: "sha256:deadbeef" });
});

test("a wrong-candidate/path-drift/extra-commit/non-squashed denial is preserved verbatim with no duplicate provider validation", () => {
	const assertion: ProviderBehaviorAssertion = { issue: PROVIDER_BEHAVIOR_ISSUE.CORRECTED_DELIVERY, evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, expectedOutcome: "deny" };
	const evidence: ProviderBehaviorEvidenceRecord = { evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, outcome: "deny" };
	const result = evaluateProviderBehaviorAssertion(assertion, evidence);
	assert.equal(result.status, "pass", "the provider's denial verdict is transported verbatim, never recomputed by Pi");
});

test("a terminal retry-successor outcome (approved or escalated) is decoded and stays authoritative, never reported as corruption", () => {
	for (const outcome of ["approved", "escalated"] as const) {
		const assertion: ProviderBehaviorAssertion = { issue: PROVIDER_BEHAVIOR_ISSUE.RETRY_SUCCESSOR, evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, expectedOutcome: outcome };
		const evidence: ProviderBehaviorEvidenceRecord = { evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, outcome };
		const result = evaluateProviderBehaviorAssertion(assertion, evidence);
		assert.equal(result.status, "pass", `terminal ${outcome} must remain authoritative`);
	}
});

test("a mutable provider main/source-checkout/hand-assembled-archive evidence class is refused, never substituting for release evidence", () => {
	const assertion: ProviderBehaviorAssertion = { issue: PROVIDER_BEHAVIOR_ISSUE.RETRY_SUCCESSOR, evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, expectedOutcome: "approved" };
	const mutableEvidence = { evidenceClass: "provider-main-checkout", outcome: "approved" } as unknown as ProviderBehaviorEvidenceRecord;
	assert.deepEqual(evaluateProviderBehaviorAssertion(assertion, mutableEvidence), { status: "unsupported", capability: "mutable-provider-build-refused" });
});

// ---------------------------------------------------------------------------
// W3.3 / W3.4 -- absent evidence must block, never pass or self-skip.
// ---------------------------------------------------------------------------

test("W3.3/W3.4: absent evidence blocks the #1819 assertion and names the missing foundation dependency", () => {
	const assertion: ProviderBehaviorAssertion = { issue: PROVIDER_BEHAVIOR_ISSUE.CORRECTED_DELIVERY, evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, expectedOutcome: "allow" };
	const result = evaluateProviderBehaviorAssertion(assertion, undefined);
	assert.deepEqual(result, { status: "blocked", missingDependency: MISSING_EVIDENCE_DEPENDENCY });
	assert.notEqual(result.status, "pass");
});

test("W3.3/W3.4: absent evidence blocks the #1915 assertion and names the missing foundation dependency", () => {
	const assertion: ProviderBehaviorAssertion = { issue: PROVIDER_BEHAVIOR_ISSUE.RETRY_SUCCESSOR, evidenceClass: EVIDENCE_CLASS.LIVE_SIGNED_RELEASE, expectedOutcome: "approved" };
	const result = evaluateProviderBehaviorAssertion(assertion, undefined);
	assert.deepEqual(result, { status: "blocked", missingDependency: MISSING_EVIDENCE_DEPENDENCY });
	assert.notEqual(result.status, "pass");
});

// ---------------------------------------------------------------------------
// W3.5 -- the deliberately-failing final-acceptance test. See the failure
// message below for the full explanation; do not silence, skip, or delete
// this test to make CI green.
// ---------------------------------------------------------------------------

const W3_5_FAIL_CLOSED_MESSAGE = [
	"FAIL-CLOSED BY DESIGN -- this red result is correct, do not silence it.",
	"",
	"#1819 (corrected-delivery topology) and #1915 (retry-successor authority) are",
	"provider-owned. Final acceptance for both requires immutable-release evidence",
	"produced by the sibling foundation change `consume-gentle-ai-release-artifacts`",
	"(its generic evidence harness at tests/evidence/**), which has not shipped into",
	"this repository yet.",
	"",
	"Per the provider-behavior-parity spec's 'Absent evidence blocks verification'",
	"requirement, absent qualifying evidence MUST report blocked and MUST NOT pass,",
	"self-skip, or downgrade to an informational note -- a silent skip here would",
	"record a false success for behavior nobody actually verified.",
	"",
	"This test turns GREEN only once BOTH of the following are true:",
	"  1. consume-gentle-ai-release-artifacts ships tests/evidence/** in this repo.",
	"  2. The foundation's pin gate confirms design.md's two open questions:",
	"       - whether frozen-main STATUS exposes an explicit admitted-result record,",
	"         or slot-consumption-under-unchanged-authority remains the only proof; and",
	"       - the exact envelope key carrying `admission_diagnostic` in the pinned",
	"         gentle-ai release.",
	"",
	"Do NOT add test.skip, an early return, or a try/catch that swallows this",
	"failure. Do NOT delete this test to make CI green. If you are reading this",
	"because CI is red, that is the correct fail-closed state described under Risk",
	"'Qualifying evidence absent at verification' in",
	"openspec/changes/gentle-ai-main-behavior-parity/design.md.",
].join("\n");

test("W3.5: #1819/#1915 final acceptance is BLOCKED until consume-gentle-ai-release-artifacts ships (fail-closed by design)", async () => {
	const evidenceHarnessUrl = pathToFileURL(join(packageRoot, "tests", "evidence", "harness.ts")).href;
	try {
		await import(evidenceHarnessUrl);
	} catch {
		assert.fail(W3_5_FAIL_CLOSED_MESSAGE);
		return;
	}
	// tests/evidence/** exists now but this acceptance test was never wired to
	// consume it -- failing loudly here is still correct: a silently-passing
	// stub would be the exact false-success this spec forbids.
	assert.fail("tests/evidence/** now exists in this repository. Wire the real #1819/#1915 final-acceptance check against the foundation harness in this test before merging -- do not leave this branch unimplemented, and do not delete the fail-closed message above until that work lands.");
});

// ---------------------------------------------------------------------------
// W3.6 / W3.7 -- zero-reconstruction static guard.
// ---------------------------------------------------------------------------

test("W3.6/W3.7: lib/ and extensions/ declare no delivery-topology or authority-graph symbol (Pi asserts outcomes, it never reconstructs provider algorithms)", () => {
	const violations = scanForReconstructionSymbols([join(packageRoot, "lib"), join(packageRoot, "extensions")]);
	assert.deepEqual(violations, [], `Wave 1 must never declare a provider-owned delivery-topology/authority-graph symbol in lib/ or extensions/; found: ${JSON.stringify(violations)}`);
});

// ---------------------------------------------------------------------------
// W3.8 / W3.9 -- #2074/#910 absence and coverage-enumeration assertions.
// ---------------------------------------------------------------------------

const WAVE_1_COVERAGE_DISPOSITION = { COVERED: "covered", BLOCKED_PENDING_FOUNDATION: "blocked-pending-foundation", NO_ACTION: "no-action" } as const;

// This IS the Wave 1 coverage enumeration the spec's "No false coverage
// claim" scenario requires: #2074 and #910 appear here as `no-action`
// dispositions, never as a passing fixture, journey, or covered assertion.
const WAVE_1_ISSUE_COVERAGE = [
	{ issue: "2028", disposition: WAVE_1_COVERAGE_DISPOSITION.COVERED, note: "capture/admission/transport (W1) + diagnostics/relaunch/lost-output/cleanup (W2)" },
	{ issue: PROVIDER_BEHAVIOR_ISSUE.CORRECTED_DELIVERY, disposition: WAVE_1_COVERAGE_DISPOSITION.BLOCKED_PENDING_FOUNDATION, note: "corrected-delivery evidence consumption awaits consume-gentle-ai-release-artifacts" },
	{ issue: PROVIDER_BEHAVIOR_ISSUE.RETRY_SUCCESSOR, disposition: WAVE_1_COVERAGE_DISPOSITION.BLOCKED_PENDING_FOUNDATION, note: "retry-successor evidence consumption awaits consume-gentle-ai-release-artifacts" },
	{ issue: "2074", disposition: WAVE_1_COVERAGE_DISPOSITION.NO_ACTION, note: "Claude Code user-registry migration / legacy MCP cleanup -- Pi has no corresponding host surface" },
	{ issue: "910", disposition: WAVE_1_COVERAGE_DISPOSITION.NO_ACTION, note: "Windows installer/upgrade/Engram/GGA PowerShell host resolution -- Pi adds no duplicate resolver" },
] as const;

test("W3.8/W3.9: the Wave 1 coverage enumeration lists #2074 and #910 as no-action, never as a passing fixture/journey/covered assertion", () => {
	for (const issue of ["2074", "910"]) {
		const entries = WAVE_1_ISSUE_COVERAGE.filter((entry) => entry.issue === issue);
		assert.equal(entries.length, 1, `#${issue} must appear exactly once in the coverage enumeration`);
		assert.equal(entries[0]!.disposition, WAVE_1_COVERAGE_DISPOSITION.NO_ACTION, `#${issue} must be recorded as no-action, never covered`);
	}
});

test("W3.8/W3.9: no Claude user-registry write path exists in lib/, extensions/, or scripts/", () => {
	const roots = [join(packageRoot, "lib"), join(packageRoot, "extensions"), join(packageRoot, "scripts")];
	const claudeRegistryPattern = /\.claude\.json|\.claude\/mcp|claude[-_ ]?user[-_ ]?registry/i;
	assert.deepEqual(scanForPattern(roots, claudeRegistryPattern), [], "#2074 is no-action: Pi must not read, write, migrate, or delete Claude user or legacy MCP configuration");
});

test("W3.8/W3.9: the packaged file manifest (package.json files[]) names no Claude surface", () => {
	const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { files: readonly string[] };
	const claudeEntries = packageJson.files.filter((entry) => /claude/i.test(entry));
	assert.deepEqual(claudeEntries, [], "#2074 is no-action: the packaged file manifest must name no Claude-specific surface");
});

test("W3.8/W3.9: no pwsh -> powershell.exe -> powershell fallback ladder exists in lib/, extensions/, or scripts/", () => {
	const roots = [join(packageRoot, "lib"), join(packageRoot, "extensions"), join(packageRoot, "scripts")];
	assert.deepEqual(scanForPattern(roots, /pwsh/i), [], "#910 is no-action: Windows host resolution stays the single existing Node path, no duplicate PowerShell resolver");
	assert.deepEqual(scanForPattern(roots, /powershell\.exe/i), [], "#910 is no-action: no pwsh -> powershell.exe -> powershell fallback ladder");
});

test("W3.8/W3.9: no other test file carries a fixture or journey named for #2074 or #910", () => {
	const otherTestFiles = listTestFiles(join(packageRoot, "tests"), ["native-review-parity-issue-evidence.test.ts"]);
	assert.ok(otherTestFiles.length > 0, "sanity: the tests directory must contain other test files to scan");
	assert.deepEqual(scanForPattern(otherTestFiles, /\b2074\b/), [], "no fixture/journey may be named for #2074 -- that would manufacture the false coverage claim the spec forbids");
	assert.deepEqual(scanForPattern(otherTestFiles, /\b910\b/), [], "no fixture/journey may be named for #910 -- that would manufacture the false coverage claim the spec forbids");
});

// ---------------------------------------------------------------------------
// W3.10 (part 2 of 2, deliberately placed last): the RDD boundary must also
// hold AFTER every other test in this file ran, and delivery evidence must
// report disabled/unmanaged against the real installed binary -- not a fake.
// ---------------------------------------------------------------------------

rddTest("W3.10: gentle-ai review mode still reports global and effective off AFTER this file's other tests ran, and delivery evidence reports disabled/unmanaged", async () => {
	const repository = await freshGitRepository();
	try {
		const client = nativeClient();
		const mode = await client.reviewMode({ cwd: repository, operation: "status" });
		assert.equal(mode.status.global, "off", "evidence consumption must never start, recover, retry, reset, or reclaim RDD authority");
		assert.equal(mode.status.effective, "off");

		const validated = await client.validate({ cwd: repository, gate: "pre-commit" });
		assert.equal(validated.delivery, "disabled/unmanaged", "provider-behavior evidence consumption must not fabricate a receipt or approval");
	} finally {
		await rm(dirname(repository), { recursive: true, force: true });
	}
});
