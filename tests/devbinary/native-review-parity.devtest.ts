import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../../extensions/gentle-ai.ts";
import { deriveChangedPathManifest } from "../../lib/review-candidate-view.ts";
import {
	NativeReviewCliV214,
	createNodeExecFileAdapter,
	setNativeCliContractForTesting,
	type ExecFileAdapter,
	type NativeReviewCli,
} from "../../lib/native-review-cli.ts";
import { CandidateViewRegistry } from "../../lib/review-candidate-view.ts";
import { readReviewConsentLatch } from "../../lib/review-consent-latch.ts";
import type { AuthorityRepairAssessmentV1, ReviewStatusV3 } from "../../lib/review-integration-v2.ts";
import { requireDevBinary } from "../support/native-binary-gate.ts";

// Organic RDD Parity, Phase 6: non-gating dev-binary journey.
//
// `pnpm test` never picks this file up — it globs `tests/*.test.ts` only, and
// this file both lives one directory deeper and ends in `.devtest.ts`. It
// only runs via `pnpm run test:dev-binary`, and only when GENTLE_AI_DEV_BINARY
// names an existing absolute path. It never reads or writes the shipped
// 2.1.11 pins (lib/gentle-ai-binary.ts, scripts/gentle-ai-installer.mjs) —
// every capability stays negotiated per-process through the executable
// override seam below, exactly like every other native-review-cli test.
//
// Gated through the same loud-skip machinery as the two `tests/*.test.ts`
// binary-verified suites (Phase 4), extended here to cover this THIRD
// self-skipping suite (Phase 13.12/13.13 follow-up): under
// GENTLE_PI_REQUIRE_DEV_BINARY=1 a missing/invalid dev binary throws instead
// of silently reporting 5 tests / 0 pass / 0 fail, which is exactly how the
// v2.2.2 "receipt-driven development" terminology rot went unnoticed.
const DEV_BINARY = process.env.GENTLE_AI_DEV_BINARY;
const devBinaryGate = requireDevBinary({
	devBinaryPath: DEV_BINARY,
	exists: typeof DEV_BINARY === "string" && DEV_BINARY.length > 0 && DEV_BINARY.startsWith("/") && existsSync(DEV_BINARY),
	env: process.env,
});
if (!devBinaryGate.run) console.log(`tests/devbinary/native-review-parity.devtest.ts: ${devBinaryGate.reason}`);
const RUNNABLE = devBinaryGate.run;

// A synthetic capable version, exactly like native-review-parity.test.ts's
// CAPABLE_VERSION overlay. Real dev binaries never carry a pinned three-part
// semver (the live binary under test reports "gentle-ai dev-organic-...",
// confirmed live during Phase 6 ground-truthing), so `verifyVersion`'s frozen
// `/^gentle-ai ([0-9]+\.[0-9]+\.[0-9]+)\n$/` regex can never match it — by
// design, a dev build is never a pinned release. The bridge below substitutes
// exactly one in-memory version response and forwards every other call to the
// real process untouched, so argv fidelity is guaranteed: NativeReviewCliV214
// itself builds every argv array here, never this file.
const BRIDGE_VERSION = "9.8.7";

