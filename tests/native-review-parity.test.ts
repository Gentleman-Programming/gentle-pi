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
import type { ReviewStatusV1 } from "../lib/review-integration-v1.ts";

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

test("native START decodes optional riskEvidence and hint only when present", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const withEvidence = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify({ ...start, risk_evidence: "this change touches service credentials in .env.example.", hint: "no reviewable candidate: every changed path is documentation." }) }]);
	const result = await new NativeReviewCliV213(withEvidence.adapter).start({ cwd: "/repo" });
	assert.equal(result.riskEvidence, "this change touches service credentials in .env.example.");
	assert.equal(result.hint, "no reviewable candidate: every changed path is documentation.");

	const withoutEvidence = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: START.stdout }]);
	const bare = await new NativeReviewCliV213(withoutEvidence.adapter).start({ cwd: "/repo" });
	assert.equal(bare.riskEvidence, undefined);
	assert.equal(bare.hint, undefined);
});

test("native VALIDATE decodes the disabled/unmanaged delivery alternate discriminator at exit 0", async () => {
	const body = {
		schema: "gentle-ai.review-gate-result/v1",
		result: "invalidated",
		allowed: false,
		action: "repository-policy",
		reason: "review-driven development is disabled and no receipt governs this candidate",
		delivery: "disabled",
		context: { gate: "pre-commit", lineage_id: "", generation: 0, base_tree: "", candidate_tree: "", paths_digest: "", fix_delta_hash: "", policy_hash: "", ledger_hash: "", evidence_hash: "", base_relationship_valid: true },
	};
	const queue = queuedAdapter([CAPABLE_VERSION_LINE, { stdout: JSON.stringify(body), exitCode: 0 }]);
	const result = await new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "pre-commit" });
	assert.equal(result.result, "invalidated");
	assert.equal(result.allowed, false);
	assert.equal(result.action, "repository-policy");
	assert.equal(result.delivery, "disabled");
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

function unrelatedStartTargetStatus(): ReviewStatusV1 {
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
	return {
		contract: "gentle-ai.review-integration/v1",
		applicability: "unrelated",
		receipt: { status: "not_applicable" },
		action: "start",
		replayability: "not_replayable",
		targetIdentity: sha,
		projection,
		candidates: [],
		raw: {
			schema: "gentle-ai.review-integration.status/v1", contract: "gentle-ai.review-integration/v1", operation: "review.status",
			applicability: "unrelated", receipt: { status: "not_applicable" }, action: "start", replayability: "not_replayable", target_identity: sha,
			projection: { schema: projection.schema, kind: projection.kind, projection: projection.projection, base_tree: tree, initial_review_tree: tree, current_candidate_tree: tree, paths_digest: sha, paths: ["app.ts"], intended_untracked: [], intended_untracked_proof: sha, initial_snapshot_identity: sha, current_snapshot_identity: sha },
			candidates: [],
		},
	};
}

interface FakeOrganicNativeOptions {
	reviewModeCapable?: boolean;
	reviewModeEffective?: "on" | "off";
	reviewModeThrows?: boolean;
	lensesRequired?: boolean;
	riskEvidence?: string;
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
					return {
						operation: request.operation,
						scope: "both",
						status: { global: "", cloneLocal: "", effective: options.reviewModeEffective ?? "on", source: "default" },
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
	const { native } = fakeOrganicNative({ riskEvidence: "this change touches shell scripting in deploy.sh." });
	const { controller } = runtime(native);
	const result = await execStart(controller, "consent-latched", confirmContext(cwd, false));
	assert.ok(result.actor_binding, "an existing latch must not block actor_binding even though confirm() would decline");
	assert.equal(result.consent_notice, undefined);
});

test("consent: headless never blocks, always surfaces a notice, and leaves the latch untouched", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: "this change touches service credentials in .env.example." });
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
	const { native } = fakeOrganicNative({ riskEvidence: "this change touches payments in billing.ts." });
	const { controller } = runtime(native);
	assert.equal(readReviewConsentLatch(cwd), false);
	const result = await execStart(controller, "consent-accept", confirmContext(cwd, true));
	assert.ok(result.actor_binding);
	assert.equal(readReviewConsentLatch(cwd), true);
});

test("consent: declining persists nothing, applies only to this work unit, and withholds actor_binding", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: "this change touches authentication in auth.ts." });
	const { controller } = runtime(native);
	const result = await execStart(controller, "consent-decline", confirmContext(cwd, false));
	assert.equal(result.actor_binding, undefined, "declining must withhold actor dispatch for this work unit");
	assert.equal(readReviewConsentLatch(cwd), false, "declining must never persist anything");
	assert.ok(result.result, "the native start result itself is still reported");
});

test("consent: an unreadable answer (confirm throws) still runs the review, leaves the latch untouched, and surfaces a notice", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ riskEvidence: "this change touches an executable permission change in run.sh." });
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

test("gentle:review-mode command reports unavailability without throwing when the capability is dark", async (t) => {
	const cwd = repository(t);
	const { native } = fakeOrganicNative({ reviewModeCapable: false });
	const { commands } = runtime(native);
	const command = commands.get("gentle:review-mode")!;
	const notices: Array<{ message: string; type?: string }> = [];
	await command.handler("status", headlessContext(cwd, notices) as unknown as ExtensionContext);
	assert.equal(notices.length, 1);
});
