import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../extensions/gentle-ai.ts";
import {
	NATIVE_REVIEW_ERROR_CODE,
	NativeReviewCliError,
	NativeReviewCliV214 as NativeReviewCliV214Production,
	type ExecFileAdapter,
	type NativeReviewCli,
} from "../lib/native-review-cli.ts";

// Queued-adapter clients never execute a real process; a fixed absolute
// package-local path keeps these tests independent of an installed binary.
class NativeReviewCliV214 extends NativeReviewCliV214Production {
	constructor(...parameters: ConstructorParameters<typeof NativeReviewCliV214Production>) {
		const [adapter, executable, ...rest] = parameters;
		super(adapter, executable ?? "/package/.gentle-ai/gentle-ai", ...rest);
	}
}

interface QueuedResult { stdout: string; stderr?: string; exitCode?: number; }

function queuedAdapter(results: QueuedResult[]): { adapter: ExecFileAdapter; calls: Array<{ file: string; arguments: readonly string[]; cwd: string }> } {
	const calls: Array<{ file: string; arguments: readonly string[]; cwd: string }> = [];
	return {
		calls,
		adapter: async (request) => {
			calls.push({ file: request.file, arguments: request.arguments, cwd: request.cwd });
			const result = results.shift();
			if (!result) throw new Error("unexpected native invocation");
			return { stdout: result.stdout, stderr: result.stderr ?? "", exitCode: result.exitCode ?? 0, signal: null, timedOut: false, outputLimitExceeded: false };
		},
	};
}

const VERSION_218 = { stdout: "gentle-ai 2.1.8\n" };
const RECLAIM_RECORD = { schema: "gentle-ai.review-reclaim-audit/v1", lineage: "stuck-lineage", actor: "maintainer", reason: "incomplete entry" };
const RECOVER_RECORD = { schema: "gentle-ai.review-recovery/v1", predecessor_lineage: "broken", successor_lineage: "successor" };
const RECONCILE_RECORD = { schema: "gentle-ai.review-reconcile-audit/v1", predecessor_lineage: "predecessor", successor_lineage: "successor", outcome: "quarantined" };
const RECONCILE_AUTHORIZATION = [
	"gentle-ai.review-reconcile-authorization/v1",
	"predecessor_lineage=predecessor",
	"predecessor_revision=predecessor-revision",
	"successor_lineage=successor",
	"successor_revision=successor-revision",
	"actor=maintainer",
	"reason=invalid recovery edge",
].join("\n");

function scratchDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	test.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

interface RecordedNativeCall { operation: "reclaim" | "recover" | "reconcileAuthority"; request: Record<string, unknown>; }

function fakeRecoveryNative(record: Record<string, unknown>): { native: NativeReviewCli; calls: RecordedNativeCall[] } {
	const calls: RecordedNativeCall[] = [];
	const native = {
		async reclaim(request: Record<string, unknown>) {
			calls.push({ operation: "reclaim", request });
			return { record };
		},
		async recover(request: Record<string, unknown>) {
			calls.push({ operation: "recover", request });
			return { record };
		},
		async reconcileAuthority(request: Record<string, unknown>) {
			calls.push({ operation: "reconcileAuthority", request });
			return { record };
		},
	} as unknown as NativeReviewCli;
	return { native, calls };
}

async function runControllerOperation(
	parameters: Record<string, unknown>,
	native: NativeReviewCli | null,
	pendingAuthorizations: Map<string, unknown> = new Map(),
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const cwd = scratchDir("gentle-pi-native-recovery-");
	return await __testing.executeReviewControllerOperation(
		parameters,
		cwd,
		pendingAuthorizations as Map<string, never>,
		native,
		signal,
	);
}

test("native reclaim wrapper issues the exact review reclaim command and returns the audit record", async () => {
	const { adapter, calls } = queuedAdapter([VERSION_218, { stdout: JSON.stringify(RECLAIM_RECORD) }]);
	const cli = new NativeReviewCliV214(adapter);
	const result = await cli.reclaim!({ cwd: "/repo", lineage: "stuck-lineage", actor: "maintainer", reason: "incomplete entry" });
	assert.deepEqual(result.record, RECLAIM_RECORD);
	assert.deepEqual(calls[1]?.arguments, ["review", "reclaim", "--cwd", "/repo", "--lineage", "stuck-lineage", "--actor", "maintainer", "--reason", "incomplete entry"]);
});

