import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension, PendingReviewConsentRegistry } from "../extensions/gentle-ai.ts";
import {
	NATIVE_REVIEW_ERROR_CODE,
	REVIEW_CONSENT_NOTICES,
	NativeReviewCliError,
	NativeReviewConsentBindingError,
	NativeReviewConsentRequiredError,
	NativeReviewIntegrationError,
	NativeReviewCliV213 as NativeReviewCliV213Production,
	normalizeNativeReviewCwd,
	setNativeCliContractForTesting,
	type ExecFileAdapter,
	type NativeReviewCli,
	type NativeReviewConsentAnswer,
	type NativeReviewConsentAnswerRequest,
	type NativeStartRequest,
} from "../lib/native-review-cli.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { readReviewConsentLatch, recordReviewConsentLatch } from "../lib/review-consent-latch.ts";
import type { AuthorityRepairAssessmentV1, ReviewConsentV2, ReviewConsentV3, ReviewStatusV3 } from "../lib/review-integration-v2.ts";

// Queued-adapter clients never execute a real process; default to a fixed
// absolute package-local path so these tests do not depend on an installed
// binary.
class NativeReviewCliV213 extends NativeReviewCliV213Production {
	constructor(...parameters: ConstructorParameters<typeof NativeReviewCliV213Production>) {
		const [adapter, executable, ...rest] = parameters;
		super(adapter, executable ?? "/package/.gentle-ai/gentle-ai", ...rest);
	}
}

interface QueuedResult {
	stdout: string;
	stderr?: string;
	exitCode?: number;
	timedOut?: boolean;
	signal?: NodeJS.Signals | null;
	outputLimitExceeded?: boolean;
}

function queuedAdapter(results: QueuedResult[]): { adapter: ExecFileAdapter; calls: Array<{ file: string; arguments: readonly string[]; cwd: string }> } {
	const calls: Array<{ file: string; arguments: readonly string[]; cwd: string }> = [];
	return {
		calls,
		adapter: async (request) => {
			calls.push(request);
			const result = results.shift();
			if (!result) throw new Error("unexpected native invocation");
			return {
				stdout: result.stdout,
				stderr: result.stderr ?? "",
				exitCode: result.exitCode ?? 0,
				signal: result.signal ?? null,
				timedOut: result.timedOut ?? false,
				outputLimitExceeded: result.outputLimitExceeded ?? false,
			};
		},
	};
}

// A synthetic testing-only version whose capability row (in the testing
// overlay, never in the shipped NATIVE_CLI_CONTRACTS table) reports every
// organic-parity column true, so decode paths that are dark for every real
// shipped version — including the pinned 2.1.11 — can still be exercised.
const CAPABLE_VERSION = "9.9.9";
const CAPABLE_VERSION_LINE = { stdout: `gentle-ai ${CAPABLE_VERSION}\n` };
const DARK_VERSION = { stdout: "gentle-ai 2.1.11\n" };

test.beforeEach(() => {
	setNativeCliContractForTesting(CAPABLE_VERSION, {
		start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true,
		reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true,
		mode: true, riskEvidence: true, hint: true, delivery: true,
	});
});
test.afterEach(() => {
	setNativeCliContractForTesting(CAPABLE_VERSION, undefined);
});

const START = { stdout: JSON.stringify({ operation: "review/start", lineage_id: "lineage-1", state: "reviewing", risk_level: "medium", selected_lenses: ["review-reliability"], changed_files: 1, changed_lines: 2, correction_budget: 1, action: "created", lenses_required: true, projection: "workspace" }) };

function reviewModeStatusBody(effective: "on" | "off", overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: "gentle-ai.review-mode/v1",
		operation: "status",
		scope: "both",
		status: {
			schema: "gentle-ai.rdd-mode-status/v1",
			global: "",
			clone_local: "",
			effective,
			source: "default",
			...overrides,
		},
	};
}

test("reviewMode requires the mode capability and fails closed for a version without it", async () => {
	const queue = queuedAdapter([DARK_VERSION]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).reviewMode({ cwd: "/repo", operation: "status" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE,
	);
});

test("reviewMode status uses the exact fixed argv and decodes the effective mode", async () => {
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(reviewModeStatusBody("on")) }]);
	const result = await new NativeReviewCliV213(queue.adapter).reviewMode({ cwd: "/repo", operation: "status" });
	assert.deepEqual(queue.calls[1]?.arguments, ["review", "mode", "status", "--cwd", "/repo", "--json"]);
	assert.equal(result.status.effective, "on");
	assert.equal(result.scope, "both");
});

test("reviewMode canonicalizes an existing repository cwd before the version probe and status argv", async (t) => {
	if (process.platform === "win32") return t.skip("directory symlink creation requires elevated Windows privileges");
	const repository = mkdtempSync(join(tmpdir(), "gentle-pi-review-mode-cwd-"));
	const alias = `${repository}-alias`;
	symlinkSync(repository, alias, "dir");
	t.after(() => { rmSync(alias, { force: true }); rmSync(repository, { recursive: true, force: true }); });
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(reviewModeStatusBody("off", { global: "off", source: "global" })) }]);
	const result = await new NativeReviewCliV213(queue.adapter).reviewMode({ cwd: alias, operation: "status" });
	assert.equal(result.status.effective, "off");
	assert.equal(queue.calls.every((call) => call.cwd === repository), true);
	assert.deepEqual(queue.calls[1]?.arguments, ["review", "mode", "status", "--cwd", repository, "--json"]);
});

test("native review cwd normalization unifies Git Bash and drive-form Windows paths", () => {
	const expected = "C:\\Users\\Alan\\worktree B";
	assert.equal(normalizeNativeReviewCwd("/c/Users/Alan/worktree B", "win32"), expected);
	assert.equal(normalizeNativeReviewCwd("c:/Users/Alan/worktree B", "win32"), expected);
	assert.equal(normalizeNativeReviewCwd("/c/Users/Alan/worktree B", "linux"), "/c/Users/Alan/worktree B");
});

test("reviewMode status decodes an off effective mode with its deciding source", async () => {
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(reviewModeStatusBody("off", { clone_local: "off", source: "clone_local", revision: "sha256:deadbeef" })) }]);
	const result = await new NativeReviewCliV213(queue.adapter).reviewMode({ cwd: "/repo", operation: "status" });
	assert.equal(result.status.effective, "off");
	assert.equal(result.status.source, "clone_local");
	assert.equal(result.status.cloneLocal, "off");
	assert.equal(result.status.revision, "sha256:deadbeef");
});

test("reviewMode clone disable and enable retain a globally-unset default off", async () => {
	const queue = queuedAdapter([
		CAPABLE_VERSION_LINE, { stdout: JSON.stringify({ schema: "gentle-ai.review-mode/v1", operation: "disable", scope: "clone", status: { schema: "gentle-ai.rdd-mode-status/v1", global: "", clone_local: "off", effective: "off", source: "clone_local" } }) },
		CAPABLE_VERSION_LINE, { stdout: JSON.stringify({ schema: "gentle-ai.review-mode/v1", operation: "enable", scope: "clone", status: { schema: "gentle-ai.rdd-mode-status/v1", global: "", clone_local: "", effective: "off", source: "default" } }) },
	]);
	const client = new NativeReviewCliV213(queue.adapter);
	const disabled = await client.reviewMode({ cwd: "/repo", operation: "disable" });
	const enabled = await client.reviewMode({ cwd: "/repo", operation: "enable" });
	assert.deepEqual(queue.calls[1]?.arguments, ["review", "mode", "disable", "--cwd", "/repo", "--scope", "clone", "--json"]);
	assert.deepEqual(queue.calls[3]?.arguments, ["review", "mode", "enable", "--cwd", "/repo", "--scope", "clone", "--json"]);
	assert.equal(disabled.status.effective, "off");
	assert.equal(enabled.status.effective, "off");
	assert.equal(enabled.status.source, "default");
});

test("reviewMode rejects a response whose operation discriminator does not match the request", async () => {
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(reviewModeStatusBody("on")) }]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).reviewMode({ cwd: "/repo", operation: "disable" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
	);
});

