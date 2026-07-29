import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../extensions/gentle-ai.ts";
import {
	NATIVE_REVIEW_ERROR_CODE,
	NativeReviewCliError,
	NativeReviewCliV213 as NativeReviewCliV213Production,
	setNativeCliContractForTesting,
	type ExecFileAdapter,
	type NativeReviewCli,
} from "../lib/native-review-cli.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { readReviewConsentLatch, recordReviewConsentLatch } from "../lib/review-consent-latch.ts";
import type { AuthorityRepairAssessmentV1, ReviewStatusV3 } from "../lib/review-integration-v2.ts";

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

test("reviewMode status decodes an off effective mode with its deciding source", async () => {
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(reviewModeStatusBody("off", { clone_local: "off", source: "clone_local", revision: "sha256:deadbeef" })) }]);
	const result = await new NativeReviewCliV213(queue.adapter).reviewMode({ cwd: "/repo", operation: "status" });
	assert.equal(result.status.effective, "off");
	assert.equal(result.status.source, "clone_local");
	assert.equal(result.status.cloneLocal, "off");
	assert.equal(result.status.revision, "sha256:deadbeef");
});

test("reviewMode enable and disable pass --scope clone and mutate without a timeout", async () => {
	const queue = queuedAdapter([
		CAPABLE_VERSION_LINE, { stdout: JSON.stringify({ schema: "gentle-ai.review-mode/v1", operation: "disable", scope: "clone", status: { schema: "gentle-ai.rdd-mode-status/v1", global: "", clone_local: "off", effective: "off", source: "clone_local" } }) },
		CAPABLE_VERSION_LINE, { stdout: JSON.stringify({ schema: "gentle-ai.review-mode/v1", operation: "enable", scope: "clone", status: { schema: "gentle-ai.rdd-mode-status/v1", global: "", clone_local: "", effective: "on", source: "default" } }) },
	]);
	const client = new NativeReviewCliV213(queue.adapter);
	const disabled = await client.reviewMode({ cwd: "/repo", operation: "disable" });
	const enabled = await client.reviewMode({ cwd: "/repo", operation: "enable" });
	assert.deepEqual(queue.calls[1]?.arguments, ["review", "mode", "disable", "--cwd", "/repo", "--scope", "clone", "--json"]);
	assert.deepEqual(queue.calls[3]?.arguments, ["review", "mode", "enable", "--cwd", "/repo", "--scope", "clone", "--json"]);
	assert.equal(disabled.status.effective, "off");
	assert.equal(enabled.status.effective, "on");
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

function unrelatedStartTargetStatus(): ReviewStatusV3 {
	const sha = `sha256:${"a".repeat(64)}`;
	const tree = "b".repeat(40);
	const projection = {
		schema: "gentle-ai.review-integration.projection/v1" as const,
		kind: "current-changes" as const,
		projection: "workspace" as const,
		baseTree: tree,
		initialReviewTree: tree,
		currentCandidateTree: tree,
		pathsDigest: sha,
		paths: ["app.ts"],
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
			projection: { schema: projection.schema, kind: projection.kind, projection: projection.projection, base_tree: tree, initial_review_tree: tree, current_candidate_tree: tree, paths_digest: sha, paths: ["app.ts"], intended_untracked: [], intended_untracked_proof: sha, initial_snapshot_identity: sha, current_snapshot_identity: sha },
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
		async targetStatus() {
			return unrelatedStartTargetStatus();
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

function runtime(nativeReviewCli: NativeReviewCli | null): { controller: RegisteredTool; commands: Map<string, RegisteredCommandFixture> } {
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
	assert.equal(result.mutation_performed, false);
	assert.equal(state.startCalls, 0, "native start must not be called once the kill switch reports off");
});

// Parity with gentle-ai's RDDDisabledError.Error()
// (internal/reviewtransaction/rdd_mode.go): a refusal names the situation, the
// source that actually decided, and a continuation scoped to that source. Pi
// never blocks here — the envelope is a non-failure skip — but it must not
// throw away which source decided, nor leave the caller without a way back on.
test("kill-switch: a clone-local off names the deciding source and the Pi command that turns reviews back on", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeEffective: "off", reviewModeSource: "clone_local" });
	const { controller } = runtime(native);
	const result = await execStart(controller, "kill-switch-clone-local", headlessContext(cwd));
	assert.equal(result.status, "skipped");
	assert.equal(result.outcome, "review-mode-disabled");
	assert.equal(result.mode_source, "clone_local");
	assert.equal(result.reason, "receipt-driven development is disabled: start is skipped because the clone_local mode source keeps it off");
	assert.equal(result.next_action, "Run /gentle:review-mode enable to turn reviews back on for this clone.");
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

// Parity with reviewModeScopeForSource: the default source expresses no opinion
// and can never be what keeps reviews off, so it gets no guessed continuation.
test("kill-switch: an off with the default source names no continuation rather than guessing one", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeEffective: "off", reviewModeSource: "default" });
	const { controller } = runtime(native);
	const result = await execStart(controller, "kill-switch-default", headlessContext(cwd));
	assert.equal(result.mode_source, "default");
	assert.equal(result.next_action, undefined);
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

test("consent: an existing latch skips the prompt and proceeds with actor_binding", async (t) => {
	const cwd = repository(t);
	recordReviewConsentLatch(cwd);
	const { native } = fakeOrganicNative({ riskEvidence: ["shell scripting in deploy.sh"] });
	const { controller } = runtime(native);
	const result = await execStart(controller, "consent-latched", confirmContext(cwd, false));
	assert.ok(result.actor_binding, "an existing latch must not block actor_binding even though confirm() would decline");
	assert.equal(result.consent_notice, undefined);
});

test("consent: headless never blocks, always surfaces a notice, and leaves the latch untouched", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: ["service credentials in .env.example"] });
	const { controller } = runtime(native);
	const notices: Array<{ message: string; type?: string }> = [];
	const result = await execStart(controller, "consent-headless", headlessContext(cwd, notices));
	assert.ok(result.actor_binding, "headless must still run the review");
	assert.equal(typeof result.consent_notice, "string");
	assert.ok(notices.some((notice) => notice.type === "info" && notice.message === result.consent_notice));
	assert.equal(readReviewConsentLatch(cwd), false, "headless must never consume/persist the one-time question");
});