test("native recover wrapper issues the exact review recover command including the authorization binding", async () => {
	const { adapter, calls } = queuedAdapter([VERSION_218, { stdout: JSON.stringify(RECOVER_RECORD) }]);
	const cli = new NativeReviewCliV214(adapter);
	const result = await cli.recover!({
		cwd: "/repo",
		predecessorLineage: "broken",
		expectedPredecessorRevision: "rev-1",
		successorLineage: "successor",
		disposition: "invalidated",
		actor: "maintainer",
		reason: "invalid authority",
		maintainerAuthorization: "binding",
	});
	assert.deepEqual(result.record, RECOVER_RECORD);
	assert.deepEqual(calls[1]?.arguments, [
		"review", "recover", "--cwd", "/repo",
		"--predecessor-lineage", "broken",
		"--expected-predecessor-revision", "rev-1",
		"--successor-lineage", "successor",
		"--disposition", "invalidated",
		"--actor", "maintainer",
		"--reason", "invalid authority",
		"--maintainer-authorization", "binding",
	]);
});

test("native reconcile-authority wrapper binds the exact target revisions and authorization without a shell", async () => {
	const { adapter, calls } = queuedAdapter([VERSION_218, { stdout: JSON.stringify(RECONCILE_RECORD) }]);
	const cli = new NativeReviewCliV214(adapter);
	const result = await cli.reconcileAuthority!({
		cwd: "/repo with spaces",
		predecessorLineage: "predecessor",
		expectedPredecessorRevision: "predecessor-revision",
		successorLineage: "successor",
		expectedSuccessorRevision: "successor-revision",
		actor: "maintainer",
		reason: "invalid recovery edge",
		maintainerAuthorization: RECONCILE_AUTHORIZATION,
	});
	assert.deepEqual(result.record, RECONCILE_RECORD);
	assert.deepEqual(calls[1]?.arguments, [
		"review", "reconcile-authority", "--cwd", "/repo with spaces",
		"--predecessor-lineage", "predecessor",
		"--expected-predecessor-revision", "predecessor-revision",
		"--successor-lineage", "successor",
		"--expected-successor-revision", "successor-revision",
		"--actor", "maintainer",
		"--reason", "invalid recovery edge",
		"--maintainer-authorization", RECONCILE_AUTHORIZATION,
	]);
});

test("native reconcile-authority refuses a mismatched authorization before process launch", async () => {
	const { adapter, calls } = queuedAdapter([]);
	const cli = new NativeReviewCliV214(adapter);
	await assert.rejects(
		cli.reconcileAuthority!({
			cwd: "/repo",
			predecessorLineage: "predecessor",
			expectedPredecessorRevision: "predecessor-revision",
			successorLineage: "successor",
			expectedSuccessorRevision: "changed-revision",
			actor: "maintainer",
			reason: "invalid recovery edge",
			maintainerAuthorization: RECONCILE_AUTHORIZATION,
		}),
		/exact target and revision binding/,
	);
	assert.equal(calls.length, 0);
});