test("native START decodes optional riskEvidence (a phrase array, matching gentle-ai's []string wire shape) and hint only when present", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const withEvidence = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify({ ...start, risk_evidence: ["service credentials in .env.example"], hint: "no reviewable candidate: every changed path is documentation." }) }]);
	const result = await new NativeReviewCliV213(withEvidence.adapter).start({ cwd: "/repo" });
	assert.deepEqual(result.riskEvidence, ["service credentials in .env.example"]);
	assert.equal(result.hint, "no reviewable candidate: every changed path is documentation.");

	const withoutEvidence = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: START.stdout }]);
	const bare = await new NativeReviewCliV213(withoutEvidence.adapter).start({ cwd: "/repo" });
	assert.equal(bare.riskEvidence, undefined);
	assert.equal(bare.hint, undefined);
});

test("native START rejects a scalar risk_evidence: the wire shape is always a phrase array, even with one phrase", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify({ ...start, risk_evidence: "not an array" }) }]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
	);
});

test("native VALIDATE decodes the disabled/unmanaged delivery alternate discriminator at exit 0", async () => {
	const body = {
		schema: "gentle-ai.review-gate-result/v1",
		result: "invalidated",
		allowed: false,
		action: "repository-policy",
		reason: "receipt-driven development is disabled and no receipt governs this candidate, so delivery follows ordinary repository policy",
		// gentle-ai's RDDDeliveryDisabledUnmanaged is a single literal
		// "disabled/unmanaged" — never split into two separate enum values.
		delivery: "disabled/unmanaged",
		context: { gate: "pre-commit", lineage_id: "", generation: 0, base_tree: "", candidate_tree: "", paths_digest: "", fix_delta_hash: "", policy_hash: "", ledger_hash: "", evidence_hash: "", base_relationship_valid: true },
	};
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(body), exitCode: 0 }]);
	const result = await new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "pre-commit" });
	assert.equal(result.result, "invalidated");
	assert.equal(result.allowed, false);
	assert.equal(result.action, "repository-policy");
	assert.equal(result.delivery, "disabled/unmanaged");
});

test("native VALIDATE rejects a split disabled-only or unmanaged-only delivery value: the wire literal is always the combined string", async () => {
	for (const delivery of ["disabled", "unmanaged"]) {
		const body = {
			schema: "gentle-ai.review-gate-result/v1", result: "invalidated", allowed: false, action: "repository-policy",
			reason: "receipt-driven development is disabled and no receipt governs this candidate, so delivery follows ordinary repository policy",
			delivery,
			context: { gate: "pre-commit", lineage_id: "", generation: 0, base_tree: "", candidate_tree: "", paths_digest: "", fix_delta_hash: "", policy_hash: "", ledger_hash: "", evidence_hash: "", base_relationship_valid: true },
		};
		const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(body), exitCode: 0 }]);
		await assert.rejects(
			() => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "pre-commit" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
			`delivery ${JSON.stringify(delivery)} must still fail closed`,
		);
	}
});

test("native VALIDATE without delivery keeps the strict exit-code/action pairing unchanged", async () => {
	const body = {
		schema: "gentle-ai.review-gate-result/v1",
		result: "invalidated",
		allowed: false,
		action: "repository-policy",
		reason: "should require exit 1 because delivery is absent",
		context: { gate: "pre-commit", lineage_id: "", generation: 0, base_tree: "", candidate_tree: "", paths_digest: "", fix_delta_hash: "", policy_hash: "", ledger_hash: "", evidence_hash: "", base_relationship_valid: true },
	};
	// Without `delivery`, an "invalidated" result with exit 0 is not the
	// alternate discriminator shape and must still fail closed.
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(body), exitCode: 0 }]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "pre-commit" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
	);
});

test("START tolerates the exact review-consent-skipped stderr line only when the mode capability is true", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const notice = "Gentle AI reviewed this change without asking, because this session has no terminal to answer on. Run 'gentle-ai review mode disable' to turn reviews off, or 'gentle-ai review mode status' to see the current setting.";

	const tolerated = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(start), stderr: notice }]);
	const result = await new NativeReviewCliV213(tolerated.adapter).start({ cwd: "/repo" });
	assert.equal(result.lineageId, "lineage-1");

	// Same exact stderr text, but the negotiated version's `mode` capability is
	// false (the pinned 2.1.11 row), so the notice must still fail closed.
	const notTolerated = queuedAdapter([DARK_VERSION, { stdout: JSON.stringify(start), stderr: notice }]);
	await assert.rejects(
		() => new NativeReviewCliV213(notTolerated.adapter).start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR,
	);
});

// gentle-ai v2.4.0 (feat(review)!: make receipt-driven development opt-in)
// DELETED reviewConsentSkippedDefaultProvenance. It existed to admit reviews
// were on because nobody chose; under opt-in RDD a default-source clone is
// refused before the consent ceremony runs, so the pinned binary can never
// emit it. The allowlist is a statement about what the PINNED binary writes
// while still succeeding, so a line no pinned binary can produce does not
// belong in it: keeping it would silently tolerate that exact text from
// anywhere else in a START's stderr.
test("the tolerated-stderr allowlist carries no line the pinned binary cannot emit", async () => {
	assert.ok(
		!REVIEW_CONSENT_NOTICES.some((notice) => notice.startsWith("Reviews are on by default")),
		"the default-provenance notice was deleted upstream in v2.4.0 and must not stay tolerated",
	);

	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const deleted = "Reviews are on by default; this was never explicitly chosen. Run 'gentle-ai review mode enable' to make reviews an explicit choice, or 'gentle-ai review mode disable' to turn them off.";
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(start), stderr: deleted }]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR,
	);
});

test("START rejects near-miss, prefixed, or extra-line stderr even when the mode capability is true", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const notice = "Gentle AI reviewed this change without asking, because this session has no terminal to answer on. Run 'gentle-ai review mode disable' to turn reviews off, or 'gentle-ai review mode status' to see the current setting.";
	for (const stderr of [
		`prefix: ${notice}`,
		`${notice}\nextra line`,
		notice.slice(0, -1),
	]) {
		const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(start), stderr }]);
		await assert.rejects(
			() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR,
			`stderr ${JSON.stringify(stderr)} must still fail closed`,
		);
	}
});

// ---------------------------------------------------------------------------
// Phase 3 (kill switch) + Phase 4 (consent) integration through the
// `gentle_review` controller tool and the `gentle:review-mode` command,
// against a fake NativeReviewCli (no binary needed).
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-organic-parity-"));
	// A materialized (retained) candidate view chmods its worktree read-only
	// (0o444/0o555) to prevent tampering while lenses run; restore write
	// permission recursively before cleanup so a retained-but-never-cleaned-up
	// candidate view does not leak an unremovable temp directory.
	t.after(() => {
		try { execFileSync("chmod", ["-R", "u+w", cwd]); } catch { /* best effort */ }
		rmSync(cwd, { recursive: true, force: true });
	});
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.email", "tests@example.com");
	git(cwd, "config", "user.name", "Tests");
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	git(cwd, "add", ".");
	git(cwd, "commit", "-m", "initial");
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	return cwd;
}

const UNSUPPORTED_REPAIR_ASSESSMENT: AuthorityRepairAssessmentV1 = {
	schema: "gentle-ai.review-authority-repair-assessment/v1",
	status: "unsupported",
	counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 },
	supportedOperations: ["review/complete-fix", "review/validate-fix"],
	authorizationSchema: "gentle-ai.review-repair-authorization/v1",
};