function bridgeAdapter(binary: string): ExecFileAdapter {
	const real = createNodeExecFileAdapter();
	return async (request) => {
		if (request.arguments[0] === "version") {
			return { stdout: `gentle-ai ${BRIDGE_VERSION}\n`, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		}
		return real({ ...request, file: binary });
	};
}

// A NativeReviewCli backed by the real dev binary for reviewMode/start/
// validate (the organic-parity surface under test), with a synthetic
// targetStatus fixture standing in for the negotiated review-integration/v2
// contract; the plain-CLI decode path in lib/native-review-cli.ts (reviewMode,
// start, validate here) stays independent of the negotiated status shape.
function journeyNative(binary: string): NativeReviewCli {
	const bridge = new NativeReviewCliV214(bridgeAdapter(binary), binary);
	return {
		start: (request) => bridge.start(request),
		validate: (request) => bridge.validate(request),
		reviewMode: (request) => bridge.reviewMode(request),
		async targetStatus(request) {
			return request.lineageId === undefined
				? unrelatedStartTargetStatus(request.cwd)
				: currentTargetStatusFixture(request.lineageId, request.cwd);
		},
	} as unknown as NativeReviewCli;
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-dev-binary-"));
	t.after(() => {
		try { execFileSync("chmod", ["-R", "u+w", cwd]); } catch { /* best effort */ }
		rmSync(cwd, { recursive: true, force: true });
	});
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.email", "devbinary@example.com");
	git(cwd, "config", "user.name", "Dev Binary Journey");
	return cwd;
}

const UNSUPPORTED_REPAIR_ASSESSMENT: AuthorityRepairAssessmentV1 = {
	schema: "gentle-ai.review-authority-repair-assessment/v1",
	status: "unsupported",
	counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 },
	supportedOperations: ["review/complete-fix", "review/validate-fix"],
	authorizationSchema: "gentle-ai.review-repair-authorization/v1",
};
const RAW_UNSUPPORTED_REPAIR_ASSESSMENT = {
	schema: UNSUPPORTED_REPAIR_ASSESSMENT.schema,
	status: UNSUPPORTED_REPAIR_ASSESSMENT.status,
	counts: {
		lineages: 0, compact_lineages: 0, legacy_lineages: 0, events: 0, bytes: 0,
		eligible_candidates: 0, unsupported_lineages: 0, conflicts: 0,
	},
	supported_operations: UNSUPPORTED_REPAIR_ASSESSMENT.supportedOperations,
	authorization_schema: UNSUPPORTED_REPAIR_ASSESSMENT.authorizationSchema,
};

// The candidate-view guard (assertNativeStartCandidateBinding) compares this
// fixture's projection against the trees and paths gentle-pi derives from the
// real workspace, so the fixture cannot invent them. It mirrors exactly what
// lib/review-candidate-view.ts does: read HEAD into a scratch index, stage
// everything, and write that tree. Hardcoded placeholders can never match, and
// a mismatch surfaces as candidate-target-projection-drift long before the
// binary under test is ever asked anything.
function realProjectionFacts(cwd: string): { baseTree: string; candidateTree: string; paths: readonly string[] } {
	const baseTree = git(cwd, "rev-parse", "HEAD^{tree}");
	const index = mkdtempSync(join(tmpdir(), "gentle-pi-devtest-index-"));
	try {
		const environment = { ...process.env, GIT_INDEX_FILE: join(index, "index") };
		execFileSync("git", ["read-tree", "HEAD"], { cwd, env: environment });
		execFileSync("git", ["add", "-A"], { cwd, env: environment });
		const candidateTree = execFileSync("git", ["write-tree"], { cwd, env: environment, encoding: "utf8" }).trim();
		const paths = deriveChangedPathManifest(cwd, baseTree, candidateTree).map((entry) => entry.path);
		return { baseTree, candidateTree, paths };
	} finally {
		rmSync(index, { recursive: true, force: true });
	}
}

function unrelatedStartTargetStatus(cwd: string): ReviewStatusV3 {
	const sha = `sha256:${"a".repeat(64)}`;
	const { baseTree, candidateTree, paths } = realProjectionFacts(cwd);
	const projection = {
		schema: "gentle-ai.review-integration.projection/v1" as const, kind: "current-changes" as const, projection: "workspace" as const,
		baseTree, initialReviewTree: candidateTree, currentCandidateTree: candidateTree, pathsDigest: sha, paths, intendedUntracked: [],
		intendedUntrackedProof: sha, initialSnapshotIdentity: sha, currentSnapshotIdentity: sha,
	};
	return {
		contract: "gentle-ai.review-integration/v2", applicability: "unrelated", receipt: { status: "not_applicable" }, action: "start",
		replayability: "not_replayable", targetIdentity: sha, projection, repair: UNSUPPORTED_REPAIR_ASSESSMENT, candidates: [],
		raw: {
			schema: "gentle-ai.review-integration.status/v3", contract: "gentle-ai.review-integration/v2", operation: "review.status",
			applicability: "unrelated", receipt: { status: "not_applicable" }, action: "start", replayability: "not_replayable", target_identity: sha,
			repair: RAW_UNSUPPORTED_REPAIR_ASSESSMENT,
			projection: { schema: projection.schema, kind: projection.kind, projection: projection.projection, base_tree: baseTree, initial_review_tree: candidateTree, current_candidate_tree: candidateTree, paths_digest: sha, paths, intended_untracked: [], intended_untracked_proof: sha, initial_snapshot_identity: sha, current_snapshot_identity: sha },
			candidates: [],
		},
	};
}