test("native reconcile-authority forwards cancellation and preserves unknown mutation outcome", async () => {
	const controller = new AbortController();
	let calls = 0;
	const adapter: ExecFileAdapter = async (request) => {
		calls += 1;
		if (calls === 1) return { ...VERSION_218, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		assert.equal(request.signal, controller.signal);
		const error = new Error("cancelled");
		error.name = "AbortError";
		throw error;
	};
	const cli = new NativeReviewCliV214(adapter);
	await assert.rejects(
		cli.reconcileAuthority!({
			cwd: "/repo",
			predecessorLineage: "predecessor",
			expectedPredecessorRevision: "predecessor-revision",
			successorLineage: "successor",
			expectedSuccessorRevision: "successor-revision",
			actor: "maintainer",
			reason: "invalid recovery edge",
			maintainerAuthorization: RECONCILE_AUTHORIZATION,
			signal: controller.signal,
		}),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.CANCELLED
			&& error.operation === "review/reconcile-authority"
			&& error.mutationOutcome === "unknown",
	);
});

test("native reconcile-authority preserves the prepared audit record on partial failure", async () => {
	const { adapter } = queuedAdapter([VERSION_218, { stdout: JSON.stringify(RECONCILE_RECORD), stderr: "quarantine interrupted", exitCode: 1 }]);
	const cli = new NativeReviewCliV214(adapter);
	await assert.rejects(
		cli.reconcileAuthority!({
			cwd: "/repo",
			predecessorLineage: "predecessor",
			expectedPredecessorRevision: "predecessor-revision",
			successorLineage: "successor",
			expectedSuccessorRevision: "successor-revision",
			actor: "maintainer",
			reason: "invalid recovery edge",
			maintainerAuthorization: RECONCILE_AUTHORIZATION,
		}),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.mutationOutcome === "unknown"
			&& error.nextAction === "review.status"
			&& error.auditRecord?.schema === RECONCILE_RECORD.schema,
	);
});

test("native recovery wrappers refuse binaries below the 2.1.8 recovery contract", async () => {
	const { adapter } = queuedAdapter([{ stdout: "gentle-ai 2.1.7\n" }]);
	const cli = new NativeReviewCliV214(adapter);
	await assert.rejects(
		cli.reclaim!({ cwd: "/repo", lineage: "stuck", actor: "maintainer", reason: "incomplete" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE,
	);
});

test("RESET maps to native review reclaim with the exact audited inputs and clears pending authorizations", async () => {
	const { native, calls } = fakeRecoveryNative(RECLAIM_RECORD);
	const pending = new Map<string, unknown>([["stale", { command: "git push" }]]);
	const details = await runControllerOperation({
		operation: "reset",
		input: JSON.stringify({
			repositoryId: "repo-id",
			commonDirHash: "c".repeat(64),
			inventoryHash: "d".repeat(64),
			confirmation: "DESTROY REVIEW AUTHORITY repo-id",
			lineage: "stuck-lineage",
			actor: "maintainer",
			reason: "incomplete entry",
		}),
	}, native, pending);
	assert.equal(details.operation, "reset");
	assert.equal(details.native_operation, "review reclaim");
	assert.equal(details.mutation_performed, true);
	assert.equal(details.mutation_outcome, "committed");
	assert.deepEqual(details.result, RECLAIM_RECORD);
	assert.equal(details.next_action, "inspect");
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.operation, "reclaim");
	assert.equal(calls[0]?.request.lineage, "stuck-lineage");
	assert.equal(calls[0]?.request.actor, "maintainer");
	assert.equal(calls[0]?.request.reason, "incomplete entry");
	assert.equal(pending.size, 0);
});

test("RESET without the native reclaim inputs returns a structured request instead of inventing values", async () => {
	const { native, calls } = fakeRecoveryNative(RECLAIM_RECORD);
	const pending = new Map<string, unknown>([["stale", { command: "git push" }]]);
	const details = await runControllerOperation({
		operation: "reset",
		input: JSON.stringify({
			repositoryId: "repo-id",
			commonDirHash: "c".repeat(64),
			inventoryHash: "d".repeat(64),
			confirmation: "DESTROY REVIEW AUTHORITY repo-id",
		}),
	}, native, pending);
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-input-required");
	assert.equal(details.native_operation, "review reclaim");
	assert.deepEqual(details.missing_input, ["lineage", "actor", "reason"]);
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, "none");
	assert.equal(calls.length, 0);
	assert.equal(pending.size, 1);
});

test("RESET without a native client fails closed as unavailable", async () => {
	const details = await runControllerOperation({
		operation: "reset",
		input: JSON.stringify({ lineage: "stuck", actor: "maintainer", reason: "incomplete" }),
	}, null);
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-recovery-unavailable");
	assert.equal(details.native_operation, "review reclaim");
	assert.equal(details.mutation_performed, false);
});

test("RECOVER maps to native review recover with the successor authority binding", async () => {
	const { native, calls } = fakeRecoveryNative(RECOVER_RECORD);
	const details = await runControllerOperation({
		operation: "recover",
		input: JSON.stringify({
			repositoryId: "repo-id",
			commonDirHash: "c".repeat(64),
			inventoryHash: "d".repeat(64),
			confirmation: "DESTROY REVIEW AUTHORITY repo-id",
			predecessorLineage: "broken",
			expectedPredecessorRevision: "rev-1",
			successorLineage: "successor",
			disposition: "invalidated",
			actor: "maintainer",
			reason: "invalid authority",
			maintainerAuthorization: "binding",
		}),
	}, native);
	assert.equal(details.native_operation, "review recover");
	assert.equal(details.mutation_performed, true);
	assert.deepEqual(details.result, RECOVER_RECORD);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.operation, "recover");
	assert.equal(calls[0]?.request.predecessorLineage, "broken");
	assert.equal(calls[0]?.request.expectedPredecessorRevision, "rev-1");
	assert.equal(calls[0]?.request.successorLineage, "successor");
	assert.equal(calls[0]?.request.disposition, "invalidated");
	assert.equal(calls[0]?.request.maintainerAuthorization, "binding");
});