function unrelatedStartTargetStatus(cwd: string): ReviewStatusV3 {
	const sha = `sha256:${"a".repeat(64)}`;
	const candidate = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const tree = candidate.candidateTree;
	const baseTree = candidate.baseTree;
	const paths = candidate.paths;
	candidate.cleanup();
	const projection = {
		schema: "gentle-ai.review-integration.projection/v1" as const,
		kind: "current-changes" as const,
		projection: "workspace" as const,
		baseTree,
		initialReviewTree: tree,
		currentCandidateTree: tree,
		pathsDigest: sha,
		paths,
		intendedUntracked: [],
		intendedUntrackedProof: sha,
		initialSnapshotIdentity: sha,
		currentSnapshotIdentity: sha,
	};
	const rawRepair = {
		schema: UNSUPPORTED_REPAIR_ASSESSMENT.schema,
		status: UNSUPPORTED_REPAIR_ASSESSMENT.status,
		counts: {
			lineages: 0, compact_lineages: 0, legacy_lineages: 0, events: 0, bytes: 0,
			eligible_candidates: 0, unsupported_lineages: 0, conflicts: 0,
		},
		supported_operations: UNSUPPORTED_REPAIR_ASSESSMENT.supportedOperations,
		authorization_schema: UNSUPPORTED_REPAIR_ASSESSMENT.authorizationSchema,
	};
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "unrelated",
		receipt: { status: "not_applicable" },
		action: "start",
		replayability: "not_replayable",
		targetIdentity: sha,
		projection,
		repair: UNSUPPORTED_REPAIR_ASSESSMENT,
		candidates: [],
		raw: {
			schema: "gentle-ai.review-integration.status/v3", contract: "gentle-ai.review-integration/v2", operation: "review.status",
			applicability: "unrelated", receipt: { status: "not_applicable" }, action: "start", replayability: "not_replayable", target_identity: sha,
			repair: rawRepair,
			projection: { schema: projection.schema, kind: projection.kind, projection: projection.projection, base_tree: baseTree, initial_review_tree: tree, current_candidate_tree: tree, paths_digest: sha, paths, intended_untracked: [], intended_untracked_proof: sha, initial_snapshot_identity: sha, current_snapshot_identity: sha },
			candidates: [],
		},
	};
}

interface FakeOrganicNativeOptions {
	reviewModeCapable?: boolean;
	reviewModeEffective?: "on" | "off";
	reviewModeSource?: "default" | "global" | "clone_local";
	reviewModeThrows?: boolean;
	lensesRequired?: boolean;
	riskEvidence?: readonly string[];
	hint?: string;
}

function fakeOrganicNative(options: FakeOrganicNativeOptions = {}): { native: NativeReviewCli; state: { startCalls: number } } {
	const state = { startCalls: 0 };
	const reviewModeCapable = options.reviewModeCapable ?? true;
	const native = {
		async start() {
			state.startCalls += 1;
			return {
				lineageId: "native-lineage", state: "reviewing", riskLevel: "high",
				selectedLenses: ["review-risk", "review-resilience", "review-readability", "review-reliability"],
				changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created",
				lensesRequired: options.lensesRequired ?? true,
				...(options.riskEvidence === undefined ? {} : { riskEvidence: options.riskEvidence }),
				...(options.hint === undefined ? {} : { hint: options.hint }),
			};
		},
		async finalize(): Promise<never> { throw new Error("finalize not used in this test"); },
		async validate(): Promise<never> { throw new Error("validate not used in this test"); },
		async bindSdd(): Promise<never> { throw new Error("bindSdd not used in this test"); },
		async sddStatus(): Promise<never> { throw new Error("sddStatus not used in this test"); },
		async reviewStatus(): Promise<never> { throw new Error("reviewStatus not used in this test"); },
		async targetStatus(request: { cwd: string }) {
			return unrelatedStartTargetStatus(request.cwd);
		},
		...(reviewModeCapable
			? {
				async reviewMode(request: { operation: string }) {
					if (options.reviewModeThrows === true) throw new Error("native review mode process failed");
					const effective = options.reviewModeEffective ?? "on";
					const source = options.reviewModeSource ?? "default";
					return {
						operation: request.operation,
						scope: "both",
						status: {
							global: source === "global" ? effective : "",
							cloneLocal: source === "clone_local" && effective === "off" ? "off" : "",
							effective,
							source,
						},
					};
				},
			}
			: {}),
	} as unknown as NativeReviewCli;
	return { native, state };
}

interface RegisteredTool {
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	) => Promise<{ details?: unknown }>;
}

interface RegisteredCommandFixture {
	handler: (args: string, ctx: ExtensionContext) => Promise<void>;
}

interface RegisteredEventFixture {
	(event: unknown, ctx: ExtensionContext): Promise<unknown> | unknown;
}

interface RuntimeOptions {
	candidateViews?: CandidateViewRegistry;
	pendingReviewConsentRegistry?: PendingReviewConsentRegistry;
}

function runtime(
	nativeReviewCli: NativeReviewCli | null,
	writeReviewConsentLatch: typeof recordReviewConsentLatch = recordReviewConsentLatch,
	clock?: { now?: () => number; scheduleTimer?: (callback: () => void, delayMs: number) => { unref: () => void } },
	options: RuntimeOptions = {},
): { controller: RegisteredTool; commands: Map<string, RegisteredCommandFixture>; events: Map<string, RegisteredEventFixture> } {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommandFixture>();
	const events = new Map<string, RegisteredEventFixture>();
	const dependencies = {
		nativeReviewCli,
		candidateViews: options.candidateViews ?? new CandidateViewRegistry(),
		pendingReviewConsentRegistry: options.pendingReviewConsentRegistry ?? new PendingReviewConsentRegistry(),
		...clock,
	} as unknown as Parameters<typeof createGentleAiExtension>[0];
	__testing.createGentleAiExtension(dependencies, writeReviewConsentLatch)({
		on(name: string, handler: RegisteredEventFixture) { events.set(name, handler); },
		registerTool(definition: RegisteredTool & { name: string }) { tools.set(definition.name, definition); },
		registerCommand(name: string, definition: RegisteredCommandFixture) { commands.set(name, definition); },
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	return { controller: controller!, commands, events };
}

function headlessContext(cwd: string, notices: Array<{ message: string; type?: string }> = [], sessionId?: string): ExtensionContext {
	return {
		cwd,
		hasUI: false,
		ui: { notify: (message: string, type?: string) => { notices.push({ message, type }); } },
		...(sessionId === undefined ? {} : { sessionManager: { getSessionId: () => sessionId } }),
	} as unknown as ExtensionContext;
}

function confirmContext(cwd: string, answer: boolean): ExtensionContext {
	return { cwd, hasUI: true, ui: { confirm: async () => answer, notify: () => {} } } as unknown as ExtensionContext;
}

function throwingConfirmContext(cwd: string): ExtensionContext {
	return { cwd, hasUI: true, ui: { confirm: async () => { throw new Error("no answer available"); }, notify: () => {} } } as unknown as ExtensionContext;
}

const START_ORDINARY = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };

async function execStart(controller: RegisteredTool, id: string, ctx: ExtensionContext): Promise<Record<string, unknown>> {
	const { details } = await controller.execute(id, START_ORDINARY, undefined, undefined, ctx);
	return details as Record<string, unknown>;
}

test("kill-switch: effective off returns a non-failure skipped envelope and never calls native start", async (t) => {
	const cwd = repository(t);
	const { native, state } = fakeOrganicNative({ reviewModeEffective: "off" });
	const { controller } = runtime(native);
	const result = await execStart(controller, "kill-switch-off", headlessContext(cwd));
	assert.equal(result.status, "skipped");
	assert.equal(result.outcome, "review-mode-disabled");
	assert.equal(result.delivery, "disabled/unmanaged");
	assert.equal(result.mutation_performed, false);
	assert.equal(state.startCalls, 0, "native start must not be called once the kill switch reports off");
});

// Parity with gentle-ai's RDDDisabledError.Error()
// (internal/reviewtransaction/rdd_mode.go): a refusal names the situation, the
// source that actually decided, and a continuation scoped to that source. Pi
// never blocks here — the envelope is a non-failure skip — but it must not
// throw away which source decided, nor leave the caller without a way back on.
test("kill-switch: a clone-local off names the deciding source and clears the override only after any needed global opt-in", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeEffective: "off", reviewModeSource: "clone_local" });
	const { controller } = runtime(native);
	const result = await execStart(controller, "kill-switch-clone-local", headlessContext(cwd));
	assert.equal(result.status, "skipped");
	assert.equal(result.outcome, "review-mode-disabled");
	assert.equal(result.mode_source, "clone_local");
	assert.equal(result.reason, "receipt-driven development is disabled: start is skipped because the clone_local mode source keeps it off");
	assert.equal(result.next_action, "Run `gentle-ai review mode enable --scope=global` if global RDD is still off, then run /gentle:review-mode enable to clear this clone-local override.");
});

