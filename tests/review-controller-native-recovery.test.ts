import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../extensions/gentle-ai.ts";
import {
	NATIVE_REVIEW_ERROR_CODE,
	NativeReviewCliError,
	NativeReviewCliV214 as NativeReviewCliV214Production,
	NativeReviewCliV216,
	clearNativeReviewCapabilitiesCacheForTesting,
	nativeReviewLegacyAliasRepairAuthorization,
	type ExecFileAdapter,
	type NativeReviewCli,
} from "../lib/native-review-cli.ts";
import { GENTLE_AI_VERSION } from "../lib/gentle-ai-binary.ts";

const v2FixtureRoot = join(process.cwd(), "contracts", "review-integration", "v2", "fixtures");
const v2Fixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(join(v2FixtureRoot, name), "utf8")) as T;

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

const VERSION_219 = { stdout: "gentle-ai 2.1.9\n" };
const VERSION_218 = { stdout: "gentle-ai 2.1.8\n" };
const VERSION_220 = { stdout: "gentle-ai 2.2.0\n" };
const RECLAIM_RECORD = { schema: "gentle-ai.review-reclaim-audit/v1", lineage: "stuck-lineage", actor: "maintainer", reason: "incomplete entry" };
const RECOVER_RECORD = { schema: "gentle-ai.review-recovery/v1", predecessor_lineage: "broken", successor_lineage: "successor" };
const RECONCILE_RECORD = { schema: "gentle-ai.review-reconcile-audit/v1", predecessor_lineage: "predecessor", successor_lineage: "successor", outcome: "quarantined" };
const RECONCILE_RESULT = { operation: "review/reconcile-authority", record: RECONCILE_RECORD };
const ABANDON_RECORD = { schema: "gentle-ai.review-reclaim-audit/v1", lineage_id: "pristine", status: "committed" };
const LEGACY_QUARANTINE_RECORD = { schema: "gentle-ai.review-reclaim-audit/v1", lineage_id: "legacy", status: "committed" };
const LEGACY_FREEZE_DIAGNOSTIC = "historical findings freeze changed unrelated transaction state";
const LEGACY_FREEZE_DISPOSITION = "quarantine-malformed-freeze-event";
const COMBINED_RECONCILE_ANOMALIES = "unchanged_target,malformed_recovery_authorization";
const LEGACY_ALIAS_DIAGNOSTIC = "unsupported historical v1 operation alias";
const LEGACY_ALIAS_DISPOSITION = "quarantine-approved-historical-alias";
const LEGACY_ALIAS_RECORD = { schema: "gentle-ai.review-reclaim-audit/v1", lineage_id: "legacy-alias", status: "committed" };
const LEGACY_ALIAS_AUTHORIZATION = [
	"gentle-ai.review-legacy-alias-repair-authorization/v1",
	"repository=/repo",
	"lineage=legacy-alias",
	`revision=sha256:${"c".repeat(64)}`,
	`diagnostic=${LEGACY_ALIAS_DIAGNOSTIC}`,
	`disposition=${LEGACY_ALIAS_DISPOSITION}`,
	"actor=maintainer",
	"reason=quarantine approved historical alias",
].join("\n");
const ABANDON_AUTHORIZATION = [
	"gentle-ai.review-abandon-authorization/v1",
	"lineage=pristine",
	"revision=revision",
	"snapshot_identity=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	"actor=maintainer",
	"reason=retire pristine lineage",
].join("\n");
const LEGACY_QUARANTINE_AUTHORIZATION = [
	"gentle-ai.review-legacy-quarantine-authorization/v1",
	"repository=/repo",
	"lineage=legacy",
	"revision=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	`diagnostic=${LEGACY_FREEZE_DIAGNOSTIC}`,
	`disposition=${LEGACY_FREEZE_DISPOSITION}`,
	"actor=maintainer",
	"reason=quarantine malformed legacy freeze",
].join("\n");
const RECONCILE_AUTHORIZATION = [
	"gentle-ai.review-reconcile-authorization/v1",
	"predecessor_lineage=predecessor",
	"predecessor_revision=predecessor-revision",
	"successor_lineage=successor",
	"successor_revision=successor-revision",
	"actor=maintainer",
	"reason=invalid recovery edge",
].join("\n");
const COMBINED_RECONCILE_AUTHORIZATION = `${RECONCILE_AUTHORIZATION}\nanomalies=${COMBINED_RECONCILE_ANOMALIES}`;

function scratchDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	test.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