test("RECOVER surfaces every missing successor input including an unsupported disposition", async () => {
	const { native, calls } = fakeRecoveryNative(RECOVER_RECORD);
	const details = await runControllerOperation({
		operation: "recover",
		input: JSON.stringify({
			repositoryId: "repo-id",
			commonDirHash: "c".repeat(64),
			inventoryHash: "d".repeat(64),
			confirmation: "DESTROY REVIEW AUTHORITY repo-id",
			predecessorLineage: "broken",
			disposition: "not-a-disposition",
		}),
	}, native);
	assert.equal(details.outcome, "native-input-required");
	assert.equal(details.native_operation, "review recover");
	assert.deepEqual(details.missing_input, ["expectedPredecessorRevision", "successorLineage", "disposition", "actor", "reason"]);
	assert.equal(calls.length, 0);
});

test("RECONCILE_AUTHORITY routes one exact native mutation and returns its audit record", async () => {
	const { native, calls } = fakeRecoveryNative(RECONCILE_RECORD);
	const pending = new Map<string, unknown>([["stale", { command: "git push" }]]);
	const details = await runControllerOperation({
		operation: "reconcile-authority",
		input: JSON.stringify({
			predecessorLineage: "predecessor",
			expectedPredecessorRevision: "predecessor-revision",
			successorLineage: "successor",
			expectedSuccessorRevision: "successor-revision",
			actor: "maintainer",
			reason: "invalid recovery edge",
		}),
	}, native, pending);
	assert.equal(details.operation, "reconcile-authority");
	assert.equal(details.native_operation, "review reconcile-authority");
	assert.equal(details.mutation_performed, true);
	assert.equal(details.mutation_outcome, "committed");
	assert.deepEqual(details.result, RECONCILE_RECORD);
	assert.equal(details.next_action, "inspect");
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.operation, "reconcileAuthority");
	assert.equal(calls[0]?.request.expectedPredecessorRevision, "predecessor-revision");
	assert.equal(calls[0]?.request.expectedSuccessorRevision, "successor-revision");
	assert.equal(calls[0]?.request.maintainerAuthorization, RECONCILE_AUTHORIZATION);
	assert.equal(pending.size, 0);
});

test("RECONCILE_AUTHORITY requests every exact native binding before authorization or mutation", async () => {
	const { native, calls } = fakeRecoveryNative(RECONCILE_RECORD);
	const details = await runControllerOperation({ operation: "reconcile-authority", input: "{}" }, native);
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-input-required");
	assert.deepEqual(details.missing_input, ["predecessorLineage", "expectedPredecessorRevision", "successorLineage", "expectedSuccessorRevision", "actor", "reason"]);
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, "none");
	assert.equal(calls.length, 0);
});

test("RECONCILE_AUTHORITY returns a typed fail-closed envelope for native cancellation", async () => {
	const native = {
		async reconcileAuthority() {
			throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, "review/reconcile-authority", true, true, "native process was cancelled");
		},
	} as unknown as NativeReviewCli;
	const details = await runControllerOperation({
		operation: "reconcile-authority",
		input: JSON.stringify({
			predecessorLineage: "predecessor",
			expectedPredecessorRevision: "predecessor-revision",
			successorLineage: "successor",
			expectedSuccessorRevision: "successor-revision",
			actor: "maintainer",
			reason: "invalid recovery edge",
		}),
	}, native);
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-operation-failed");
	assert.equal(details.mutation_outcome, "unknown");
	assert.equal(details.replayability, "status_required");
	assert.equal(details.next_action, "review.status");
	assert.deepEqual(details.diagnostics, {
		operation: "review/reconcile-authority",
		error_code: "cancelled",
		timed_out: false,
		output_limit_exceeded: false,
	});
});

test("RECONCILE_AUTHORITY relays a partial-failure audit record without weakening status reconciliation", async () => {
	const native = {
		async reconcileAuthority() {
			throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, "review/reconcile-authority", true, true, "partial failure", undefined, RECONCILE_RECORD);
		},
	} as unknown as NativeReviewCli;
	const details = await runControllerOperation({
		operation: "reconcile-authority",
		input: JSON.stringify({ predecessorLineage: "predecessor", expectedPredecessorRevision: "predecessor-revision", successorLineage: "successor", expectedSuccessorRevision: "successor-revision", actor: "maintainer", reason: "invalid recovery edge" }),
	}, native);
	assert.equal(details.mutation_outcome, "unknown");
	assert.equal(details.next_action, "review.status");
	assert.deepEqual(details.native_audit_record, RECONCILE_RECORD);
});