// gentle-ai maps RDDModeSourceGlobal onto `--scope=global`, and a clone-local
// override may only ever disable (cloneLocalRDDOverrideValue rejects RDDModeOn).
// Pi's own /gentle:review-mode always passes --scope clone, so it CANNOT clear a
// global off. Naming it here would be naming a dead end, so the continuation has
// to be the native command that actually resolves it.
test("kill-switch: a global off names the native global-scope command, never Pi's clone-scope one", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeEffective: "off", reviewModeSource: "global" });
	const { controller } = runtime(native);
	const result = await execStart(controller, "kill-switch-global", headlessContext(cwd));
	assert.equal(result.mode_source, "global");
	assert.equal(result.reason, "receipt-driven development is disabled: start is skipped because the global mode source keeps it off");
	assert.equal(
		result.next_action,
		"Run `gentle-ai review mode enable --scope=global` to turn reviews back on; /gentle:review-mode enable only clears the clone-local setting, which cannot override a global off.",
	);
	assert.ok(!/\/gentle:review-mode enable to turn/.test(String(result.next_action)), "a global off must never be sent to Pi's clone-scope command");
});

// Parity with reviewModeScopeForSource as of gentle-ai v2.4.0, which made
// receipt-driven development opt-in. Before that release an all-sources-unset
// install resolved to ON with source `default`, so `default` could never be
// what kept reviews off and naming a continuation would have been a guess.
// v2.4.0 resolves the same install to OFF with source `default`, which makes
// this the MOST COMMON refusal there is: every install that never opted in.
// gentle-ai answers `global` for it -- not because default is a global
// opinion, but because global is the only scope that can turn reviews on at
// all. Pi must say the same thing, because the alternative is handing the
// single most common state a dead end with no way forward.
test("kill-switch: an off with the default source names the only scope that can turn reviews on", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeEffective: "off", reviewModeSource: "default" });
	const { controller } = runtime(native);
	const result = await execStart(controller, "kill-switch-default", headlessContext(cwd));
	assert.equal(result.mode_source, "default");
	assert.equal(result.reason, "receipt-driven development is disabled: start is skipped because the default mode source keeps it off");
	assert.equal(
		result.next_action,
		"Run `gentle-ai review mode enable --scope=global` to opt in; RDD is off by default until explicitly enabled. /gentle:review-mode enable only clears a clone-local override and cannot enable global RDD.",
	);
	assert.ok(!/\/gentle:review-mode enable to turn/.test(String(result.next_action)), "a default off must never be sent to Pi's clone-scope command");
});

test("kill-switch: capability-absent (no reviewMode) leaves today's path unchanged", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeCapable: false, lensesRequired: false });
	const { controller } = runtime(native);
	const result = await execStart(controller, "kill-switch-absent", headlessContext(cwd));
	assert.notEqual(result.status, "skipped");
	assert.ok(result.result);
});

test("kill-switch: an unexpected reviewMode failure maps to the existing native-operation-failed envelope", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeThrows: true });
	const { controller } = runtime(native);
	const result = await execStart(controller, "kill-switch-error", headlessContext(cwd));
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "native-operation-failed");
});

function candidateConsent(cwd: string): ReviewConsentV2 {
	const targetIdentity = `sha256:${"a".repeat(64)}`;
	const choices = [
		{ answer: "granted" as const, label: "Run the review now", effect: "Review this exact candidate only.", invocation: `gentle-ai review start --contract gentle-ai.review-integration/v2 --cwd ${cwd} --target ${targetIdentity} --projection workspace --lineage native-lineage --consent granted` },
		{ answer: "declined" as const, label: "Not now, just this once", effect: "Create no authority and ask again next candidate.", invocation: `gentle-ai review start --contract gentle-ai.review-integration/v2 --cwd ${cwd} --target ${targetIdentity} --projection workspace --lineage native-lineage --consent declined` },
	] as const;
	const raw = { schema: "gentle-ai.review-integration.consent/v2", contract: "gentle-ai.review-integration/v2", operation: "review.start", action: "consent_required", blocking: true, target_identity: targetIdentity, projection: "workspace", risk_level: "high", changed_files: 1, changed_lines: 1, headline: "Review this candidate", reason: "It changes a process boundary.", value: "Review catches regressions.", risk_evidence: ["shell process"], choices: choices.map((choice) => ({ ...choice })), off_path: { note: "Disable reviews separately.", command: "gentle-ai review mode disable" } };
	return { schema: "gentle-ai.review-integration.consent/v2", contract: "gentle-ai.review-integration/v2", operation: "review.start", action: "consent_required", blocking: true, targetIdentity, projection: "workspace", riskLevel: "high", changedFiles: 1, changedLines: 1, headline: "Review this candidate", reason: "It changes a process boundary.", value: "Review catches regressions.", riskEvidence: ["shell process"], choices, offPath: { note: "Disable reviews separately.", command: "gentle-ai review mode disable" }, raw };
}

function foreignOrUnboundV3Consent(cwd: string, agent: "claude-code" | "unbound"): ReviewConsentV3 {
	const v2 = candidateConsent(cwd);
	const choices = v2.choices.map((choice) => ({
		...choice,
		invocation: agent === "claude-code"
			? choice.invocation.replace(" --consent ", " --agent claude-code --consent ")
			: choice.invocation,
	})) as [ReviewConsentV2["choices"][0], ReviewConsentV2["choices"][1]];
	const raw = {
		...v2.raw,
		schema: "gentle-ai.review-integration.consent/v3",
		agent: agent === "claude-code" ? "claude-code" : "pi",
		choices: choices.map((choice) => ({ ...choice })),
	};
	return {
		...v2,
		schema: "gentle-ai.review-integration.consent/v3",
		agent: agent === "claude-code" ? "claude-code" : "pi",
		choices,
		raw,
	};
}