interface RecordedNativeCall { operation: "reclaim" | "recover" | "reconcileAuthority" | "abandon" | "quarantineLegacy"; request: Record<string, unknown>; }

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
		async abandon(request: Record<string, unknown>) {
			calls.push({ operation: "abandon", request });
			return { record };
		},
		async quarantineLegacy(request: Record<string, unknown>) {
			calls.push({ operation: "quarantineLegacy", request });
			return { record };
		},
		async targetStatus(request: { lineageId?: string }) {
			return {
				action: "recover",
				actionDisposition: "invalidated",
				authority: { lineageId: request.lineageId ?? "broken", revision: "rev-1" },
			} as unknown;
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
	const { adapter, calls } = queuedAdapter([VERSION_219, { stdout: JSON.stringify(RECLAIM_RECORD) }]);
	const cli = new NativeReviewCliV214(adapter);
	const result = await cli.reclaim!({ cwd: "/repo", lineage: "stuck-lineage", actor: "maintainer", reason: "incomplete entry" });
	assert.deepEqual(result.record, RECLAIM_RECORD);
	assert.deepEqual(calls[1]?.arguments, ["review", "reclaim", "--cwd", "/repo", "--lineage", "stuck-lineage", "--actor", "maintainer", "--reason", "incomplete entry"]);
});