test("RECOVER_LOCK still requires the exact ownerHash before routing to native reclaim", async () => {
	const { native, calls } = fakeRecoveryNative(RECLAIM_RECORD);
	await assert.rejects(
		runControllerOperation({ operation: "recover-lock", input: JSON.stringify({ lineage: "stuck", actor: "maintainer", reason: "stale lock" }) }, native),
		/ownerHash/,
	);
	assert.equal(calls.length, 0);
	const details = await runControllerOperation({
		operation: "recover-lock",
		input: JSON.stringify({ ownerHash: "a".repeat(64), lineage: "stuck", actor: "maintainer", reason: "stale lock" }),
	}, native);
	assert.equal(details.native_operation, "review reclaim");
	assert.equal(details.mutation_performed, true);
	assert.deepEqual(details.result, RECLAIM_RECORD);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.operation, "reclaim");
	assert.equal(calls[0]?.request.lineage, "stuck");
});

test("RECOVER_LOCK without the native reclaim inputs requests them explicitly", async () => {
	const { native, calls } = fakeRecoveryNative(RECLAIM_RECORD);
	const details = await runControllerOperation({
		operation: "recover-lock",
		input: JSON.stringify({ ownerHash: "a".repeat(64) }),
	}, native);
	assert.equal(details.outcome, "native-input-required");
	assert.deepEqual(details.missing_input, ["lineage", "actor", "reason"]);
	assert.equal(calls.length, 0);
});

test("destructive RESET still fails closed without fresh interactive authorization", async () => {
	const tools = new Map<string, { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<unknown> }>();
	const pi = {
		on() {},
		registerTool(definition: { name: string; execute: never }) {
			tools.set(definition.name, definition as unknown as { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<unknown> });
		},
		registerCommand() {},
	} as unknown as ExtensionAPI;
	const { native, calls } = fakeRecoveryNative(RECLAIM_RECORD);
	createGentleAiExtension({ nativeReviewCli: native })(pi);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	const cwd = scratchDir("gentle-pi-native-recovery-headless-");
	const ctx = { cwd, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionContext;
	await assert.rejects(
		controller.execute("headless-reset", {
			operation: "reset",
			input: JSON.stringify({
				repositoryId: "repo-id",
				commonDirHash: "c".repeat(64),
				inventoryHash: "d".repeat(64),
				confirmation: "DESTROY REVIEW AUTHORITY repo-id",
				lineage: "stuck",
				actor: "maintainer",
				reason: "incomplete",
			}),
		}, undefined, undefined, ctx),
		/interactive Pi UI.*fails closed/i,
	);
	assert.equal(calls.length, 0);
});

test("RECONCILE_AUTHORITY requires fresh Pi approval for the exact seven-line binding", async () => {
	const tools = new Map<string, { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<unknown> }>();
	const pi = {
		on() {},
		registerTool(definition: { name: string; execute: never }) { tools.set(definition.name, definition as never); },
		registerCommand() {},
	} as unknown as ExtensionAPI;
	const { native, calls } = fakeRecoveryNative(RECONCILE_RECORD);
	createGentleAiExtension({ nativeReviewCli: native })(pi);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	const cwd = scratchDir("gentle-pi-native-reconcile-authorization-");
	const parameters = {
		operation: "reconcile-authority",
		input: JSON.stringify({
			predecessorLineage: "predecessor",
			expectedPredecessorRevision: "predecessor-revision",
			successorLineage: "successor",
			expectedSuccessorRevision: "successor-revision",
			actor: "maintainer",
			reason: "invalid recovery edge",
		}),
	};
	await assert.rejects(
		controller.execute("headless-reconcile", parameters, undefined, undefined, { cwd, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionContext),
		/interactive Pi UI.*fails closed/i,
	);
	let prompt = "";
	const approved = await controller.execute("approved-reconcile", parameters, undefined, undefined, {
		cwd,
		hasUI: true,
		ui: { confirm: async (_title: string, message: string) => { prompt = message; return true; } },
	} as unknown as ExtensionContext) as { details: Record<string, unknown> };
	assert.match(prompt, /predecessor_revision=predecessor-revision/);
	assert.match(prompt, /successor_revision=successor-revision/);
	assert.equal(approved.details.mutation_outcome, "committed");
	assert.equal(calls.length, 1);
});