function relayedConsentNative(cwd: string): { native: NativeReviewCli; consent: ReviewConsentV2; answers: NativeReviewConsentAnswer[]; startRequests: NativeStartRequest[]; answerRequests: NativeReviewConsentAnswerRequest[] } {
	const { native } = fakeOrganicNative();
	const consent = candidateConsent(cwd);
	const answers: NativeReviewConsentAnswer[] = [];
	const startRequests: NativeStartRequest[] = [];
	const answerRequests: NativeReviewConsentAnswerRequest[] = [];
	native.start = async (request) => {
		startRequests.push(request);
		throw new NativeReviewConsentRequiredError(consent);
	};
	native.answerConsent = async (request) => {
		answers.push(request.answer);
		answerRequests.push(request);
		if (request.answer === "declined") return { kind: "declined", targetIdentity: consent.targetIdentity, projection: "workspace", riskLevel: "high", changedFiles: 1, changedLines: 1, consent: "declined_this_candidate", raw: { operation: "review/start", action: "declined", consent: "declined_this_candidate" } };
		return { kind: "started", start: { lineageId: "native-lineage", state: "reviewing", riskLevel: "high", selectedLenses: ["review-risk", "review-resilience", "review-readability", "review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true } };
	};
	return { native, consent, answers, startRequests, answerRequests };
}

async function answerConsent(controller: RegisteredTool, binding: unknown, answer: unknown, ctx: ExtensionContext): Promise<Record<string, unknown>> {
	const { details } = await controller.execute("consent-answer", { operation: "answer-consent", input: JSON.stringify({ consentBinding: binding, answer }) }, undefined, undefined, ctx);
	return details as Record<string, unknown>;
}

async function blockedConsent(controller: RegisteredTool, id: string, ctx: ExtensionContext): Promise<Record<string, unknown>> {
	const result = await execStart(controller, id, ctx);
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "native-review-consent-required");
	assert.equal(typeof result.consent_binding, "string");
	return result;
}

test("Pi reconciles a foreign v3 consent without exposing its question or invocation", async (t) => {
	for (const agent of ["claude-code"] as const) {
		const cwd = repository(t);
		const { native } = fakeOrganicNative();
		const consent = foreignOrUnboundV3Consent(cwd, agent);
		const answers: NativeReviewConsentAnswer[] = [];
		let starts = 0;
		native.start = async () => {
			starts += 1;
			throw new NativeReviewConsentRequiredError(consent);
		};
		native.answerConsent = async (request) => {
			answers.push(request.answer);
			throw new Error("foreign consent answer must never be invoked");
		};

		const result = await execStart(runtime(native).controller, `foreign-${agent}`, headlessContext(cwd));
		assert.equal(result.status, "blocked");
		assert.equal(result.outcome, "native-mutation-status-reconciled");
		assert.equal("consent" in result, false, `${agent} v3 consent must not reach the user`);
		assert.equal("consent_binding" in result, false, `${agent} v3 consent must not create a Pi answer binding`);
		assert.equal(starts, 1, `${agent} v3 response follows the one negotiated Pi START attempt`);
		assert.deepEqual(answers, [], `${agent} v3 invocation must never be answered by Pi`);
	}
});

test("typed Pi transport refusal relays agentless v3 consent and keeps granted and declined reconciliation agentless", async (t) => {
	for (const answer of ["granted", "declined"] as const) {
		const cwd = repository(t);
		const consent = foreignOrUnboundV3Consent(cwd, "unbound");
		const { native } = fakeOrganicNative();
		const targetStatus = native.targetStatus!;
		const statusAgents: Array<string | undefined> = [];
		const startRequests: NativeStartRequest[] = [];
		const answerRequests: NativeReviewConsentAnswerRequest[] = [];
		native.targetStatus = async (request) => {
			statusAgents.push(request.agent);
			if (request.agent === "pi") {
				throw new NativeReviewIntegrationError({
					schema: "gentle-ai.review-integration.failure/v2",
					contract: "gentle-ai.review-integration/v2",
					operation: "review.status",
					phase: "pre_native",
					code: "unsupported_agent",
					message: "Pi transport is unsupported",
					mutationOutcome: "none",
					authorityApplicability: "current_target",
					retrySafe: true,
					replayability: "not_replayable",
					nextAction: "stop",
					raw: {},
				} as never);
			}
			return targetStatus(request);
		};
		native.start = async (request) => {
			startRequests.push(request);
			throw new NativeReviewConsentRequiredError(consent);
		};
		native.answerConsent = async (request) => {
			answerRequests.push(request);
			throw Object.assign(new Error("ambiguous consent answer"), { mutationOutcome: "unknown", nextAction: "review.status" });
		};

		const controller = runtime(native).controller;
		const blocked = await blockedConsent(controller, `agentless-${answer}`, headlessContext(cwd));
		assert.deepEqual(blocked.consent, consent.raw, "the complete agentless Pi envelope must reach the relay");
		assert.deepEqual(statusAgents, ["pi", undefined], "typed Pi refusal retries only the START STATUS agentless");
		await answerConsent(controller, blocked.consent_binding, answer, headlessContext(cwd));
		assert.equal(startRequests[0]?.agent, undefined, "the fallback START stays agentless");
		assert.equal(answerRequests.length, 1, "the exact provider answer is submitted once");
		assert.equal(answerRequests[0]?.startAgent, undefined, "answer validation receives the selected agentless transport");
		assert.deepEqual(answerRequests[0]?.consent.choices, consent.choices, "Pi replays the provider-owned choices without rewriting them");
		assert.equal(answerRequests[0]?.consent.choices.some((choice) => /(?:^| )--agent(?:=| )/.test(choice.invocation)), false, "Pi must not synthesize --agent into agentless choices");
		assert.deepEqual(statusAgents, ["pi", undefined, undefined], "ambiguous reconciliation must retain the agentless fallback transport");
	}
});

test("pending consent bindings do not dedupe across Pi and agentless START transports", async (t) => {
	const cwd = repository(t);
	const consent = foreignOrUnboundV3Consent(cwd, "unbound");
	for (const choice of consent.choices) choice.invocation = choice.invocation.replace(" --consent ", " --agent pi --consent ");
	(consent.raw as { choices: unknown }).choices = consent.choices.map((choice) => ({ ...choice }));
	const { native } = fakeOrganicNative();
	const targetStatus = native.targetStatus!;
	const startRequests: NativeStartRequest[] = [];
	const answerRequests: NativeReviewConsentAnswerRequest[] = [];
	let piStatusCalls = 0;
	native.targetStatus = async (request) => {
		if (request.agent === "pi" && piStatusCalls++ > 0) {
			throw new NativeReviewIntegrationError({
				schema: "gentle-ai.review-integration.failure/v2",
				contract: "gentle-ai.review-integration/v2",
				operation: "review.status",
				phase: "pre_native",
				code: "unsupported_agent",
				message: "Pi transport is unsupported",
				mutationOutcome: "none",
				authorityApplicability: "current_target",
				retrySafe: true,
				replayability: "not_replayable",
				nextAction: "stop",
				raw: {},
			} as never);
		}
		return targetStatus(request);
	};
	native.start = async (request) => {
		startRequests.push(request);
		throw new NativeReviewConsentRequiredError(consent);
	};
	native.answerConsent = async (request) => {
		answerRequests.push(request);
		return {
			kind: "declined",
			targetIdentity: consent.targetIdentity,
			projection: consent.projection,
			riskLevel: consent.riskLevel,
			changedFiles: 1,
			changedLines: 1,
			consent: "declined_this_candidate",
			raw: { operation: "review/start", action: "declined", consent: "declined_this_candidate" },
		};
	};

	const controller = runtime(native).controller;
	const context = headlessContext(cwd);
	const piBinding = await blockedConsent(controller, "pending-pi", context);
	const agentlessBinding = await blockedConsent(controller, "pending-agentless", context);
	assert.notEqual(piBinding.consent_binding, agentlessBinding.consent_binding, "a fallback route must replace, not reuse, the Pi-bound pending consent");
	assert.deepEqual(startRequests.map((request) => request.agent), ["pi", undefined]);
	await assert.rejects(() => answerConsent(controller, piBinding.consent_binding, "granted", context), /unknown, expired, or already consumed/);
	await answerConsent(controller, agentlessBinding.consent_binding, "declined", context);
	assert.equal(answerRequests[0]?.startAgent, undefined, "the surviving binding retains the fallback transport");
});

test("consent relay returns the identical complete parent-visible envelope with or without UI and never answers internally", async (t) => {
	const cwd = repository(t);
	recordReviewConsentLatch(cwd);
	for (const ctx of [
		{ cwd, hasUI: true, ui: { select: async () => { throw new Error("internal consent UI must not run"); }, notify: () => {} } } as unknown as ExtensionContext,
		headlessContext(cwd),
	]) {
		const { native, answers } = relayedConsentNative(cwd);
		const result = await blockedConsent(runtime(native).controller, "consent-blocked", ctx);
		assert.deepEqual(result.consent, candidateConsent(cwd).raw);
		assert.deepEqual(answers, []);
		assert.equal(result.lineage_created, false);
	}
});

test("explicit consent follow-up grants or declines exactly once", async (t) => {
	for (const answer of ["granted", "declined"] as const) {
		const repositoryCwd = repository(t);
		const cwd = `${repositoryCwd}-alias`;
		symlinkSync(repositoryCwd, cwd, process.platform === "win32" ? "junction" : "dir");
		t.after(() => rmSync(cwd, { force: true }));
		const canonicalCwd = realpathSync(cwd);
		assert.equal(readReviewConsentLatch(cwd), false);
		const { native, answers, startRequests, answerRequests } = relayedConsentNative(canonicalCwd);
		const { controller } = runtime(native);
		const blocked = await blockedConsent(controller, `consent-${answer}`, headlessContext(cwd));
		const result = await answerConsent(controller, blocked.consent_binding, answer, headlessContext(cwd));
		assert.deepEqual(answers, [answer]);
		assert.equal(startRequests.length, 1);
		assert.equal(startRequests[0]?.cwd, canonicalCwd);
		assert.equal(startRequests[0]?.targetIdentity, candidateConsent(canonicalCwd).targetIdentity);
		assert.equal(startRequests[0]?.projection, "workspace");
		assert.equal(answerRequests.length, 1);
		assert.equal(answerRequests[0]?.cwd, canonicalCwd);
		assert.equal(answerRequests[0]?.consent.targetIdentity, startRequests[0]?.targetIdentity);
		if (answer === "granted") {
			const actorBinding = result.actor_binding as { workspace_root: string; candidate_root: string };
			assert.equal(actorBinding.workspace_root, canonicalCwd);
			assert.notEqual(actorBinding.candidate_root, canonicalCwd);
			assert.equal(readReviewConsentLatch(cwd), true);
		} else {
			assert.equal(result.outcome, "consent-declined-this-candidate");
			assert.equal(result.lineage_created, false);
			assert.equal("actor_binding" in result, false);
			assert.equal("result" in result, false);
			assert.equal(readReviewConsentLatch(cwd), false);
		}
		await assert.rejects(() => answerConsent(controller, blocked.consent_binding, answer, headlessContext(cwd)), /unknown, expired, or already consumed/);
	}
});

test("same-session registrations continue a pending consent exactly once through the registry that owns its candidate view", async (t) => {
	const cwd = repository(t);
	const sharedRegistry = new PendingReviewConsentRegistry();
	const sessionId = "same-session-pending-consent";
	const { native, consent, answers, answerRequests } = relayedConsentNative(cwd);
	const registrationA = runtime(native, recordReviewConsentLatch, undefined, { pendingReviewConsentRegistry: sharedRegistry });
	const registrationB = runtime(native, recordReviewConsentLatch, undefined, { pendingReviewConsentRegistry: sharedRegistry });
	const context = headlessContext(cwd, [], sessionId);
	const blocked = await blockedConsent(registrationA.controller, "same-session-a", context);
	const result = await answerConsent(registrationB.controller, blocked.consent_binding, "granted", context);

	assert.deepEqual(answers, ["granted"]);
	assert.equal(answerRequests.length, 1);
	assert.equal(answerRequests[0]?.consent, consent, "the second registration must forward A's original native consent");
	assert.ok(result.result);
	await assert.rejects(() => answerConsent(registrationB.controller, blocked.consent_binding, "granted", context), /unknown, expired, or already consumed/);
});

test("a different Pi session cannot answer another session's pending consent binding", async (t) => {
	const cwd = repository(t);
	const sharedRegistry = new PendingReviewConsentRegistry();
	const { native, answers } = relayedConsentNative(cwd);
	const registrationA = runtime(native, recordReviewConsentLatch, undefined, { pendingReviewConsentRegistry: sharedRegistry });
	const registrationB = runtime(native, recordReviewConsentLatch, undefined, { pendingReviewConsentRegistry: sharedRegistry });
	const sessionA = headlessContext(cwd, [], "session-a");
	const sessionB = headlessContext(cwd, [], "session-b");
	const blocked = await blockedConsent(registrationA.controller, "cross-session-a", sessionA);

	await assert.rejects(() => answerConsent(registrationB.controller, blocked.consent_binding, "granted", sessionB), /unknown, expired, or already consumed/);
	assert.deepEqual(answers, [], "a foreign session cannot reach native answerConsent");
	const ownSessionBinding = await blockedConsent(registrationB.controller, "cross-session-b", sessionB);
	const shutdown = registrationA.events.get("session_shutdown");
	assert.ok(shutdown);
	await shutdown({}, sessionA);
	const result = await answerConsent(registrationB.controller, ownSessionBinding.consent_binding, "granted", sessionB);
	assert.ok(result.result, "shutting down session A must not clear session B's pending binding");
});

test("session shutdown removes the shared pending binding and cleans its original candidate view", async (t) => {
	const cwd = repository(t);
	const sharedRegistry = new PendingReviewConsentRegistry();
	const candidateViews = new CandidateViewRegistry();
	let cleanupCalls = 0;
	const cleanup = candidateViews.cleanup.bind(candidateViews);
	candidateViews.cleanup = (token: string) => {
		cleanupCalls += 1;
		cleanup(token);
	};
	const { native, answers } = relayedConsentNative(cwd);
	const registrationA = runtime(native, recordReviewConsentLatch, undefined, { candidateViews, pendingReviewConsentRegistry: sharedRegistry });
	const registrationB = runtime(native, recordReviewConsentLatch, undefined, { pendingReviewConsentRegistry: sharedRegistry });
	const context = headlessContext(cwd, [], "shutdown-session");
	const blocked = await blockedConsent(registrationA.controller, "shutdown-a", context);
	const shutdown = registrationA.events.get("session_shutdown");
	assert.ok(shutdown);
	await shutdown({}, context);

	await assert.rejects(() => answerConsent(registrationB.controller, blocked.consent_binding, "granted", context), /unknown, expired, or already consumed/);
	assert.deepEqual(answers, []);
	assert.equal(cleanupCalls, 1, "shutdown must clean the candidate view materialized by registration A exactly once");
});

test("granted consent preserves the completed native start when local latch persistence fails", async (t) => {
	const cwd = repository(t);
	const { native, answers } = relayedConsentNative(cwd);
	const notices: Array<{ message: string; type?: string }> = [];
	let latchWrites = 0;
	const { controller } = runtime(native, () => {
		latchWrites += 1;
		throw new Error("injected consent latch failure");
	});
	const blocked = await blockedConsent(controller, "consent-latch-failure", headlessContext(cwd, notices));
	const result = await answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd, notices));

	assert.deepEqual(answers, ["granted"]);
	assert.equal(latchWrites, 1);
	assert.deepEqual(result.result, { lineage_id: "native-lineage", state: "reviewing", risk_tier: "high", selected_lenses: ["review-risk", "review-resilience", "review-readability", "review-reliability"], changed_files: 1, original_changed_lines: 1, correction_budget: 1, action: "created", lenses_required: true });
	assert.equal((result.actor_binding as { workspace_root: string }).workspace_root, realpathSync(cwd));
	assert.equal(readReviewConsentLatch(cwd), false);
	assert.equal(notices.length, 1);
	assert.equal(notices[0]?.type, "warning");
	assert.match(notices[0]?.message ?? "", /native review start completed, but Pi could not record the local consent latch/i);
});