function currentTargetStatusFixture(lineageId: string, cwd: string): ReviewStatusV3 {
	const sha = `sha256:${"a".repeat(64)}`;
	const baseTree = git(cwd, "rev-parse", "HEAD^{tree}");
	const candidateTree = git(cwd, "write-tree");
	const projection = {
		schema: "gentle-ai.review-integration.projection/v1" as const, kind: "current-changes" as const, projection: "workspace" as const,
		baseTree, initialReviewTree: candidateTree, currentCandidateTree: candidateTree, pathsDigest: sha, paths: ["app.ts"], intendedUntracked: [],
		intendedUntrackedProof: sha, initialSnapshotIdentity: sha, currentSnapshotIdentity: sha,
	};
	return {
		contract: "gentle-ai.review-integration/v2", applicability: "current_target",
		authority: { version: "compact-v2", lineageId, state: "reviewing", generation: 1, revision: sha },
		receipt: { status: "expected_missing" }, action: "finalize", replayability: "not_replayable",
		frozen: { tier: "medium", originalChangedLines: 1, correctionBudget: 1 },
		targetIdentity: sha, projection, repair: UNSUPPORTED_REPAIR_ASSESSMENT, candidates: [],
		raw: {
			schema: "gentle-ai.review-integration.status/v3", contract: "gentle-ai.review-integration/v2", operation: "review.status",
			applicability: "current_target", receipt: { status: "expected_missing" }, action: "finalize", replayability: "not_replayable", target_identity: sha,
			authority: { version: "compact-v2", lineage_id: lineageId, state: "reviewing", generation: 1, revision: sha },
			frozen: { tier: "medium", original_changed_lines: 1, correction_budget: 1 },
			repair: RAW_UNSUPPORTED_REPAIR_ASSESSMENT,
			projection: { schema: projection.schema, kind: projection.kind, projection: projection.projection, base_tree: baseTree, initial_review_tree: candidateTree, current_candidate_tree: candidateTree, paths_digest: sha, paths: ["app.ts"], intended_untracked: [], intended_untracked_proof: sha, initial_snapshot_identity: sha, current_snapshot_identity: sha },
			candidates: [],
		},
	};
}

interface RegisteredTool {
	execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<{ details?: unknown }>;
}
interface RegisteredCommandFixture {
	handler: (args: string, ctx: ExtensionContext) => Promise<void>;
}

