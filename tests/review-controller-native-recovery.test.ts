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

function scratchDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	test.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

interface RecordedNativeCall { operation: "reclaim" | "recover"; request: Record<string, unknown>; }

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
	} as unknown as NativeReviewCli;
	return { native, calls };
}

async function runControllerOperation(
	parameters: Record<string, unknown>,
	native: NativeReviewCli | null,
	pendingAuthorizations: Map<string, unknown> = new Map(),
): Promise<Record<string, unknown>> {
	const cwd = scratchDir("gentle-pi-native-recovery-");
	return await __testing.executeReviewControllerOperation(
		parameters,
		cwd,
		pendingAuthorizations as Map<string, never>,
		native,
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