// Issue #247: a local binding mismatch was indistinguishable from a provider
// outage, so the reporter diagnosed a missing --cwd that Pi does forward.
test("a consent binding mismatch surfaces as an actionable local failure, not an opaque native operation failure", async (t) => {
	const cwd = repository(t);
	const { native, answers } = relayedConsentNative(cwd);
	native.answerConsent = async () => {
		throw new NativeReviewConsentBindingError("consent-invocation-cwd-changed", "Native consent invocation repository binding changed");
	};
	const { controller } = runtime(native);
	const blocked = await blockedConsent(controller, "consent-binding", headlessContext(cwd));
	const result = await answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd));
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "consent-binding-invalid");
	assert.deepEqual(result.diagnostics, { code: "consent-invocation-cwd-changed", message: "Native consent invocation repository binding changed" });
	assert.equal(result.native_invocation_attempted, false);
	assert.equal(result.lineage_created, false);
	assert.equal(result.mutation_performed, false);
	assert.equal(result.mutation_outcome, "none");
	assert.equal(result.next_action, "resolve-consent-binding");
	assert.deepEqual(answers, []);
	assert.equal(readReviewConsentLatch(cwd), false);
});

test("consent follow-up rejects invalid token, unknown id, changed cwd, and changed target binding", async (t) => {
	const cwd = repository(t);
	const consent = candidateConsent(cwd);
	const { native, answers } = relayedConsentNative(cwd);
	native.start = async () => { throw new NativeReviewConsentRequiredError(consent); };
	const { controller } = runtime(native);
	const blocked = await blockedConsent(controller, "consent-invalid", headlessContext(cwd));
	await assert.rejects(() => controller.execute("malformed", { operation: "answer-consent", input: "not-json" }, undefined, undefined, headlessContext(cwd)), /input is not valid JSON/);
	await assert.rejects(() => controller.execute("extra", { operation: "answer-consent", input: JSON.stringify({ consentBinding: blocked.consent_binding, answer: "granted", target: "substitute" }) }, undefined, undefined, headlessContext(cwd)), /exactly consentBinding and answer/);
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "yes", headlessContext(cwd)), /answer must be granted or declined/);
	await assert.rejects(() => answerConsent(controller, "missing", "granted", headlessContext(cwd)), /unknown, expired, or already consumed/);
	const other = repository(t);
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(other)), /repository binding changed/);
	const originalTarget = consent.targetIdentity;
	(consent as { targetIdentity: string }).targetIdentity = `sha256:${"b".repeat(64)}`;
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd)), /consent envelope binding changed/);
	(consent as { targetIdentity: string }).targetIdentity = originalTarget;
	(consent as { projection: string }).projection = "staged";
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd)), /consent envelope binding changed/);
	(consent as { projection: string }).projection = "workspace";
	(consent.choices[0] as { invocation: string }).invocation = consent.choices[0].invocation.replace("native-lineage", "changed-lineage");
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd)), /consent envelope binding changed/);
	assert.deepEqual(answers, []);
	assert.equal(readReviewConsentLatch(cwd), false);
});