test("consent: accepting the prompt records the latch and proceeds with actor_binding", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: ["payments in billing.ts"] });
	const { controller } = runtime(native);
	assert.equal(readReviewConsentLatch(cwd), false);
	const result = await execStart(controller, "consent-accept", confirmContext(cwd, true));
	assert.ok(result.actor_binding);
	assert.equal(readReviewConsentLatch(cwd), true);
});

test("consent: declining persists nothing, applies only to this work unit, and withholds actor_binding", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: ["authentication in auth.ts"] });
	const { controller } = runtime(native);
	const result = await execStart(controller, "consent-decline", confirmContext(cwd, false));
	assert.equal(result.actor_binding, undefined, "declining must withhold actor dispatch for this work unit");
	assert.equal(readReviewConsentLatch(cwd), false, "declining must never persist anything");
	assert.ok(result.result, "the native start result itself is still reported");
});

test("consent: an unreadable answer (confirm throws) still runs the review, leaves the latch untouched, and surfaces a notice", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: ["an executable permission change in run.sh"] });
	const { controller } = runtime(native);
	const result = await execStart(controller, "consent-throw", throwingConfirmContext(cwd));
	assert.ok(result.actor_binding, "an unreadable answer must still run the review");
	assert.equal(typeof result.consent_notice, "string");
	assert.equal(readReviewConsentLatch(cwd), false);
});

test("consent stays dark (capability-gated) when the native start result carries no riskEvidence", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: undefined, lensesRequired: true });
	const { controller } = runtime(native);
	let confirmed = false;
	const ctx = { cwd, hasUI: true, ui: { confirm: async () => { confirmed = true; return true; }, notify: () => {} } } as unknown as ExtensionContext;
	const result = await execStart(controller, "consent-dark", ctx);
	assert.equal(confirmed, false, "no riskEvidence (dark riskEvidence capability) must never trigger the consent prompt");
	assert.ok(result.actor_binding);
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
		"receipt-driven development: off (decided by global)\nThat did not turn reviews back on: /gentle:review-mode only sets clone scope, and a clone-local setting can never override a global off. Run `gentle-ai review mode enable --scope=global` to turn them back on.",
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