function runtime(nativeReviewCli: NativeReviewCli): { controller: RegisteredTool; commands: Map<string, RegisteredCommandFixture> } {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommandFixture>();
	const dependencies = { nativeReviewCli, candidateViews: new CandidateViewRegistry() } as unknown as Parameters<typeof createGentleAiExtension>[0];
	createGentleAiExtension(dependencies)({
		on() {},
		registerTool(definition: RegisteredTool & { name: string }) { tools.set(definition.name, definition); },
		registerCommand(name: string, definition: RegisteredCommandFixture) { commands.set(name, definition); },
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	return { controller: controller!, commands };
}

function headlessContext(cwd: string, notices: Array<{ message: string; type?: string }> = []): ExtensionContext {
	return { cwd, hasUI: false, ui: { notify: (message: string, type?: string) => { notices.push({ message, type }); } } } as unknown as ExtensionContext;
}
function confirmContext(cwd: string, answer: boolean): ExtensionContext {
	return { cwd, hasUI: true, ui: { confirm: async () => answer, notify: () => {} } } as unknown as ExtensionContext;
}

const START_ORDINARY = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
async function execStart(controller: RegisteredTool, id: string, ctx: ExtensionContext): Promise<Record<string, unknown>> {
	const { details } = await controller.execute(id, START_ORDINARY, undefined, undefined, ctx);
	return details as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Kill switch round trip (mirrors /gentle:review-mode status|disable|enable
// from the community guide flows).
// ---------------------------------------------------------------------------

test("dev-binary: gentle:review-mode round-trips status, disable, and enable against the real binary", { skip: !RUNNABLE }, async (t) => {
	const cwd = repository(t);
	const { commands } = runtime(journeyNative(DEV_BINARY!));
	const command = commands.get("gentle:review-mode")!;
	const notices: Array<{ message: string; type?: string }> = [];

	await command.handler("status", headlessContext(cwd, notices));
	assert.match(notices.at(-1)!.message, /receipt-driven development: on \(decided by \w+\)/);

	await command.handler("disable", headlessContext(cwd, notices));
	assert.match(notices.at(-1)!.message, /receipt-driven development: off \(decided by \w+\)/);

	await command.handler("status", headlessContext(cwd, notices));
	assert.match(notices.at(-1)!.message, /receipt-driven development: off \(decided by \w+\)/);

	await command.handler("enable", headlessContext(cwd, notices));
	assert.match(notices.at(-1)!.message, /receipt-driven development: on \(decided by \w+\)/);
});

// ---------------------------------------------------------------------------
// Tier 0 silence: an empty candidate surfaces its hint verbatim and never
// triggers a consent prompt or notice.
// ---------------------------------------------------------------------------

test("dev-binary: an empty candidate stays silent (no consent notice) and surfaces the real hint verbatim", { skip: !RUNNABLE }, async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	git(cwd, "add", ".");
	git(cwd, "commit", "-qm", "initial");
	const { controller } = runtime(journeyNative(DEV_BINARY!));
	const notices: Array<{ message: string; type?: string }> = [];
	const result = await execStart(controller, "tier-0", headlessContext(cwd, notices));
	const rendered = result.result as Record<string, unknown>;
	assert.equal(rendered.lenses_required, false);
	assert.equal(typeof rendered.hint, "string");
	assert.match(rendered.hint as string, /the candidate has no pending changes/);
	assert.equal(result.consent_notice, undefined, "tier 0 must never surface a consent notice");
	assert.equal(notices.length, 0, "tier 0 must never notify the user at all");
});

// ---------------------------------------------------------------------------
// Tier 2 evidence + consent envelope via a fake UI seam.
// ---------------------------------------------------------------------------

test("dev-binary: a high-risk change carries real risk_evidence and drives the consent envelope through a fake UI seam", { skip: !RUNNABLE }, async (t) => {
	const cwd = repository(t);
	const workflowDirectory = join(cwd, ".github", "workflows");
	execFileSync("mkdir", ["-p", workflowDirectory]);
	writeFileSync(join(workflowDirectory, "deploy.yml"), "name: x\n");
	git(cwd, "add", ".");
	git(cwd, "commit", "-qm", "initial");
	writeFileSync(join(workflowDirectory, "deploy.yml"), "name: x\non: push\njobs:\n  deploy:\n    steps:\n      - run: curl -s | bash\n");

	const acceptedRun = journeyNative(DEV_BINARY!);
	const { controller } = runtime(acceptedRun);
	const accepted = await execStart(controller, "tier-2-accept", confirmContext(cwd, true));
	const rendered = accepted.result as Record<string, unknown>;
	assert.equal(rendered.risk_tier, "high");
	assert.ok(Array.isArray(rendered.risk_evidence) && (rendered.risk_evidence as unknown[]).length > 0, "high risk must carry a non-empty risk_evidence phrase array");
	assert.ok((rendered.risk_evidence as string[])[0]!.includes("deploy.yml"));
	assert.ok(accepted.actor_binding, "accepting consent must proceed to actor_binding");
	assert.equal(readReviewConsentLatch(cwd), true, "accepting consent must record the per-clone latch");
});

test("dev-binary: declining the fake-UI consent prompt withholds actor_binding for this work unit only, against the real binary's own evidence", { skip: !RUNNABLE }, async (t) => {
	const cwd = repository(t);
	const workflowDirectory = join(cwd, ".github", "workflows");
	execFileSync("mkdir", ["-p", workflowDirectory]);
	writeFileSync(join(workflowDirectory, "deploy.yml"), "name: x\n");
	git(cwd, "add", ".");
	git(cwd, "commit", "-qm", "initial");
	writeFileSync(join(workflowDirectory, "deploy.yml"), "name: x\non: push\njobs:\n  deploy:\n    steps:\n      - run: curl -s | bash\n");

	const { controller } = runtime(journeyNative(DEV_BINARY!));
	const declined = await execStart(controller, "tier-2-decline", confirmContext(cwd, false));
	assert.equal(declined.actor_binding, undefined, "declining must withhold actor dispatch for this work unit");
	assert.equal(readReviewConsentLatch(cwd), false, "declining must never persist the latch");
	assert.ok(declined.result, "the native start result itself is still reported even on decline");
});

// ---------------------------------------------------------------------------
// Disabled/unmanaged delivery renders as a successful skip, never a failure.
// ---------------------------------------------------------------------------

// IMPORTANT reachability finding (Phase 6 ground-truthing): gentle-ai only
// emits the disabled/unmanaged delivery envelope through lineage
// AUTO-DISCOVERY (`review validate --gate <gate>` with no `--lineage`) — its
// Go source (internal/cli/review_facade.go:2412-2433,1904-1916) routes an
// explicit `--lineage <id>` through discoverCompactFacadeReview's
// lineage-specific branch, whose failures are plain `fmt.Errorf` values, never
// the `*ReviewReceiptDiscoveryError` the disabled/unmanaged check requires —
// confirmed live against both a nonexistent lineage id ("load compact facade
// review lineage: ... no such file or directory", exit 1) and a real
// previously-started lineage under a disabled switch ("facade review receipt
// is not available", exit 1). Neither is the structured JSON envelope.
// Pi's `gentle_review` VALIDATE operation always binds an explicit
// lineageId (extensions/gentle-ai.ts throws "Review controller validate
// requires a lineageId" otherwise), so this envelope is structurally
// unreachable through today's controller wiring — this is a pre-existing
// property of the VALIDATE contract, not something Phase 5.2 introduced.
// This is flagged as a risk for a future design revision, not silently
// papered over here. What Phase 6 CAN and does prove against the real binary
// is that Pi's decoder correctly decodes the envelope gentle-ai actually
// sends via auto-discovery; the controller-level mapping/early-return
// (mapNativeValidateResult + the skip response) is proven separately with a
// synthetic fixture in tests/review-controller-native-routing.test.ts,
// because gentle-ai's own explicit-lineage code path can never supply it.
test("dev-binary: VALIDATE via lineage auto-discovery decodes the real disabled/unmanaged delivery envelope", { skip: !RUNNABLE }, async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	git(cwd, "add", ".");
	git(cwd, "commit", "-qm", "initial");
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	git(cwd, "add", "--", "app.ts");

	// Each journey uses its own throwaway temp repository (deleted in
	// repository(t)'s cleanup), so there is no shared clone-local state to
	// restore afterward.
	const native = journeyNative(DEV_BINARY!);
	await native.reviewMode!({ cwd, operation: "disable" });

	// No lineageId: this is the one shape gentle-ai actually routes through
	// its disabled/unmanaged discovery branch.
	const result = await native.validate({ cwd, gate: "pre-commit" });
	assert.equal(result.delivery, "disabled/unmanaged");
	assert.equal(result.allowed, false);
	assert.equal(result.result, "invalidated");
	assert.equal(result.action, "repository-policy");
});

test.before(() => {
	if (RUNNABLE) {
		setNativeCliContractForTesting(BRIDGE_VERSION, {
			start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true,
			reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true,
			mode: true, riskEvidence: true, hint: true, delivery: true,
		});
	}
});
test.after(() => {
	if (RUNNABLE) setNativeCliContractForTesting(BRIDGE_VERSION, undefined);
});