test("unavailable consent follow-up leaves the clone latch unset", async (t) => {
	const cwd = repository(t);
	const { native } = relayedConsentNative(cwd);
	delete native.answerConsent;
	const { controller } = runtime(native);
	const blocked = await blockedConsent(controller, "consent-unavailable", headlessContext(cwd));
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd)), /consent follow-up is unavailable/);
	assert.equal(readReviewConsentLatch(cwd), false);
});

test("ambiguous consent mutation consumes the one-shot binding and requires status instead of blind replay", async (t) => {
	const cwd = repository(t);
	const { native } = relayedConsentNative(cwd);
	let statusCalls = 0;
	const targetStatus = native.targetStatus!;
	native.targetStatus = async (request) => { statusCalls += 1; return await targetStatus(request); };
	native.answerConsent = async () => { throw Object.assign(new Error("ambiguous"), { mutationOutcome: "unknown", nextAction: "review.status" }); };
	const { controller } = runtime(native);
	const blocked = await blockedConsent(controller, "consent-ambiguous", headlessContext(cwd));
	await answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd));
	assert.equal(statusCalls, 2, "ambiguous consent must reconcile through target status");
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd)), /unknown, expired, or already consumed/);
	assert.equal(readReviewConsentLatch(cwd), false);
});

test("session shutdown clears pending candidate consent bindings and is idempotent", async (t) => {
	const cwd = repository(t);
	const { native, answers, startRequests } = relayedConsentNative(cwd);
	const { controller, events } = runtime(native);
	const blocked = await blockedConsent(controller, "consent-before-shutdown", headlessContext(cwd));
	const shutdown = events.get("session_shutdown");
	assert.ok(shutdown);
	await shutdown({}, headlessContext(cwd));
	await shutdown({}, headlessContext(cwd));
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd)), /unknown, expired, or already consumed/);
	assert.deepEqual(answers, []);
	const afterShutdown = await blockedConsent(controller, "consent-after-shutdown", headlessContext(cwd));
	assert.notEqual(afterShutdown.consent_binding, blocked.consent_binding, "the same candidate gets a fresh binding after shutdown cleanup");
	assert.equal(startRequests.length, 2, "shutdown loss requires a fresh native START instead of local replay");
});

test("extension reload gives the same candidate a fresh consent binding instead of replaying lost local state", async (t) => {
	// The runtime helper injects a fresh registry for each call, which models a
	// cache-busted module reload. Same-loaded-module factory registrations use
	// the shared-registry path exercised above instead.
	const cwd = repository(t);
	const { native, startRequests } = relayedConsentNative(cwd);
	const beforeReload = await blockedConsent(runtime(native).controller, "consent-before-reload", headlessContext(cwd));
	const afterReload = await blockedConsent(runtime(native).controller, "consent-after-reload", headlessContext(cwd));
	assert.notEqual(afterReload.consent_binding, beforeReload.consent_binding);
	assert.equal(startRequests.length, 2, "reload loss requires a fresh native START instead of local replay");
});

test("successful explicit disable clears pending candidate consent binding even after re-enable", async (t) => {
	const cwd = repository(t);
	const { native, answers } = relayedConsentNative(cwd);
	let effective: "on" | "off" = "on";
	native.reviewMode = async (request) => {
		if (request.operation === "disable") effective = "off";
		if (request.operation === "enable") effective = "on";
		return { operation: request.operation, scope: "clone", status: { global: "", cloneLocal: effective === "off" ? "off" : "", effective, source: effective === "off" ? "clone_local" : "default" } };
	};
	const { controller, commands } = runtime(native);
	const blocked = await blockedConsent(controller, "consent-before-disable", headlessContext(cwd));
	const command = commands.get("gentle:review-mode")!;
	await command.handler("disable", headlessContext(cwd));
	await command.handler("enable", headlessContext(cwd));
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd)), /unknown, expired, or already consumed/);
	assert.deepEqual(answers, []);
});

// Issue #264: an unused consent binding and the candidate view retained
// exclusively for that binding must expire as one lifecycle unit before any
// later START may reuse the view. Cleanup is synchronous with respect to the
// observable TTL; the queued cleanup macrotask is a safety net, not the
// authority, so a fresh-candidate retry after expiry must get a new binding
// rather than tripping candidate-target-projection-drift on a stale view.
const REVIEW_CONSENT_TTL_MS = 10 * 60 * 1000;

function fakeConsentClock(): { now: () => number; scheduleTimer: (callback: () => void, delayMs: number) => { unref: () => void }; advance: (ms: number) => void; scheduled: Array<() => void> } {
	const start = Date.now();
	let nowMs = start;
	const scheduled: Array<() => void> = [];
	return {
		now: () => nowMs,
		// Never fires the callback: simulates a queued cleanup macrotask that
		// has not yet gotten a turn on the event loop.
		scheduleTimer: (callback) => { scheduled.push(callback); return { unref: () => {} }; },
		advance: (ms) => { nowMs = start + ms; },
		scheduled,
	};
}

test("an expired unused binding prunes synchronously so a fresh-candidate retry gets a new binding, not candidate-target-projection-drift", async (t) => {
	const cwd = repository(t);
	const { native, startRequests } = relayedConsentNative(cwd);
	const clock = fakeConsentClock();
	const { controller } = runtime(native, recordReviewConsentLatch, { now: clock.now, scheduleTimer: clock.scheduleTimer });
	// First START: consent-required, binding T1 retained with a queued cleanup timer.
	const first = await blockedConsent(controller, "expired-fresh-1", headlessContext(cwd));
	const firstBinding = first.consent_binding;
	assert.equal(clock.scheduled.length, 1, "the TTL cleanup macrotask is queued for T1");
	// The candidate changes: a later START on a FRESH candidate must not reuse T1.
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	// Advance time to the exact TTL boundary without letting the queued cleanup macrotask fire.
	clock.advance(REVIEW_CONSENT_TTL_MS);
	assert.equal(clock.scheduled.length, 1, "the queued cleanup macrotask has not fired");
	const second = await execStart(controller, "expired-fresh-2", headlessContext(cwd));
	// The fix: a fresh consent-required binding, not candidate-target-projection-drift.
	assert.equal(second.status, "blocked");
	assert.equal(second.outcome, "native-review-consent-required", "the stale view must not trip candidate-target-projection-drift");
	assert.equal(typeof second.consent_binding, "string");
	assert.notEqual(second.consent_binding, firstBinding, "a fresh candidate gets a fresh binding, not the stale one");
	assert.equal(startRequests.length, 2, "native start was attempted for both candidates");
	assert.equal(clock.scheduled.length, 2, "the fresh binding queued its own cleanup macrotask");
});

test("an expired same-candidate consent request creates a fresh binding instead of replaying local state", async (t) => {
	const cwd = repository(t);
	const { native, startRequests } = relayedConsentNative(cwd);
	const clock = fakeConsentClock();
	const { controller } = runtime(native, recordReviewConsentLatch, { now: clock.now, scheduleTimer: clock.scheduleTimer });
	const first = await blockedConsent(controller, "same-candidate-expired-1", headlessContext(cwd));
	clock.advance(REVIEW_CONSENT_TTL_MS);
	const second = await blockedConsent(controller, "same-candidate-expired-2", headlessContext(cwd));
	assert.notEqual(second.consent_binding, first.consent_binding);
	assert.equal(startRequests.length, 2, "expiry requires a fresh native START instead of local replay");
	assert.equal(clock.scheduled.length, 2, "the fresh binding queues its own cleanup macrotask");
});

test("a non-expired same-candidate consent request reuses the same binding instead of creating a new one", async (t) => {
	const cwd = repository(t);
	const { native } = relayedConsentNative(cwd);
	const clock = fakeConsentClock();
	const { controller } = runtime(native, recordReviewConsentLatch, { now: clock.now, scheduleTimer: clock.scheduleTimer });
	const first = await blockedConsent(controller, "dedup-1", headlessContext(cwd));
	// Same candidate, same consent, still within TTL: the existing binding is reused.
	const second = await blockedConsent(controller, "dedup-2", headlessContext(cwd));
	assert.equal(second.consent_binding, first.consent_binding, "a non-expired same-candidate request deduplicates the binding");
	assert.equal(clock.scheduled.length, 1, "no new cleanup macrotask is queued when the binding is reused");
});