test("native recover wrapper issues the exact review recover command including the authorization binding", async () => {
	const { adapter, calls } = queuedAdapter([VERSION_219, { stdout: JSON.stringify(RECOVER_RECORD) }]);
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
	const { adapter, calls } = queuedAdapter([VERSION_219, { stdout: JSON.stringify(RECONCILE_RESULT) }]);
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

test("native v2.1.8 reconcile-authority accepts its raw audit response but modern envelopes remain strict", async () => {
	const request = {
		cwd: "/repo",
		predecessorLineage: "predecessor",
		expectedPredecessorRevision: "predecessor-revision",
		successorLineage: "successor",
		expectedSuccessorRevision: "successor-revision",
		actor: "maintainer",
		reason: "invalid recovery edge",
		maintainerAuthorization: RECONCILE_AUTHORIZATION,
	};
	const legacy = queuedAdapter([VERSION_218, { stdout: JSON.stringify(RECONCILE_RECORD) }]);
	assert.deepEqual((await new NativeReviewCliV214(legacy.adapter).reconcileAuthority!(request)).record, RECONCILE_RECORD);

	for (const [version, response] of [
		[VERSION_218, { schema: "gentle-ai.review-reconcile-audit/v1", predecessor_lineage: "predecessor" }],
		[VERSION_219, RECONCILE_RECORD],
	] as const) {
		const queue = queuedAdapter([version, { stdout: JSON.stringify(response) }]);
		await assert.rejects(
			() => new NativeReviewCliV214(queue.adapter).reconcileAuthority!(request),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
		);
	}
});

test("native v2.1.9 maintenance wrappers use exact argv and published authorization bindings", async () => {
	const { adapter, calls } = queuedAdapter([
		VERSION_219, { stdout: JSON.stringify({ operation: "review/abandon", record: ABANDON_RECORD }) },
		VERSION_219, { stdout: JSON.stringify({ operation: "review/quarantine-legacy", record: LEGACY_QUARANTINE_RECORD }) },
		VERSION_219, { stdout: JSON.stringify({ operation: "review/reconcile-authority", record: RECONCILE_RECORD }) },
	]);
	const cli = new NativeReviewCliV214(adapter);
	assert.deepEqual((await cli.abandon!({ cwd: "/repo", lineage: "pristine", expectedRevision: "revision", snapshotIdentity: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "maintainer", reason: "retire pristine lineage", maintainerAuthorization: ABANDON_AUTHORIZATION })).record, ABANDON_RECORD);
	assert.deepEqual((await cli.quarantineLegacy!({ cwd: "/repo", repository: "/repo", lineage: "legacy", expectedRevision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", diagnostic: LEGACY_FREEZE_DIAGNOSTIC, disposition: LEGACY_FREEZE_DISPOSITION, actor: "maintainer", reason: "quarantine malformed legacy freeze", maintainerAuthorization: LEGACY_QUARANTINE_AUTHORIZATION })).record, LEGACY_QUARANTINE_RECORD);
	assert.deepEqual((await cli.reconcileAuthority!({ cwd: "/repo", predecessorLineage: "predecessor", expectedPredecessorRevision: "predecessor-revision", successorLineage: "successor", expectedSuccessorRevision: "successor-revision", actor: "maintainer", reason: "invalid recovery edge", anomalies: COMBINED_RECONCILE_ANOMALIES, maintainerAuthorization: COMBINED_RECONCILE_AUTHORIZATION })).record, RECONCILE_RECORD);
	assert.deepEqual(calls.filter((call) => call.arguments[0] === "review").map((call) => call.arguments), [
		["review", "abandon", "--cwd", "/repo", "--lineage", "pristine", "--expected-revision", "revision", "--actor", "maintainer", "--reason", "retire pristine lineage", "--maintainer-authorization", ABANDON_AUTHORIZATION],
		["review", "quarantine-legacy", "--cwd", "/repo", "--lineage", "legacy", "--expected-revision", "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "--diagnostic", LEGACY_FREEZE_DIAGNOSTIC, "--disposition", LEGACY_FREEZE_DISPOSITION, "--actor", "maintainer", "--reason", "quarantine malformed legacy freeze", "--maintainer-authorization", LEGACY_QUARANTINE_AUTHORIZATION],
		["review", "reconcile-authority", "--cwd", "/repo", "--predecessor-lineage", "predecessor", "--expected-predecessor-revision", "predecessor-revision", "--successor-lineage", "successor", "--expected-successor-revision", "successor-revision", "--actor", "maintainer", "--reason", "invalid recovery edge", "--maintainer-authorization", COMBINED_RECONCILE_AUTHORIZATION],
	]);
});

test("native v2.2.0 repair-legacy-alias uses the exact fixed binding and preserves idempotent audit records", async () => {
	const { adapter, calls } = queuedAdapter([
		VERSION_220,
		{ stdout: JSON.stringify({ operation: "review/repair-legacy-alias", record: LEGACY_ALIAS_RECORD }) },
	]);
	const cli = new NativeReviewCliV214(adapter);
	const request = {
		cwd: "/repo",
		repository: "/repo",
		lineage: "legacy-alias",
		expectedRevision: `sha256:${"c".repeat(64)}`,
		diagnostic: LEGACY_ALIAS_DIAGNOSTIC,
		disposition: LEGACY_ALIAS_DISPOSITION,
		actor: "maintainer",
		reason: "quarantine approved historical alias",
		maintainerAuthorization: LEGACY_ALIAS_AUTHORIZATION,
	};
	assert.equal(nativeReviewLegacyAliasRepairAuthorization(request), LEGACY_ALIAS_AUTHORIZATION);
	assert.deepEqual((await cli.repairLegacyAlias!(request)).record, LEGACY_ALIAS_RECORD);
	assert.deepEqual(calls[1]?.arguments, [
		"review", "repair-legacy-alias", "--cwd", "/repo", "--lineage", "legacy-alias",
		"--expected-revision", `sha256:${"c".repeat(64)}`,
		"--diagnostic", LEGACY_ALIAS_DIAGNOSTIC,
		"--disposition", LEGACY_ALIAS_DISPOSITION,
		"--actor", "maintainer", "--reason", "quarantine approved historical alias",
		"--maintainer-authorization", LEGACY_ALIAS_AUTHORIZATION,
	]);
});

// Task 11.1 (migrate-review-integration-v2): `repairLegacyAlias` above stays
// unnegotiated and carries no --contract (asserted at :281-288). The net-new
// negotiated `repair()` is a DIFFERENT operation and must carry --contract on
// every invocation, including the capabilities preflight `negotiated()` runs
// first. A non-eligible preflight assessment lets this test stop after one
// repair call, without needing a second queued execute-mode response.
test("negotiated repair carries --contract on every invocation, unlike repair-legacy-alias", async (t) => {
	t.after(() => clearNativeReviewCapabilitiesCacheForTesting());
	const capabilities = v2Fixture<Record<string, unknown>>("capabilities.fixture.json");
	const executableDigest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";
	const capabilitiesBody = { ...capabilities, package: { ...(capabilities.package as Record<string, unknown>), version: GENTLE_AI_VERSION } };
	const preflightResult = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: "gentle-ai.review-integration/v2",
		operation: "review.repair",
		mode: "preflight",
		assessment: {
			schema: "gentle-ai.review-authority-repair-assessment/v1",
			status: "unsupported",
			counts: { lineages: 0, compact_lineages: 0, legacy_lineages: 0, events: 0, bytes: 0, eligible_candidates: 0, unsupported_lineages: 0, conflicts: 0 },
			supported_operations: ["review/complete-fix", "review/validate-fix"],
			authorization_schema: "gentle-ai.review-repair-authorization/v1",
		},
		required_inputs: [],
	};
	const { adapter, calls } = queuedAdapter([
		{ stdout: JSON.stringify(capabilitiesBody) },
		{ stdout: JSON.stringify(preflightResult) },
	]);
	const cli = new NativeReviewCliV216(adapter, "/package/.gentle-ai/gentle-ai", 30_000, 1024 * 1024, async () => undefined, () => executableDigest);
	const result = await cli.repair!({ cwd: "/repo", actor: "maintainer", reason: "quarantine approved historical alias", maintainerAuthorization: "irrelevant-for-non-eligible-preflight" });
	assert.equal(result.mode, "preflight");
	assert.equal(result.assessment.status, "unsupported");
	assert.equal(calls.length, 2, "a non-eligible preflight must never issue an execute-mode call");
	assert.deepEqual(calls[0]?.arguments, ["review", "capabilities", "--contract", "gentle-ai.review-integration/v2"]);
	assert.deepEqual(calls[1]?.arguments, ["review", "repair", "--contract", "gentle-ai.review-integration/v2", "--cwd", "/repo", "--mode", "preflight"]);
	for (const call of calls) assert.ok(call.arguments.includes("--contract"), "every negotiated repair() invocation must carry --contract");
});

test("native repair-legacy-alias fails closed for stale bindings, malformed output, cancellation, and partial failure", async () => {
	const request = {
		cwd: "/repo", repository: "/repo", lineage: "legacy-alias", expectedRevision: `sha256:${"c".repeat(64)}`,
		diagnostic: LEGACY_ALIAS_DIAGNOSTIC, disposition: LEGACY_ALIAS_DISPOSITION, actor: "maintainer", reason: "quarantine approved historical alias", maintainerAuthorization: LEGACY_ALIAS_AUTHORIZATION,
	};
	const stale = queuedAdapter([]);
	await assert.rejects(() => new NativeReviewCliV214(stale.adapter).repairLegacyAlias!({ ...request, expectedRevision: `sha256:${"d".repeat(64)}` }), /exact repository, lineage, revision/);
	assert.equal(stale.calls.length, 0);
	for (const result of [
		{ stdout: JSON.stringify({ operation: "review/repair-legacy-alias" }) },
		{ stdout: JSON.stringify({ operation: "review/repair-legacy-alias", record: LEGACY_ALIAS_RECORD }), stderr: "interrupted", exitCode: 1 },
	]) {
		const queue = queuedAdapter([VERSION_220, result]);
		await assert.rejects(
			() => new NativeReviewCliV214(queue.adapter).repairLegacyAlias!(request),
			(error: unknown) => error instanceof NativeReviewCliError
				&& (result.exitCode === 1 ? error.auditRecord?.schema === LEGACY_ALIAS_RECORD.schema : error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE),
		);
	}
});

test("native v2.1.9 maintenance wrappers fail closed before launch for unsupported versions and invalid bindings", async () => {
	const unsupported = queuedAdapter([{ stdout: "gentle-ai 2.1.8\n" }]);
	await assert.rejects(() => new NativeReviewCliV214(unsupported.adapter).abandon!({ cwd: "/repo", lineage: "pristine", expectedRevision: "revision", snapshotIdentity: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "maintainer", reason: "retire pristine lineage", maintainerAuthorization: ABANDON_AUTHORIZATION }), NativeReviewCliError);
	const invalid = queuedAdapter([]);
	await assert.rejects(() => new NativeReviewCliV214(invalid.adapter).reconcileAuthority!({ cwd: "/repo", predecessorLineage: "predecessor", expectedPredecessorRevision: "predecessor-revision", successorLineage: "successor", expectedSuccessorRevision: "successor-revision", actor: "maintainer", reason: "invalid recovery edge", anomalies: "malformed_recovery_authorization,unchanged_target", maintainerAuthorization: COMBINED_RECONCILE_AUTHORIZATION }), TypeError);
	assert.equal(invalid.calls.length, 0);
});

test("native v2.1.9 maintenance wrappers preserve only valid prepared audit records on partial failures", async () => {
	for (const [operation, invoke, result] of [
		["review/abandon", (cli: NativeReviewCliV214) => cli.abandon!({ cwd: "/repo", lineage: "pristine", expectedRevision: "revision", snapshotIdentity: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "maintainer", reason: "retire pristine lineage", maintainerAuthorization: ABANDON_AUTHORIZATION }), ABANDON_RECORD],
		["review/quarantine-legacy", (cli: NativeReviewCliV214) => cli.quarantineLegacy!({ cwd: "/repo", repository: "/repo", lineage: "legacy", expectedRevision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", diagnostic: LEGACY_FREEZE_DIAGNOSTIC, disposition: LEGACY_FREEZE_DISPOSITION, actor: "maintainer", reason: "quarantine malformed legacy freeze", maintainerAuthorization: LEGACY_QUARANTINE_AUTHORIZATION }), LEGACY_QUARANTINE_RECORD],
	] as const) {
		const queue = queuedAdapter([VERSION_219, { stdout: JSON.stringify({ operation, record: result }), stderr: "quarantine interrupted", exitCode: 1 }]);
		await assert.rejects(() => invoke(new NativeReviewCliV214(queue.adapter)), (error: unknown) => error instanceof NativeReviewCliError && error.mutationOutcome === "unknown" && error.nextAction === "review.status" && error.auditRecord?.schema === result.schema);
	}
	const malformed = queuedAdapter([VERSION_219, { stdout: JSON.stringify({ operation: "review/abandon" }), exitCode: 1 }]);
	await assert.rejects(() => new NativeReviewCliV214(malformed.adapter).abandon!({ cwd: "/repo", lineage: "pristine", expectedRevision: "revision", snapshotIdentity: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "maintainer", reason: "retire pristine lineage", maintainerAuthorization: ABANDON_AUTHORIZATION }), (error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE && error.auditRecord === undefined);
});

test("native abandon forwards cancellation and preserves the unknown mutation outcome", async () => {
	const controller = new AbortController();
	let calls = 0;
	const adapter: ExecFileAdapter = async (request) => {
		calls += 1;
		if (calls === 1) return { ...VERSION_219, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		assert.equal(request.signal, controller.signal);
		const error = new Error("cancelled");
		error.name = "AbortError";
		throw error;
	};
	await assert.rejects(() => new NativeReviewCliV214(adapter).abandon!({ cwd: "/repo", lineage: "pristine", expectedRevision: "revision", snapshotIdentity: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "maintainer", reason: "retire pristine lineage", maintainerAuthorization: ABANDON_AUTHORIZATION, signal: controller.signal }), (error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.CANCELLED && error.mutationOutcome === "unknown" && error.nextAction === "review.status");
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
		if (calls === 1) return { ...VERSION_219, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
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
	const { adapter } = queuedAdapter([VERSION_219, { stdout: JSON.stringify(RECONCILE_RESULT), stderr: "quarantine interrupted", exitCode: 1 }]);
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

test("native recovery wrappers accept the published 2.1.9 contract and refuse older recovery binaries", async () => {
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

test("published maintenance controller actions require exact inputs and fresh UI approval", async () => {
	const tools = new Map<string, { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<unknown> }>();
	const pi = { on() {}, registerTool(definition: { name: string; execute: never }) { tools.set(definition.name, definition as never); }, registerCommand() {} } as unknown as ExtensionAPI;
	const { native, calls } = fakeRecoveryNative(ABANDON_RECORD);
	createGentleAiExtension({ nativeReviewCli: native })(pi);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	const cwd = scratchDir("gentle-pi-v219-maintenance-");
	const abandon = { operation: "abandon", input: JSON.stringify({ lineage: "pristine", expectedRevision: "revision", snapshotIdentity: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: "maintainer", reason: "retire pristine lineage" }) };
	await assert.rejects(controller.execute("headless-abandon", abandon, undefined, undefined, { cwd, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionContext), /interactive Pi UI.*fails closed/i);
	await assert.rejects(controller.execute("denied-abandon", abandon, undefined, undefined, { cwd, hasUI: true, ui: { confirm: async () => false } } as unknown as ExtensionContext), /not explicitly authorized/);
	const approved = await controller.execute("approved-abandon", abandon, undefined, undefined, { cwd, hasUI: true, ui: { confirm: async () => true } } as unknown as ExtensionContext) as { details: Record<string, unknown> };
	assert.equal(approved.details.mutation_outcome, "committed");
	assert.equal(calls[0]?.operation, "abandon");
	const legacy = await controller.execute("approved-legacy-quarantine", { operation: "quarantine-legacy", input: JSON.stringify({ repository: "/repo", lineage: "legacy", expectedRevision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", diagnostic: LEGACY_FREEZE_DIAGNOSTIC, disposition: LEGACY_FREEZE_DISPOSITION, actor: "maintainer", reason: "quarantine malformed legacy freeze" }) }, undefined, undefined, { cwd, hasUI: true, ui: { confirm: async () => true } } as unknown as ExtensionContext) as { details: Record<string, unknown> };
	assert.equal(legacy.details.mutation_outcome, "committed");
	assert.equal(calls[1]?.operation, "quarantineLegacy");
	for (const input of [
		{ operation: "quarantine-legacy", input: JSON.stringify({ repository: "/repo", lineage: "legacy", expectedRevision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", diagnostic: "unsupported historical v1 operation alias", disposition: LEGACY_FREEZE_DISPOSITION, actor: "maintainer", reason: "no-op" }) },
		{ operation: "reconcile-authority", input: JSON.stringify({ predecessorLineage: "predecessor", expectedPredecessorRevision: "predecessor-revision", successorLineage: "successor", expectedSuccessorRevision: "successor-revision", actor: "maintainer", reason: "no-op", anomalies: "malformed_recovery_authorization,unchanged_target" }) },
	]) {
		const details = await runControllerOperation(input, native);
		assert.equal(details.outcome, "native-input-invalid");
	}
	assert.equal(calls.length, 2);
});

test("REPAIR_LEGACY_ALIAS derives fixed inputs from fresh inventory and requires fresh UI approval", async () => {
	const tools = new Map<string, { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<unknown> }>();
	const pi = { on() {}, registerTool(definition: { name: string; execute: never }) { tools.set(definition.name, definition as never); }, registerCommand() {} } as unknown as ExtensionAPI;
	const calls: Record<string, unknown>[] = [];
	const native = {
		async reviewStatus() {
			return {
				repository: "/canonical/repository",
				complete: true,
				entries: [{ version: "legacy-v1", status: "invalid", lineageId: "legacy-alias", revision: `sha256:${"c".repeat(64)}`, problems: [LEGACY_ALIAS_DIAGNOSTIC] }],
			};
		},
		async repairLegacyAlias(request: Record<string, unknown>) {
			calls.push(request);
			return { record: LEGACY_ALIAS_RECORD };
		},
	} as unknown as NativeReviewCli;
	createGentleAiExtension({ nativeReviewCli: native })(pi);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	const cwd = scratchDir("gentle-pi-v2110-alias-repair-");
	const parameters = { operation: "repair-legacy-alias", input: JSON.stringify({ lineage: "legacy-alias", actor: "maintainer", reason: "quarantine approved historical alias" }) };
	await assert.rejects(
		controller.execute("headless-alias-repair", parameters, undefined, undefined, { cwd, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionContext),
		/interactive Pi UI.*fails closed/i,
	);
	assert.equal(calls.length, 0);
	let prompt = "";
	const approved = await controller.execute("approved-alias-repair", parameters, undefined, undefined, {
		cwd,
		hasUI: true,
		ui: { confirm: async (_title: string, message: string) => { prompt = message; return true; } },
	} as unknown as ExtensionContext) as { details: Record<string, unknown> };
	assert.match(prompt, /repository=\/canonical\/repository/);
	assert.match(prompt, /revision=sha256:c{64}/);
	assert.equal(approved.details.mutation_outcome, "committed");
	assert.equal(calls[0]?.repository, "/canonical/repository");
	assert.equal(calls[0]?.diagnostic, LEGACY_ALIAS_DIAGNOSTIC);
	assert.equal(calls[0]?.disposition, LEGACY_ALIAS_DISPOSITION);
	const injected = await runControllerOperation({ operation: "repair-legacy-alias", input: JSON.stringify({ lineage: "legacy-alias", actor: "maintainer", reason: "no-op", repository: "/attacker" }) }, native);
	assert.equal(injected.outcome, "native-input-invalid");
	await assert.rejects(runControllerOperation({ operation: "dispose-result", input: "{}" }, native), /operation/);
});

// The capture-result gap, found by benchmarking Pi's client against the real
// binary: `finalize()` emitted `--result <file>` per lens, a flag gentle-ai
// retired because "a reviewer result supplied this way carries no
// provider-owned admission, so it cannot prove the lens inspected the frozen
// candidate". There was no capture-result surface at all, so Pi could only
// finalize a zero-lens low-risk candidate. The suite never caught it because
// it mocks the finalize response.
//
// Two inverse contracts meet here. `repair()` above MUST carry --contract.
// `capture-result` MUST NOT: it is an additive headless command, not a
// negotiated repository operation, and the provider's own tokens already
// carry the repository context -- it accepts that or --cwd, never both. So
// Pi passes the transition's tokens through verbatim and adds only --input.
test("captureResult passes the provider tokens through verbatim and carries no --contract", async (t) => {
	t.after(() => clearNativeReviewCapabilitiesCacheForTesting());
	const manifest = {
		schema: "gentle-ai.review-result-artifact/v2",
		capability: "review.native_result_artifact",
		subject_hash: "sha256:" + "a".repeat(64),
		admission_decision: "completed",
		lens: "review-reliability",
		reference: "rref1_" + "b".repeat(64),
	};
	const { adapter, calls } = queuedAdapter([{ stdout: JSON.stringify(manifest) }]);
	const cli = new NativeReviewCliV216(adapter, "/package/.gentle-ai/gentle-ai", 30_000, 1024 * 1024, async () => undefined, () => "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705");

	const tokens = [
		"--lineage=review-1d5aadacc600e167",
		"--expected-revision=sha256:" + "c".repeat(64),
		"--target=sha256:" + "d".repeat(64),
		"--repository-context=rctx1_" + "e".repeat(64),
		"--lens=review-reliability",
		"--order=0",
		"--subject-hash=" + manifest.subject_hash,
	];
	const captured = await cli.captureResult({ argumentTokens: tokens, resultDocument: JSON.stringify({ subject_hash: manifest.subject_hash, inspection: { status: "completed", paths: ["a.ts"] }, findings: [], evidence: ["reviewed the complete frozen candidate scope"] }) });

	assert.equal(captured.subjectHash, manifest.subject_hash);
	assert.equal(captured.admissionDecision, "completed");

	// Exactly one invocation: capture-result is headless and never negotiates,
	// so it must not drag a capabilities preflight along with it.
	assert.equal(calls.length, 1);
	const argv = calls[0]!.arguments;
	assert.deepEqual(argv.slice(0, 2), ["review", "capture-result"]);
	assert.equal(argv.includes("--contract"), false, "capture-result accepts no --contract");
	assert.equal(argv.includes("--cwd"), false, "the provider tokens already carry the repository context");
	// Tokens pass through in order, untouched, and --input is the only addition.
	assert.deepEqual(argv.slice(2, 2 + tokens.length), tokens);
	assert.equal(argv.at(-2), "--input");
	assert.match(argv.at(-1) as string, /\S/);
	assert.equal(argv.length, 2 + tokens.length + 2);
});

test("captureResult forwards a documentation-like admitted path byte-identical and refuses a dual-locator manifest (Wave 1, threat: Documentation-like paths)", async (t) => {
	t.after(() => clearNativeReviewCapabilitiesCacheForTesting());
	const tokens = [
		"--lineage=review-1d5aadacc600e167",
		"--expected-revision=sha256:" + "c".repeat(64),
		"--target=sha256:" + "d".repeat(64),
		"--repository-context=rctx1_" + "e".repeat(64),
		"--lens=review-reliability",
		"--order=0",
		"--subject-hash=sha256:" + "a".repeat(64),
	];
	const resultDocument = JSON.stringify({ subject_hash: "sha256:" + "a".repeat(64), inspection: { status: "completed", paths: ["a.ts"] }, findings: [], evidence: ["reviewed the complete frozen candidate scope"] });

	// A locator containing "..", an absolute path, or an executable-looking
	// name is opaque provider data returned to the same provider that issued
	// it — Pi never opens, stats, classifies, or executes it, and forwards it
	// byte-identical. None of these locators exist on disk in this test.
	for (const dangerousPath of ["../../../../etc/passwd", "/etc/shadow", "/usr/bin/env sh -c 'rm -rf /'"]) {
		const manifest = {
			schema: "gentle-ai.review-result-artifact/v2",
			capability: "review.native_result_artifact",
			subject_hash: "sha256:" + "a".repeat(64),
			admission_decision: "completed",
			lens: "review-reliability",
			path: dangerousPath,
		};
		const { adapter } = queuedAdapter([{ stdout: JSON.stringify(manifest) }]);
		const cli = new NativeReviewCliV216(adapter, "/package/.gentle-ai/gentle-ai", 30_000, 1024 * 1024, async () => undefined, () => "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705");
		const captured = await cli.captureResult({ argumentTokens: tokens, resultDocument });
		assert.equal(captured.path, dangerousPath, "the locator must be forwarded byte-identical, unexamined");
		assert.equal(captured.reference, undefined);
	}

	// A manifest carrying both a `path` and a `reference` is refused: Pi
	// cannot forward two locators to FINALIZE for one slot.
	const dualLocator = {
		schema: "gentle-ai.review-result-artifact/v2",
		capability: "review.native_result_artifact",
		subject_hash: "sha256:" + "a".repeat(64),
		admission_decision: "completed",
		lens: "review-reliability",
		path: "../escape.json",
		reference: "rref1_" + "b".repeat(64),
	};
	const { adapter: dualAdapter } = queuedAdapter([{ stdout: JSON.stringify(dualLocator) }]);
	const dualCli = new NativeReviewCliV216(dualAdapter, "/package/.gentle-ai/gentle-ai", 30_000, 1024 * 1024, async () => undefined, () => "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705");
	await assert.rejects(
		dualCli.captureResult({ argumentTokens: tokens, resultDocument }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
	);
});

test("captureEvidence stages exact bytes, uses the closed outcome argv, and decodes the native record", async (t) => {
	t.after(() => clearNativeReviewCapabilitiesCacheForTesting());
	const capabilities = v2Fixture<Record<string, unknown>>("capabilities.fixture.json");
	const capabilitiesBody = { ...capabilities, package: { ...(capabilities.package as Record<string, unknown>), version: GENTLE_AI_VERSION } };
	const record = {
		schema: "gentle-ai.review-verification-evidence/v2",
		version: 2,
		lineage_id: "review-evidence-lineage",
		authority_revision: `sha256:${"a".repeat(64)}`,
		target_identity: `sha256:${"b".repeat(64)}`,
		candidate_tree: "c".repeat(40),
		paths_digest: `sha256:${"d".repeat(64)}`,
		paths: ["app.ts"],
		ledger_ids: [],
		raw_payload_sha256: `sha256:${"e".repeat(64)}`,
		raw_payload_bytes: 24,
		outcome: "verification_failed",
		record_digest: `sha256:${"f".repeat(64)}`,
	};
	let staged = "";
	const calls: Array<{ arguments: readonly string[] }> = [];
	const cli = new NativeReviewCliV216(async (request) => {
		calls.push({ arguments: request.arguments });
		if (request.arguments[1] === "capabilities") return { stdout: JSON.stringify(capabilitiesBody), stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		const inputIndex = request.arguments.indexOf("--input");
		assert.ok(inputIndex >= 0);
		staged = readFileSync(request.arguments[inputIndex + 1]!, "utf8");
		return { stdout: JSON.stringify(record), stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
	}, "/package/.gentle-ai/gentle-ai", 30_000, 1024 * 1024, async () => undefined, () => "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705");
	const evidence = "focused verification failed\n";
	const captured = await cli.captureEvidence({
		cwd: "/repo",
		lineageId: record.lineage_id,
		targetIdentity: record.target_identity,
		expectedRevision: record.authority_revision,
		outcome: "verification_failed",
		evidenceDocument: evidence,
	});
	assert.equal(staged, evidence);
	assert.equal(captured.recordDigest, record.record_digest);
	assert.equal(captured.outcome, "verification_failed");
	const argv = calls[1]!.arguments;
	assert.deepEqual(argv.slice(0, 2), ["review", "capture-evidence"]);
	assert.equal(argv.includes("--contract"), false);
	assert.equal(argv[argv.indexOf("--outcome") + 1], "verification_failed");
	await assert.rejects(
		cli.captureEvidence({ cwd: "/repo", lineageId: record.lineage_id, targetIdentity: record.target_identity, expectedRevision: record.authority_revision, outcome: "failed" as never, evidenceDocument: evidence }),
		/outcome must be passed, verification_failed, or procedural_tooling_failed/,
	);
	assert.equal(calls.length, 2, "outside-domain outcomes must fail before another native launch");
});

test("negotiated finalize never emits the retired --result flag", async (t) => {
	t.after(() => clearNativeReviewCapabilitiesCacheForTesting());
	const capabilities = v2Fixture<Record<string, unknown>>("capabilities.fixture.json");
	const capabilitiesBody = { ...capabilities, package: { ...(capabilities.package as Record<string, unknown>), version: GENTLE_AI_VERSION } };
	const finalizeBody = {
		schema: "gentle-ai.review-integration.operation/v2",
		contract: "gentle-ai.review-integration/v2",
		operation: "review.finalize",
		result: { operation: "review/finalize", lineage_id: "review-1d5aadacc600e167", state: "approved", action: "validate delivery", store_revision: "sha256:" + "f".repeat(64) },
	};
	const { adapter, calls } = queuedAdapter([
		{ stdout: JSON.stringify(capabilitiesBody) },
		{ stdout: JSON.stringify(finalizeBody) },
	]);
	const cli = new NativeReviewCliV216(adapter, "/package/.gentle-ai/gentle-ai", 30_000, 1024 * 1024, async () => undefined, () => "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705");

	await cli.finalize({ cwd: "/repo", lineageId: "review-1d5aadacc600e167", capturedResults: true });

	const argv = calls[1]!.arguments;
	assert.equal(argv.includes("--result"), false, "--result is retired; results reach authority through capture-result");
	assert.ok(argv.some((token) => token === "--captured-results" || token.startsWith("--captured-results=")), "finalize must tell the provider to discover the captured results");
	assert.ok(argv.includes("--contract"), "finalize IS negotiated, unlike capture-result");
});

test("negotiated finalize no longer stages lensResults into a reviewer-document tmp file (Wave 1, dead-staging removal)", async (t) => {
	t.after(() => clearNativeReviewCapabilitiesCacheForTesting());
	const capabilities = v2Fixture<Record<string, unknown>>("capabilities.fixture.json");
	const capabilitiesBody = { ...capabilities, package: { ...(capabilities.package as Record<string, unknown>), version: GENTLE_AI_VERSION } };
	const finalizeBody = {
		schema: "gentle-ai.review-integration.operation/v2",
		contract: "gentle-ai.review-integration/v2",
		operation: "review.finalize",
		result: { operation: "review/finalize", lineage_id: "review-1d5aadacc600e167", state: "approved", action: "validate delivery", store_revision: "sha256:" + "f".repeat(64) },
	};
	const { adapter, calls } = queuedAdapter([
		{ stdout: JSON.stringify(capabilitiesBody) },
		{ stdout: JSON.stringify(finalizeBody) },
	]);
	let cleanupInvocations = 0;
	const cli = new NativeReviewCliV216(adapter, "/package/.gentle-ai/gentle-ai", 30_000, 1024 * 1024, async () => { cleanupInvocations += 1; }, () => "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705");

	// `lensResults` is accepted only for the legacy plain-CLI client
	// (NativeReviewCliV214); the negotiated V216 client must not stage it into
	// a tmp document, must not create a staging directory for it at all
	// (proven here by the cleanup hook never firing), and must not reference
	// it in argv — it is dead input here.
	await cli.finalize({ cwd: "/repo", lineageId: "review-1d5aadacc600e167", lensResults: [{ lens: "review-risk", document: { id: "risk" } }], capturedResults: true });

	assert.equal(cleanupInvocations, 0, "lensResults alone must not create any staging directory to clean up");
	const argv = calls[1]!.arguments;
	assert.equal(argv.includes("--result"), false);
	assert.equal(argv.some((token) => token.startsWith("--result=")), false);
});