test("an expired consent binding is rejected on answer-consent even before the queued cleanup macrotask fires", async (t) => {
	const cwd = repository(t);
	const { native } = relayedConsentNative(cwd);
	const clock = fakeConsentClock();
	const { controller } = runtime(native, recordReviewConsentLatch, { now: clock.now, scheduleTimer: clock.scheduleTimer });
	const blocked = await blockedConsent(controller, "expired-answer-1", headlessContext(cwd));
	// Advance to the exact TTL boundary without firing the queued cleanup macrotask.
	clock.advance(REVIEW_CONSENT_TTL_MS);
	assert.equal(clock.scheduled.length, 1, "the queued cleanup macrotask has not fired");
	await assert.rejects(() => answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd)), /unknown, expired, or already consumed/);
	assert.equal(clock.scheduled.length, 1, "rejection was synchronous from the TTL observation, not from a fired macrotask");
});

test("candidate-scoped decline creates no authority and the next candidate asks again", async (t) => {
	const cwd = repository(t);
	const { native, answers } = relayedConsentNative(cwd);
	const { controller } = runtime(native);
	for (const id of ["decline-one", "decline-two"]) {
		const blocked = await blockedConsent(controller, id, headlessContext(cwd));
		const result = await answerConsent(controller, blocked.consent_binding, "declined", headlessContext(cwd));
		assert.equal(result.outcome, "consent-declined-this-candidate");
		assert.equal(result.lineage_created, false);
		assert.equal("actor_binding" in result, false);
		assert.equal("result" in result, false);
		assert.equal(readReviewConsentLatch(cwd), false);
	}
	assert.deepEqual(answers, ["declined", "declined"]);
});

// Upstream gentle-ai.review-integration.consent/v3 consent is per-candidate:
// the clone-local latch records only that the one-time question was already
// put to the user, never that any later candidate is pre-approved. A fresh
// START with the latch already recorded must still relay the complete
// blocking envelope, and only an explicit ANSWER_CONSENT may resolve it.
test("a pre-recorded consent latch never suppresses a later candidate's consent envelope or auto-answers it", async (t) => {
	const cwd = repository(t);
	recordReviewConsentLatch(cwd);
	assert.equal(readReviewConsentLatch(cwd), true);
	const { native, answers, startRequests } = relayedConsentNative(cwd);
	const { controller } = runtime(native);
	const blocked = await blockedConsent(controller, "consent-latched-fresh-start", headlessContext(cwd));
	assert.deepEqual(blocked.consent, candidateConsent(cwd).raw, "the full consent envelope is relayed despite the pre-recorded latch");
	assert.deepEqual(answers, [], "the latch must never auto-answer a later candidate's consent");
	assert.equal(blocked.lineage_created, false);
	assert.equal(startRequests.length, 1);
	const result = await answerConsent(controller, blocked.consent_binding, "granted", headlessContext(cwd));
	assert.deepEqual(answers, ["granted"], "explicit ANSWER_CONSENT is still required to proceed");
	assert.ok(result.result);
});

test("low-risk zero-lens START remains silent", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: undefined, lensesRequired: false });
	const { controller } = runtime(native);
	let selected = false;
	const ctx = { cwd, hasUI: true, ui: { select: async () => { selected = true; return undefined; }, notify: () => {} } } as unknown as ExtensionContext;
	const result = await execStart(controller, "consent-low-risk", ctx);
	assert.equal(selected, false);
	assert.ok(result.result);
});

// ---------------------------------------------------------------------------
// Phase 5 (tier/hint/delivery passthrough): mapNativeStartResult renders
// risk_tier/risk_evidence/hint verbatim from the native start result, with
// zero local derivation (Design Decision #8, organic-rdd-parity).
// ---------------------------------------------------------------------------

test("mapNativeStartResult passes risk_evidence through verbatim as the native phrase array, alongside the unmodified risk_tier passthrough", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: ["shell scripting in .github/workflows/deploy.yml"] });
	const { controller } = runtime(native);
	const result = await execStart(controller, "risk-evidence-passthrough", confirmContext(cwd, true));
	const rendered = result.result as Record<string, unknown>;
	assert.equal(rendered.risk_tier, "high", "risk_tier is native's riskLevel, verbatim, with no local recomputation");
	assert.deepEqual(rendered.risk_evidence, ["shell scripting in .github/workflows/deploy.yml"]);
});

test("mapNativeStartResult surfaces the empty-candidate hint verbatim and omits risk_evidence when the native result carries none", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({
		lensesRequired: false,
		riskEvidence: undefined,
		hint: "the candidate has no pending changes; already-committed work can be reviewed by rerunning review start with --base-ref <commit> naming the base to compare against",
	});
	const { controller } = runtime(native);
	const result = await execStart(controller, "hint-passthrough", headlessContext(cwd));
	const rendered = result.result as Record<string, unknown>;
	assert.equal(rendered.hint, "the candidate has no pending changes; already-committed work can be reviewed by rerunning review start with --base-ref <commit> naming the base to compare against");
	assert.equal(rendered.risk_evidence, undefined, "no local risk_evidence is ever fabricated when the native result omits it");
});

test("mapNativeStartResult never fabricates risk_evidence or hint when the native result omits both", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: undefined });
	const { controller } = runtime(native);
	const result = await execStart(controller, "no-evidence-no-hint", confirmContext(cwd, true));
	const rendered = result.result as Record<string, unknown>;
	assert.equal(rendered.risk_evidence, undefined);
	assert.equal(rendered.hint, undefined);
});

test("gentle:review-mode command reports status, disables, and enables through explicit user invocation", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeEffective: "off" });
	const { commands } = runtime(native);
	const command = commands.get("gentle:review-mode");
	assert.ok(command, "gentle:review-mode must be registered");
	const notices: Array<{ message: string; type?: string }> = [];
	await command!.handler("status", headlessContext(cwd, notices) as unknown as ExtensionContext);
	assert.ok(notices.at(-1)?.message.includes("off"));
});

// Ground-truthed against a real gentle-ai build: with the global source off,
// `review mode enable --scope clone` exits 0, reports operation "enable", and
// leaves effective "off" — because cloneLocalRDDOverrideValue maps "on" onto
// "inherit" and a clone-local override may only ever disable. Pi hard-codes
// --scope clone by design, so this request can never succeed; reporting the
// bare status would let the user believe /gentle:review-mode enable is the way
// back on when it is a dead end.
test("gentle:review-mode: an enable that cannot take effect says so and names the command that can", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeEffective: "off", reviewModeSource: "global" });
	const { commands } = runtime(native);
	const command = commands.get("gentle:review-mode")!;
	const notices: Array<{ message: string; type?: string }> = [];
	await command.handler("enable", headlessContext(cwd, notices) as unknown as ExtensionContext);
	const notice = notices.at(-1)!;
	assert.equal(notice.type, "warning", "a request that did not take effect is not an informational result");
	assert.equal(
		notice.message,
		"receipt-driven development: off (decided by global)\nThat did not turn reviews back on: /gentle:review-mode enable only clears a clone-local override, which cannot override a global off. Run `gentle-ai review mode enable --scope=global` to turn them back on.",
	);
});

test("gentle:review-mode: an enable that does take effect keeps the existing informational report", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeEffective: "on", reviewModeSource: "default" });
	const { commands } = runtime(native);
	const command = commands.get("gentle:review-mode")!;
	const notices: Array<{ message: string; type?: string }> = [];
	await command.handler("enable", headlessContext(cwd, notices) as unknown as ExtensionContext);
	assert.deepEqual(notices, [{ message: "receipt-driven development: on (decided by default)", type: "info" }]);
});

test("gentle:review-mode command reports unavailability without throwing when the capability is dark", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeCapable: false });
	const { commands } = runtime(native);
	const command = commands.get("gentle:review-mode")!;
	const notices: Array<{ message: string; type?: string }> = [];
	await command.handler("status", headlessContext(cwd, notices) as unknown as ExtensionContext);
	assert.equal(notices.length, 1);
});
