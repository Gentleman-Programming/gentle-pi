import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension, PendingReviewConsentRegistry } from "../extensions/gentle-ai.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { NATIVE_REVIEW_ERROR_CODE, NativeReviewCliError, NativeReviewConsentRequiredError, type NativeReviewCli } from "../lib/native-review-cli.ts";
import { decodeReviewConsentV3, type ReviewCollectInputV3, type ReviewStatusV3 } from "../lib/review-integration-v2.ts";

const SHA = `sha256:${"a".repeat(64)}`;
const TREE = "b".repeat(40);

function collectInput(lineageId: string): ReviewCollectInputV3 {
	const arguments_ = [
		{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
		{ name: "expected-revision", value: SHA, token: `--expected-revision=${SHA}` },
		{ name: "target", value: SHA, token: `--target=${SHA}` },
		{ name: "repository-context", value: `rctx1_${"c".repeat(64)}`, token: `--repository-context=rctx1_${"c".repeat(64)}` },
		{ name: "lens", value: "review-risk", token: "--lens=review-risk" },
		{ name: "order", value: "0", token: "--order=0" },
		{ name: "subject-hash", value: SHA, token: `--subject-hash=${SHA}` },
	];
	return {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: arguments_,
		artifactSubject: {
			schema: "gentle-ai.review-artifact-subject/v2",
			subjectHash: SHA,
			lineageId,
			authorityRevision: SHA,
			targetIdentity: SHA,
			baseTree: TREE,
			candidateTree: TREE,
			changedPathManifestSha256: SHA,
			lens: "review-risk",
			selectedOrder: 0,
		},
		submission: {
			operationToken: "capture-result",
			argumentTokens: [...arguments_.map((argument) => argument.token!), "--input={{value}}"],
			values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: 7 }],
		},
	};
}

function status(
	lineageId: string,
	inputs: readonly ReviewCollectInputV3[] = [collectInput(lineageId)],
	authorityState = "reviewing",
): ReviewStatusV3 {
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "current_target",
		authority: { version: "compact-v2", lineageId, state: authorityState, generation: 1, revision: SHA },
		receipt: { status: "expected_missing" },
		action: "stop",
		replayability: "not_replayable",
		targetIdentity: SHA,
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: TREE,
			initialReviewTree: TREE,
			currentCandidateTree: TREE,
			pathsDigest: SHA,
			paths: ["app.ts"],
			intendedUntracked: [],
			intendedUntrackedProof: SHA,
			initialSnapshotIdentity: SHA,
			currentSnapshotIdentity: SHA,
		},
		repair: { schema: "gentle-ai.review-authority-repair-assessment/v1", status: "unsupported", counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 }, supportedOperations: ["review/complete-fix", "review/validate-fix"], authorizationSchema: "gentle-ai.review-repair-authorization/v1" },
		candidates: [],
		nextTransition: { kind: "collect", reasonCode: "capture_required", collect: { inputs } },
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
}

function approvedAcknowledgementStatus(lineageId: string, cwd = process.cwd()): ReviewStatusV3 {
	const arguments_ = [{ name: "cwd", value: cwd, token: `--cwd=${cwd}` }, { name: "lineage", value: lineageId, token: `--lineage=${lineageId}` }, { name: "target", value: SHA, token: `--target=${SHA}` }, { name: "expected-revision", value: SHA, token: `--expected-revision=${SHA}` }, { name: "token", value: "provider-issued-once", token: "--token=provider-issued-once" }];
	const approved = status(lineageId, [], "approved");
	approved.nextTransition = { kind: "execute", reasonCode: "approved_acknowledgement_required", execute: { operation: "review.acknowledge-approved", command: "gentle-ai review acknowledge-approved --provider-vector", arguments: arguments_, preconditions: [{ name: "state", value: "approved", token: "--state=approved" }], binding: { lineageId, targetIdentity: SHA, revision: SHA } } };
	return approved;
}

function burnedAcknowledgementStatus(lineageId: string): ReviewStatusV3 {
	const burned = status(lineageId, [], "approved");
	burned.nextTransition = { kind: "stop", reasonCode: "approved_acknowledged" };
	return burned;
}

test("public acknowledgement relays one current provider vector and never replays after authority burn", async () => {
	const lineageId = "acknowledge-approved";
	const requests: Array<Record<string, unknown>> = [];
	const acknowledgementRequests: Array<{ argumentTokens: readonly string[]; cwd: string }> = [];
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return requests.length === 1
				? approvedAcknowledgementStatus(lineageId)
				: burnedAcknowledgementStatus(lineageId);
		},
		acknowledgeApproved: async (request: { argumentTokens: readonly string[]; cwd: string }) => {
			acknowledgementRequests.push(request);
		},
	} as unknown as NativeReviewCli;

	const rejected = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId, input: "{}" }, process.cwd(), native);
	assert.deepEqual({ outcome: rejected.outcome, calls: requests.length }, { outcome: "native-approved-acknowledgement-input-invalid", calls: 0 });
	const completed = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.deepEqual(completed, { operation: "acknowledge-approved", status: "closed", outcome: "native-approved-acknowledgement-completed", lineage_id: lineageId, target_identity: SHA, authority: "burned", delivery: "ordinary-repository-policy", mutation_performed: true, mutation_outcome: "committed" });
	assert.deepEqual(requests, [{ cwd: process.cwd(), lineageId }]);
	assert.deepEqual(acknowledgementRequests, [{ cwd: process.cwd(), argumentTokens: [`--cwd=${process.cwd()}`, `--lineage=${lineageId}`, `--target=${SHA}`, `--expected-revision=${SHA}`, "--token=provider-issued-once"], binding: { lineageId, targetIdentity: SHA, revision: SHA } }]);

	const later = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.equal(later.outcome, "native-approved-acknowledgement-not-current");
	assert.equal(requests.length, 2);
	assert.equal(acknowledgementRequests.length, 1);
});

test("public acknowledgement reports the burn from the review-acknowledged/v1 envelope when the provider prints one", async () => {
	const lineageId = "acknowledge-approved-envelope";
	let statusCalls = 0;
	const acknowledgementRequests: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async () => {
			statusCalls += 1;
			return statusCalls === 1 ? approvedAcknowledgementStatus(lineageId) : burnedAcknowledgementStatus(lineageId);
		},
		acknowledgeApproved: async (request: Record<string, unknown>) => {
			acknowledgementRequests.push(request);
			return {
				schema: "gentle-ai.review-acknowledged/v1",
				operation: "review/acknowledge-approved",
				action: "acknowledged",
				lineageId,
				targetIdentity: SHA,
				consumedRevision: SHA,
				authority: "burned",
				raw: { schema: "gentle-ai.review-acknowledged/v1" },
			};
		},
	} as unknown as NativeReviewCli;

	const completed = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.deepEqual(completed, {
		operation: "acknowledge-approved",
		status: "closed",
		outcome: "native-approved-acknowledgement-completed",
		lineage_id: lineageId,
		target_identity: SHA,
		consumed_revision: SHA,
		authority: "burned",
		burn_evidence: "gentle-ai.review-acknowledged/v1",
		delivery: "ordinary-repository-policy",
		mutation_performed: true,
		mutation_outcome: "committed",
	});
	assert.equal(statusCalls, 1, "the burn is reported from the envelope, never from a later STATUS");
	assert.deepEqual(acknowledgementRequests, [{
		cwd: process.cwd(),
		argumentTokens: [`--cwd=${process.cwd()}`, `--lineage=${lineageId}`, `--target=${SHA}`, `--expected-revision=${SHA}`, "--token=provider-issued-once"],
		binding: { lineageId, targetIdentity: SHA, revision: SHA },
	}]);
});

test("ambiguous acknowledgement reconciles STATUS once without replaying the provider vector", async () => {
	const lineageId = "ambiguous-acknowledgement";
	let statusCalls = 0;
	let acknowledgementCalls = 0;
	const native = {
		targetStatus: async () => {
			statusCalls += 1;
			return statusCalls === 1
				? approvedAcknowledgementStatus(lineageId)
				: burnedAcknowledgementStatus(lineageId);
		},
		acknowledgeApproved: async () => { acknowledgementCalls += 1; throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, "review/acknowledge-approved", true, true, "acknowledgement outcome unknown"); },
	} as unknown as NativeReviewCli;

	const result = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.equal(result.outcome, "native-mutation-status-reconciled");
	assert.equal(result.mutation_outcome, "unknown");
	assert.equal((result.diagnostics as { error_code?: string }).error_code, NATIVE_REVIEW_ERROR_CODE.NON_ZERO);
	assert.deepEqual(result.reconciliation, { schema: "gentle-ai.review-integration.status/v5" });
	assert.equal(statusCalls, 2);
	assert.equal(acknowledgementCalls, 1);
});

test("public acknowledgement rejects a typed decoy provider vector before invocation", async () => {
	const lineageId = "decoy-acknowledgement";
	const decoy = approvedAcknowledgementStatus(lineageId);
	const target = decoy.nextTransition!.execute!.arguments[2]!;
	target.value = `sha256:${"b".repeat(64)}`;
	target.token = `--target=${target.value}`;
	let statusCalls = 0;
	let acknowledgementCalls = 0;
	const native = {
		targetStatus: async () => { statusCalls += 1; return decoy; },
		acknowledgeApproved: async () => { acknowledgementCalls += 1; },
	} as unknown as NativeReviewCli;

	const result = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(statusCalls, 1);
	assert.equal(acknowledgementCalls, 0);
});

test("public acknowledgement rejects a mismatched provider cwd before invocation", async () => {
	let invoked = false;
	const result = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId: "mismatched-cwd" }, process.cwd(), {
		targetStatus: async () => approvedAcknowledgementStatus("mismatched-cwd", "/provider/mismatch"),
		acknowledgeApproved: async () => { invoked = true; },
	} as unknown as NativeReviewCli);
	assert.deepEqual({ outcome: result.outcome, invoked }, { outcome: "native-operation-failed", invoked: false });
});

test("local acknowledgement failure remains pre-launch and does not reconcile STATUS", async () => {
	const lineageId = "local-acknowledgement-failure";
	let statusCalls = 0;
	let acknowledgementCalls = 0;
	const native = {
		targetStatus: async () => { statusCalls += 1; return approvedAcknowledgementStatus(lineageId); },
		acknowledgeApproved: async () => { acknowledgementCalls += 1; throw new TypeError("local acknowledgement validation failed"); },
	} as unknown as NativeReviewCli;

	const result = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(statusCalls, 1);
	assert.equal(acknowledgementCalls, 1);
});

function correctionPlanInput(lineageId: string): ReviewCollectInputV3 {
	const arguments_ = [{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` }, { name: "target", value: SHA, token: `--target=${SHA}` }];
	return { name: "correction_plan", schema: "https://gentle-ai.dev/schema/review/correction-plan/v1", captureOperation: "review.capture-correction-plan", arguments: arguments_, submission: { operationToken: "capture-correction-plan", argumentTokens: [`--lineage=${lineageId}`, "--correction-lines={{value}}"], values: [{ slot: "correction_lines", domain: "integer", substitutionLocation: 1, minimum: 1, maximum: 200 }] } } as unknown as ReviewCollectInputV3;
}

function bindingOf(result: Record<string, unknown>): string {
	return (result.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
}

test("public STATUS exposes one opaque current collect binding without advancing authority", async () => {
	const lineageId = "public-status-lineage";
	let statusCalls = 0;
	const native = {
		targetStatus: async (request: { lineageId?: string; agent?: string }) => {
			statusCalls += 1;
			assert.equal(request.lineageId, lineageId);
			assert.equal(request.agent, "pi");
			assert.equal("baseRef" in request, false);
			assert.equal("committedOnly" in request, false);
			return status(lineageId);
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		process.cwd(),
		native,
	);
	assert.equal(result.status, "blocked");
	assert.equal(statusCalls, 1);
	const collectBindings = result.collectBindings as readonly { collectBinding: string }[];
	assert.equal(collectBindings.length, 1);
	assert.deepEqual(JSON.parse(collectBindings[0]!.collectBinding), collectInput(lineageId));
});

test("interleaved sessions sharing a CLI retain only their own capture routes", async () => {
	const [a, b] = ["interleaved-a", "interleaved-b"];
	const inputs = new Map([[a, correctionPlanInput(a)], [b, correctionPlanInput(b)]]);
	const requests: Array<Record<string, unknown>> = [];
	let releaseA!: () => void, releaseB!: () => void, readyA!: () => void, readyB!: () => void;
	const waits = [new Promise<void>((resolve) => { releaseA = resolve; }), new Promise<void>((resolve) => { releaseB = resolve; })];
	const ready = [new Promise<void>((resolve) => { readyA = resolve; }), new Promise<void>((resolve) => { readyB = resolve; })];
	let captures = 0;
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			const index = requests.length - 1;
			if (index < 2) { [readyA, readyB][index]!(); await waits[index]!; }
			const lineageId = String(request.lineageId);
			return status(lineageId, [inputs.get(lineageId)!]);
		},
		captureCorrectionPlan: async ({ argumentTokens }: { argumentTokens: readonly string[] }) => {
			captures += 1;
			const lineageId = argumentTokens.find((token) => token.startsWith("--lineage="))!.slice("--lineage=".length);
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "correction_required", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const { controller, capture, sessionShutdown } = reviewRuntime(native, new CandidateViewRegistry());
	const contexts = [a, b].map((id) => ({ ...reviewContext(process.cwd()), sessionManager: { getSessionId: () => id } } as unknown as ExtensionContext));
	const listedA = controller.execute("", { operation: "status", lineageId: a, input: JSON.stringify({ baseRef: "base-a", committedOnly: true }) }, undefined, undefined, contexts[0]!);
	await ready[0];
	const listedB = controller.execute("", { operation: "status", lineageId: b, input: JSON.stringify({ baseRef: "base-b", committedOnly: true }) }, undefined, undefined, contexts[1]!);
	await ready[1]; releaseA(); await listedA; releaseB();
	const [resultA, resultB] = await Promise.all([listedA, listedB]);
	const ownA = await capture.execute("", { lineageId: a, collectBinding: bindingOf(resultA.details as Record<string, unknown>), correctionLines: 1 }, undefined, undefined, contexts[0]!);
	const ownB = await capture.execute("", { lineageId: b, collectBinding: bindingOf(resultB.details as Record<string, unknown>), correctionLines: 1 }, undefined, undefined, contexts[1]!);
	const foreign = await capture.execute("", { lineageId: a, collectBinding: bindingOf(resultA.details as Record<string, unknown>), correctionLines: 1 }, undefined, undefined, contexts[1]!);
	await sessionShutdown({}, contexts[0]!);
	const cleaned = await capture.execute("", { lineageId: a, collectBinding: bindingOf(resultA.details as Record<string, unknown>), correctionLines: 1 }, undefined, undefined, contexts[0]!);
	assert.deepEqual({
		outcomes: [ownA, ownB, foreign, cleaned].map(({ details }) => (details as { outcome?: string }).outcome),
		revalidationCalls: requests.length - 2,
		captures,
	}, { outcomes: ["native-last-event-closure", "native-last-event-closure", "capture-binding-rejected", "capture-binding-rejected"], revalidationCalls: 2, captures: 2 });
});

test("REPAIR retains frozen committed collect selectors and leaves workspace routes unselected", async (t) => {
	const candidateViews = new CandidateViewRegistry(); t.after(() => candidateViews.cleanupAll());
	const cwd = repository(t), lineageId = "repair-committed", input = correctionPlanInput(lineageId); const view = candidateViews.create({ contributorRoot: cwd, baseRef: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), committedOnly: true });
	candidateViews.retain(view.token, lineageId); const frozenTarget = candidateViews.resolveProjection(lineageId, cwd), selections = new Map(), requests: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async (request: Record<string, unknown>) => { requests.push(request); return requests.length === 3 ? status(lineageId, [], "approved") : status(lineageId, [input]); },
		captureCorrectionPlan: async () => { throw Object.assign(new Error("lost response"), { mutationOutcome: "unknown", nextAction: "review.status" }); },
	} as unknown as NativeReviewCli;
	await __testing.executeReviewControllerOperation({ operation: "repair", lineageId }, cwd, native, undefined, candidateViews, undefined, selections);
	const result = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(input), correctionLines: 1 }, cwd, native, undefined, candidateViews, selections, true);
	const workspaceLineage = "repair-workspace", workspaceRequests: Array<Record<string, unknown>> = [];
	await __testing.executeReviewControllerOperation({ operation: "repair", lineageId: workspaceLineage }, cwd, { targetStatus: async (request: Record<string, unknown>) => { workspaceRequests.push(request); return status(workspaceLineage); } } as unknown as NativeReviewCli, undefined, candidateViews);
	assert.deepEqual({ outcome: result.outcome, routes: selections.size, selectors: requests.map(({ cwd: requestCwd, lineageId: id, baseRef, committedOnly }) => ({ cwd: requestCwd, lineageId: id, baseRef, committedOnly })) }, { outcome: "native-capture-outcome-unknown", routes: 0, selectors: Array.from({ length: 3 }, () => ({ cwd, lineageId, baseRef: frozenTarget.baseCommit, committedOnly: true })) });
	assert.deepEqual(workspaceRequests, [{ cwd, lineageId: workspaceLineage }]);
});

test("STATUS preserves retained intended-untracked selection through selectorless same-lineage replacement collection", async () => {
	const cwd = process.cwd();
	const lineageId = "selectorless-replacement";
	const selectedUntracked = {
		untrackedScope: "select",
		expectedUntrackedInventory: "inventory-sha256",
		intendedUntracked: ["generated/report.json"],
	};
	const initial = correctionPlanInput(lineageId);
	const replacement: ReviewCollectInputV3 = {
		...correctionPlanInput(lineageId),
		arguments: [
			...correctionPlanInput(lineageId).arguments,
			{ name: "replacement", value: "b", token: "--replacement=b" },
		],
	};
	const selections = new Map();
	const requests: Array<Record<string, unknown>> = [];
	let captures = 0;
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return "baseRef" in request
				? status(lineageId, [])
				: status(lineageId, [requests.length === 1 ? initial : replacement]);
		},
		captureCorrectionPlan: async ({ correctionLines, cwd: captureCwd }: { correctionLines: number; cwd: string }) => {
			captures += 1;
			assert.deepEqual({ correctionLines, cwd: captureCwd }, { correctionLines: 1, cwd });
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "correction_required", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;

	const initialStatus = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId, input: JSON.stringify(selectedUntracked) },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	assert.equal(selections.size, 2);
	await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId, input: JSON.stringify({ baseRef: "main", committedOnly: true }) },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	assert.deepEqual(requests[1], { cwd, lineageId, agent: "pi", baseRef: "main", committedOnly: true });
	assert.equal(selections.size, 1);
	const replacementStatus = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	assert.equal(selections.size, 2);
	const bindingA = bindingOf(initialStatus);
	const bindingB = bindingOf(replacementStatus);
	assert.notEqual(bindingA, bindingB);

	const stale = await __testing.executeReviewCaptureOperation(
		{ lineageId, collectBinding: bindingA, correctionLines: 1 },
		cwd,
		native,
		undefined,
		undefined,
		selections,
		true,
	);
	assert.deepEqual({ outcome: stale.outcome, requests: requests.length, captures }, { outcome: "capture-binding-rejected", requests: 3, captures: 0 });

	const captured = await __testing.executeReviewCaptureOperation(
		{ lineageId, collectBinding: bindingB, correctionLines: 1 },
		cwd,
		native,
		undefined,
		undefined,
		selections,
		true,
	);
	assert.equal(captured.outcome, "native-last-event-closure");
	assert.deepEqual(requests, [
		{ cwd, lineageId, agent: "pi", ...selectedUntracked },
		{ cwd, lineageId, agent: "pi", baseRef: "main", committedOnly: true },
		{ cwd, lineageId, agent: "pi", ...selectedUntracked },
		{ cwd, lineageId, agent: "pi", ...selectedUntracked },
	]);
	assert.equal(captures, 1);

	const override = { ...selectedUntracked, expectedUntrackedInventory: "override-inventory", intendedUntracked: ["generated/override.json"] };
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify(override) }, cwd, native, undefined, undefined, undefined, selections);
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, cwd, native, undefined, undefined, undefined, selections);
	assert.deepEqual(requests.slice(-2), Array.from({ length: 2 }, () => ({ cwd, lineageId, agent: "pi", ...override })));
});

test("route retention caps, rejects collisions and invalid selectors, and clears every terminal state", async () => {
	const native = { targetStatus: async (request: Record<string, unknown>) => status(String(request.lineageId)) } as unknown as NativeReviewCli;
	const selections = new Map();
	for (let index = 0; index <= 64; index += 1) await __testing.executeReviewControllerOperation({ operation: "status", lineageId: `bounded-${index}`, input: JSON.stringify({ baseRef: `base-${index}`, committedOnly: true }) }, process.cwd(), native, undefined, undefined, undefined, selections);
	const evicted = await __testing.executeReviewCaptureOperation({ lineageId: "bounded-0", collectBinding: JSON.stringify(collectInput("bounded-0")) }, process.cwd(), native, undefined, undefined, selections, true);
	const collision = new Map(), lineageId = "route-collision", input = correctionPlanInput(lineageId);
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify({ baseRef: "base-a", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(lineageId, [input]) } as unknown as NativeReviewCli, undefined, undefined, undefined, collision);
	const rejected = await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify({ baseRef: "base-b", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(lineageId, [input]) } as unknown as NativeReviewCli, undefined, undefined, undefined, collision);
	for (const state of ["invalidated", "approved", "escalated"]) {
		const routes = new Map(), id = `terminal-${state}`;
		await __testing.executeReviewControllerOperation({ operation: "status", lineageId: id, input: JSON.stringify({ baseRef: "base", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(id, [input]) } as unknown as NativeReviewCli, undefined, undefined, undefined, routes);
		await __testing.executeReviewControllerOperation({ operation: "status", lineageId: id }, process.cwd(), { targetStatus: async () => status(id, [], state) } as unknown as NativeReviewCli, undefined, undefined, undefined, routes);
		assert.equal(routes.size, 0, state);
	}
	let calls = 0;
	for (const value of [{ baseRef: "", committedOnly: true }, { committedOnly: true }, { baseRef: "base" }, { baseRef: "base", committedOnly: false }]) {
		const result = await __testing.executeReviewControllerOperation({ operation: "status", input: JSON.stringify(value) }, process.cwd(), { targetStatus: async () => { calls += 1; return status("unreachable"); } } as unknown as NativeReviewCli);
		assert.equal(result.outcome, "native-status-input-invalid");
	}
	assert.deepEqual({ routes: selections.size, evicted: evicted.outcome, collision: rejected.outcome, calls }, { routes: 64, evicted: "capture-binding-rejected", collision: "capture-route-registration-rejected", calls: 0 });
});

test("public INSPECT and STATUS publish the exact pi-bound binding that capture revalidates", async () => {
	const lineageId = "pi-bound-public-binding";
	const agentlessInput = collectInput(lineageId);
	const piBoundInput: ReviewCollectInputV3 = {
		...agentlessInput,
		arguments: [
			...agentlessInput.arguments,
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "materialize", value: "true", token: "--materialize=true" },
		],
		submission: {
			...agentlessInput.submission!,
			argumentTokens: [
				...agentlessInput.submission!.argumentTokens.slice(0, -1),
				"--agent=pi",
				"--materialize=true",
				"--input={{value}}",
			],
			values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: 9 }],
		},
	};
	const agentlessStatus = status(lineageId);
	agentlessStatus.nextTransition = {
		kind: "collect",
		reasonCode: "capture_required",
		collect: { inputs: [agentlessInput] },
	};
	const piBoundStatus = status(lineageId);
	piBoundStatus.nextTransition = {
		kind: "collect",
		reasonCode: "capture_required",
		collect: { inputs: [piBoundInput] },
	};
	const requests: Array<{ agent?: string; lineageId?: string }> = [];
	const native = {
		targetStatus: async (request: { agent?: string; lineageId?: string }) => {
			requests.push(request);
			return request.agent === "pi" ? piBoundStatus : agentlessStatus;
		},
	} as unknown as NativeReviewCli;

	const publicStatus = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		process.cwd(),
		native,
	);
	const statusBinding = (publicStatus.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
	assert.deepEqual(JSON.parse(statusBinding), piBoundInput);

	const publicInspect = await __testing.executeReviewControllerOperation(
		{ operation: "inspect" },
		process.cwd(),
		native,
	);
	const inspectBinding = (publicInspect.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
	assert.deepEqual(JSON.parse(inspectBinding), piBoundInput);

	const publicStart = await __testing.executeReviewControllerOperation(
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
		process.cwd(),
		native,
	);
	const startBinding = (publicStart.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
	assert.deepEqual(JSON.parse(startBinding), piBoundInput);

	const forecast = await __testing.executeReviewCaptureOperation(
		{ lineageId, collectBinding: statusBinding },
		process.cwd(),
		native,
	);
	assert.equal(forecast.outcome, "reviewer-model-run-forecast");
	assert.deepEqual(requests.map((request) => request.agent), ["pi", "pi", "pi", "pi"]);
	assert.deepEqual(requests.map((request) => request.lineageId), [lineageId, undefined, undefined, lineageId]);
});

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-routing-"));
	t.after(() => {
		execFileSync("chmod", ["-R", "u+rwx", cwd], { stdio: "ignore" });
		chmodSync(cwd, 0o700);
		rmSync(cwd, { recursive: true, force: true });
	});
	execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "tracked.txt"), "base\n");
	execFileSync("git", ["add", "tracked.txt"], { cwd, stdio: "ignore" });
	execFileSync("git", ["-c", "user.name=Routing Test", "-c", "user.email=routing@example.invalid", "commit", "-m", "base"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "tracked.txt"), "candidate\n");
	return cwd;
}

interface RegisteredControllerTool {
	execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<{ details?: unknown }>;
}

function reviewRuntime(nativeReviewCli: NativeReviewCli, candidateViews: CandidateViewRegistry) {
	const tools = new Map<string, RegisteredControllerTool>();
	let toolCall: ((event: { toolName: string; input: unknown }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
	let sessionShutdown: ((event: unknown, ctx: ExtensionContext) => unknown) | undefined;
	createGentleAiExtension({ nativeReviewCli, candidateViews })({
		on(name: string, handler: (event: { toolName: string; input: unknown }, ctx: ExtensionContext) => Promise<unknown>) {
			if (name === "tool_call") toolCall = handler;
			if (name === "session_shutdown") sessionShutdown = handler as unknown as (event: unknown, ctx: ExtensionContext) => unknown;
		},
		registerTool(definition: RegisteredControllerTool & { name: string }) { tools.set(definition.name, definition); },
		registerCommand() {},
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	const capture = tools.get("gentle_review_capture");
	assert.ok(controller);
	assert.ok(capture);
	assert.ok(toolCall);
	assert.ok(sessionShutdown);
	return { controller, capture, toolCall, sessionShutdown };
}

function reviewContext(cwd: string): ExtensionContext {
	return { cwd, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionContext;
}

function startStatus(cwd: string, baseRef?: string): ReviewStatusV3 {
	const candidateViews = new CandidateViewRegistry();
	const view = candidateViews.create({ contributorRoot: cwd, ...(baseRef === undefined ? {} : { baseRef, committedOnly: true }) });
	try {
		return {
			contract: "gentle-ai.review-integration/v2",
			applicability: "unrelated",
			action: "start",
			replayability: "not_replayable",
			targetIdentity: SHA,
			projection: {
				schema: "gentle-ai.review-candidate-projection/v1",
				kind: "current-changes",
				projection: "workspace",
				baseTree: view.baseTree,
				initialReviewTree: view.candidateTree,
				currentCandidateTree: view.candidateTree,
				pathsDigest: SHA,
				paths: [...view.paths],
				intendedUntracked: [],
				intendedUntrackedProof: SHA,
				initialSnapshotIdentity: SHA,
				currentSnapshotIdentity: SHA,
			},
			candidates: [],
			raw: { schema: "gentle-ai.review-integration.status/v5" },
		} as unknown as ReviewStatusV3;
	} finally {
		candidateViews.cleanup(view.token);
	}
}

test("ordinary START binds the native workspace candidate and returns the native result", async (t) => {
	const cwd = repository(t);
	const target = startStatus(cwd);
	let targetCalls = 0;
	let startCalls = 0;
	const native = {
		targetStatus: async (request: { cwd: string }) => {
			targetCalls += 1;
			assert.equal(request.cwd, cwd);
			return target;
		},
		start: async (request: { targetIdentity?: string }) => {
			startCalls += 1;
			assert.equal(request.targetIdentity, SHA);
			return { lineageId: "review-started", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [], raw: {} };
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.operation, "start");
	assert.equal(targetCalls, 1);
	assert.equal(startCalls, 1);
});

test("ordinary START relays native consent without authoring or advancing it", async (t) => {
	const cwd = repository(t);
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.outcome, "native-review-consent-required");
	assert.equal(typeof result.consent_binding, "string");
	assert.equal(result.mutation_outcome, "none");
});

test("ordinary START obeys the review-mode kill switch before target STATUS", async () => {
	let targetCalls = 0;
	const native = {
		reviewMode: async () => ({ operation: "status", scope: "clone", status: { global: "on", cloneLocal: "off", effective: "off", source: "clone_local" } }),
		targetStatus: async () => { targetCalls += 1; return status("unreachable"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, process.cwd(), native);
	assert.equal(result.outcome, "review-mode-disabled");
	assert.equal(targetCalls, 0);
});

test("STATUS preserves a native process failure without inventing authority recovery", async () => {
	const native = {
		targetStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, "review/status", false, false, "native unavailable"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status" }, process.cwd(), native);
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
});

test("STATUS preserves ambiguous native status as read-only provider-owned state", async () => {
	const lineageId = "ambiguous-lineage";
	const native = {
		targetStatus: async () => ({ ...status(lineageId), applicability: "ambiguous", action: "stop" }) as ReviewStatusV3,
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, process.cwd(), native);
	assert.equal(result.operation, "status");
	assert.equal(result.status, "blocked");
	assert.deepEqual(result.result, { schema: "gentle-ai.review-integration.status/v5" });
});

test("STATUS routes an explicit workspace root to the provider and reports it", async () => {
	const cwd = process.cwd();
	const native = {
		targetStatus: async (request: { cwd: string }) => {
			assert.equal(request.cwd, cwd);
			return status("workspace-root");
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status", lineageId: "workspace-root", workspaceRoot: cwd }, cwd, native);
	assert.equal(result.workspace_root, cwd);
});

test("a public provider-role collect binding remains reachable through one native capture", async () => {
	const closureLineage = "review-61da8af1a89ff96a";
	const baseInput = collectInput(closureLineage);
	const { submission: _submission, artifactSubject: _artifactSubject, ...roleInput } = baseInput;
	void _submission;
	void _artifactSubject;
	const input = {
		...roleInput,
		name: "provider_refuter",
		schema: "https://gentle-ai.dev/schema/review/refuter/v1",
		captureOperation: "review.capture-refuter",
		arguments: [
			{ name: "lineage", value: closureLineage, token: `--lineage=${closureLineage}` },
			{ name: "target", value: SHA, token: `--target=${SHA}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
	} as unknown as ReviewCollectInputV3;
	const roleStatus = { ...status(closureLineage), nextTransition: { kind: "collect", reasonCode: "provider_role_required", collect: { inputs: [input] } } } as ReviewStatusV3;
	let captureCalls = 0;
	const native = {
		targetStatus: async (request: { agent?: string }) => {
			assert.equal(request.agent, "pi");
			return roleStatus;
		},
		captureProviderRole: async (request: { captureOperation: string; argumentTokens: readonly string[] }) => {
			captureCalls += 1;
			assert.equal(request.captureOperation, "review.capture-refuter");
			assert.deepEqual(request.argumentTokens, [`--lineage=${closureLineage}`, `--target=${SHA}`, "--agent=pi", "--execute=true"]);
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-refuter", lineageId: closureLineage, state: "approved", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewCaptureOperation({ lineageId: closureLineage, collectBinding: JSON.stringify(input) }, process.cwd(), native);
	assert.equal(result.status, "closed");
	assert.equal(result.outcome, "native-last-event-closure");
	assert.equal(captureCalls, 1);
});

test("ordinary START follows a provider reconciliation status without creating a candidate or invoking START", async () => {
	let startCalls = 0;
	const native = {
		targetStatus: async () => status("reconcile-current"),
		start: async () => { startCalls += 1; throw new Error("must not start"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, process.cwd(), native);
	assert.equal(result.status, "blocked");
	assert.deepEqual(result.result, { schema: "gentle-ai.review-integration.status/v5" });
	assert.equal(startCalls, 0);
});

test("STATUS rejects locally-authored untracked input before reading native authority", async () => {
	let statusCalls = 0;
	const native = {
		targetStatus: async () => { statusCalls += 1; return status("unreachable"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status", input: JSON.stringify({ unexpected: true }) }, process.cwd(), native);
	assert.equal(result.outcome, "native-status-input-invalid");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(statusCalls, 0);
});

test("INSPECT remains a read-only negotiated STATUS projection with no inventory reconstruction", async () => {
	let calls = 0;
	const native = {
		targetStatus: async (request: { cwd: string }) => {
			calls += 1;
			assert.equal(request.cwd, process.cwd());
			return { ...status("inspect-lineage"), applicability: "ambiguous" } as ReviewStatusV3;
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "inspect" }, process.cwd(), native);
	assert.equal(result.operation, "inspect");
	assert.equal(result.status, "blocked");
	assert.equal("mutation_performed" in result, false);
	assert.equal(calls, 1);
});

test("targeted-validator provider vectors preserve their nonuniform native closure operation", async () => {
	const closureLineage = "review-validator";
	const baseInput = collectInput(closureLineage);
	const { submission: _submission, artifactSubject: _artifactSubject, ...roleInput } = baseInput;
	void _submission;
	void _artifactSubject;
	const input = {
		...roleInput,
		name: "provider_targeted_validator",
		schema: "https://gentle-ai.dev/schema/review/targeted-validator/v1",
		captureOperation: "review.capture-validation",
		arguments: [
			{ name: "lineage", value: closureLineage, token: `--lineage=${closureLineage}` },
			{ name: "target", value: SHA, token: `--target=${SHA}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
	} as unknown as ReviewCollectInputV3;
	const roleStatus = { ...status(closureLineage), nextTransition: { kind: "collect", reasonCode: "provider_role_required", collect: { inputs: [input] } } } as ReviewStatusV3;
	const native = {
		targetStatus: async () => roleStatus,
		captureProviderRole: async (request: { captureOperation: string }) => {
			assert.equal(request.captureOperation, "review.capture-validation");
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review/capture-validation", lineageId: closureLineage, state: "approved", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewCaptureOperation({ lineageId: closureLineage, collectBinding: JSON.stringify(input) }, process.cwd(), native);
	assert.equal(result.status, "closed");
	assert.equal(result.outcome, "native-last-event-closure");
});

test("correction-plan collection demands provider-bounded lines, then returns its terminal closure", async () => {
	const lineageId = "review-correction";
	const input = {
		name: "correction_plan",
		schema: "https://gentle-ai.dev/schema/review/correction-plan/v1",
		captureOperation: "review.capture-correction-plan",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "target", value: SHA, token: `--target=${SHA}` },
		],
		submission: {
			operationToken: "capture-correction-plan",
			argumentTokens: [`--lineage=${lineageId}`, "--correction-lines={{value}}"],
			values: [{ slot: "correction_lines", domain: "integer", substitutionLocation: 1, minimum: 2, maximum: 8 }],
		},
	} as unknown as ReviewCollectInputV3;
	const planStatus = { ...status(lineageId), nextTransition: { kind: "collect", reasonCode: "correction_plan_required", collect: { inputs: [input] } } } as ReviewStatusV3;
	let captures = 0;
	const native = {
		targetStatus: async () => planStatus,
		captureCorrectionPlan: async (request: { correctionLines: number; argumentTokens: readonly string[] }) => {
			captures += 1;
			assert.equal(request.correctionLines, 3);
			assert.deepEqual(request.argumentTokens, [`--lineage=${lineageId}`, "--correction-lines={{value}}"]);
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "approved", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const binding = JSON.stringify(input);
	const required = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: binding }, process.cwd(), native);
	assert.equal(required.outcome, "correction-lines-required");
	const complete = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: binding, correctionLines: 3 }, process.cwd(), native);
	assert.equal(complete.outcome, "native-last-event-closure");
	assert.equal(captures, 1);
});

test("capture refuses a stale binding before any provider mutation", async () => {
	const lineageId = "review-stale-binding";
	const current = collectInput(lineageId);
	const native = {
		targetStatus: async () => status(lineageId),
		captureResult: async () => { throw new Error("must not capture"); },
	} as unknown as NativeReviewCli;
	const stale = { ...current, arguments: [...current.arguments, { name: "unexpected", value: "drift", token: "--unexpected=drift" }] };
	const result = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(stale) }, process.cwd(), native);
	assert.equal(result.outcome, "capture-binding-rejected");
	assert.equal(result.mutation_outcome, "none");
	const foreign = { ...current, arguments: current.arguments.map((argument) => argument.name === "lineage" ? { ...argument, value: "foreign-lineage", token: "--lineage=foreign-lineage" } : argument) };
	const foreignResult = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(foreign) }, process.cwd(), native);
	assert.equal(foreignResult.outcome, "capture-binding-rejected");
	assert.equal(foreignResult.mutation_outcome, "none");
});

test("ordinary START rejects unknown, legacy-policy, and invalid focus inputs before the mode gate", async () => {
	for (const input of [
		{ mode: "ordinary", unexpected: true },
		{ mode: "ordinary", policyHash: "legacy-policy" },
		{ mode: "ordinary", focus: "not-a-native-focus" },
	]) {
		let statusCalls = 0;
		const native = {
			reviewMode: async () => { throw new Error("mode gate must not run"); },
			targetStatus: async () => { statusCalls += 1; return status("unreachable"); },
		} as unknown as NativeReviewCli;
		const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify(input) }, process.cwd(), native);
		assert.match(String(result.outcome), /^native-start-/);
		assert.equal(result.mutation_outcome, "none");
		assert.equal(statusCalls, 0);
	}
});

test("ordinary START preserves a target STATUS failure instead of constructing compact fallback authority", async () => {
	const native = {
		targetStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, "review/status", true, false, "status too large"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, process.cwd(), native);
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.equal((result.diagnostics as { error_code?: string }).error_code, NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT);
});

test("ordinary START leaves the review-mode gate dark when the native client does not expose it", async (t) => {
	const cwd = repository(t);
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async () => ({ lineageId: "dark-mode-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true, riskReasons: [] }),
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.operation, "start");
	assert.equal((result.result as { lineage_id?: string }).lineage_id, "dark-mode-lineage");
});

test("current STATUS binding allows exactly one provider capture and never follows a retired lifecycle route", async () => {
	const lineageId = "last-event-provider-role";
	const base = collectInput(lineageId);
	const { submission: _submission, artifactSubject: _artifactSubject, ...withoutReviewerDocument } = base;
	void _submission;
	void _artifactSubject;
	const input = {
		...withoutReviewerDocument,
		name: "provider_refuter",
		schema: "https://gentle-ai.dev/schema/review/refuter/v1",
		captureOperation: "review.capture-refuter",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "target", value: SHA, token: `--target=${SHA}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
	} as unknown as ReviewCollectInputV3;
	let statusCalls = 0;
	let captureCalls = 0;
	const native = {
		targetStatus: async () => {
			statusCalls += 1;
			return { ...status(lineageId), nextTransition: { kind: "collect", reasonCode: "provider_role_required", collect: { inputs: [input] } } } as ReviewStatusV3;
		},
		captureProviderRole: async (request: { captureOperation: string; argumentTokens: readonly string[] }) => {
			captureCalls += 1;
			assert.equal(request.captureOperation, "review.capture-refuter");
			assert.deepEqual(request.argumentTokens, [`--lineage=${lineageId}`, `--target=${SHA}`, "--agent=pi", "--execute=true"]);
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-refuter", lineageId, state: "approved", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(input) }, process.cwd(), native);
	assert.equal(result.outcome, "native-last-event-closure");
	assert.equal(result.status, "closed");
	assert.equal(statusCalls, 1);
	assert.equal(captureCalls, 1);
});

test("ordinary START transports native focus and safe policy inputs without rebuilding provider authority", async (t) => {
	const cwd = repository(t);
	const seen: Array<Record<string, unknown>> = [];
	mkdirSync(join(cwd, ".gentle-ai", "policies"), { recursive: true });
	const policyPath = join(cwd, ".gentle-ai", "policies", "focus.json");
	writeFileSync(policyPath, "{}\n");
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async (request: Record<string, unknown>) => {
			seen.push(request);
			return { lineageId: `focus-${seen.length}`, state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true, riskReasons: [] };
		},
	} as unknown as NativeReviewCli;
	for (const focus of [undefined, "risk", "resilience", "readability", "reliability"] as const) {
		const input = { mode: "ordinary", ...(focus === undefined ? {} : { focus }), ...(focus === "risk" ? { policyPath: ".gentle-ai/policies/focus.json" } : {}) };
		const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify(input) }, cwd, native);
		assert.equal(result.operation, "start");
	}
	assert.equal(seen.length, 5);
	assert.equal("focus" in seen[0]!, false);
	assert.equal(seen[1]?.focus, "risk");
	assert.equal(seen[1]?.policyPath, policyPath);
	assert.deepEqual(seen.slice(2).map((request) => request.focus), ["resilience", "readability", "reliability"]);

	let statusCalls = 0;
	for (const input of [
		{ mode: "ordinary", focus: "unsupported" },
		{ mode: "ordinary", policyHash: "retired-local-policy" },
		{ mode: "ordinary", policyPath: "../outside" },
	]) {
		const rejected = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify(input) }, cwd, {
			targetStatus: async () => { statusCalls += 1; return startStatus(cwd); },
		} as unknown as NativeReviewCli);
		assert.match(String(rejected.outcome), /^native-start-/);
		assert.equal(rejected.mutation_outcome, "none");
	}
	assert.equal(statusCalls, 0);
});

test("ordinary START keeps default and explicit base selection fail-closed before native mutation", async (t) => {
	const cwd = repository(t);
	let targetCalls = 0;
	const native = {
		targetStatus: async () => { targetCalls += 1; return startStatus(cwd); },
		start: async () => { throw new Error("must not start"); },
	} as unknown as NativeReviewCli;
	for (const input of [
		{ mode: "ordinary", baseRef: "missing-base", committedOnly: true },
		{ mode: "ordinary", baseRef: "HEAD", committedOnly: false },
		{ mode: "ordinary", baseRef: " HEAD", committedOnly: true },
		{ mode: "ordinary", committedOnly: true },
	]) {
		const rejected = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify(input) }, cwd, native);
		assert.match(String(rejected.outcome), /^native-start-/);
		assert.equal(rejected.mutation_outcome, "none");
	}
	assert.equal(targetCalls, 0);
});

test("START and consent ambiguity reconciliation register their returned committed collect route", async (t) => {
	const cwd = repository(t), baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
	const lineageId = "reconciled-collect", input = correctionPlanInput(lineageId), unknown = () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, "review/start", true, true, "unknown mutation"); };
	const selectors = (requests: readonly Record<string, unknown>[]) => requests.map(({ baseRef: base, committedOnly }) => ({ baseRef: base, committedOnly }));
	const directRequests: Array<Record<string, unknown>> = [], directRoutes = new Map();
	const directNative = {
		targetStatus: async (request: Record<string, unknown>) => { directRequests.push(request); return directRequests.length === 1 ? startStatus(cwd, baseRef) : status(lineageId, [input]); },
		start: unknown,
		captureCorrectionPlan: async () => ({ schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "correction_required", storeRevision: SHA }),
	} as unknown as NativeReviewCli;
	await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef, committedOnly: true }) }, cwd, directNative, undefined, undefined, undefined, directRoutes);
	const directCapture = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(input), correctionLines: 1 }, cwd, directNative, undefined, undefined, directRoutes, true);
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const consentRequests: Array<Record<string, unknown>> = [], consentRoutes = new Map(), registry = new PendingReviewConsentRegistry(), session = Symbol("consent-session");
	const consentNative = {
		targetStatus: async (request: Record<string, unknown>) => { consentRequests.push(request); return consentRequests.length === 1 ? startStatus(cwd, baseRef) : status(lineageId, [input]); },
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
		answerConsent: unknown,
		captureCorrectionPlan: directNative.captureCorrectionPlan,
	} as unknown as NativeReviewCli;
	const run = (parameters: Record<string, unknown>) => __testing.executeReviewControllerOperation(parameters, cwd, consentNative, undefined, undefined, undefined, consentRoutes, registry, session);
	const pending = await run({ operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef, committedOnly: true }) });
	await run({ operation: "answer-consent", input: JSON.stringify({ consentBinding: pending.consent_binding, answer: "granted" }) });
	const consentCapture = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(input), correctionLines: 1 }, cwd, consentNative, undefined, undefined, consentRoutes, true);
	assert.deepEqual({
		outcomes: [directCapture.outcome, consentCapture.outcome],
		selectors: [selectors(directRequests), selectors(consentRequests)],
	}, {
		outcomes: ["native-last-event-closure", "native-last-event-closure"],
		selectors: [Array.from({ length: 3 }, () => ({ baseRef, committedOnly: true })), Array.from({ length: 3 }, () => ({ baseRef, committedOnly: true }))],
	});
});

test("ordinary START refuses a target projection that no longer matches the frozen candidate", async (t) => {
	const cwd = repository(t);
	let startCalls = 0;
	const target = startStatus(cwd);
	target.projection = { ...target.projection, currentCandidateTree: "c".repeat(40) };
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, {
		targetStatus: async () => target,
		start: async () => { startCalls += 1; throw new Error("must not start"); },
	} as unknown as NativeReviewCli);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(startCalls, 0);
});

test("controller-owned dispatch confines single and parallel graph actors to the current candidate view", async (t) => {
	const cwd = repository(t);
	const candidateViews = new CandidateViewRegistry();
	const lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
	const { controller, toolCall } = reviewRuntime({
		targetStatus: async () => startStatus(cwd),
		start: async () => ({ lineageId: "current-4r", state: "reviewing", riskLevel: "high", selectedLenses: lenses, changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true, riskReasons: [] }),
	} as unknown as NativeReviewCli, candidateViews);
	await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, reviewContext(cwd));
	const current = candidateViews.resolveForLens("current-4r", "review-risk");
	try {
		const single = { agent: "review-risk", task: "Inspect", mode: "task" };
		const parallel = { agents: [...lenses], task: "Inspect", mode: "task" };
		assert.equal(await toolCall({ toolName: "subagent_run", input: single }, reviewContext(cwd)), undefined);
		assert.equal(await toolCall({ toolName: "subagent_run", input: parallel }, reviewContext(cwd)), undefined);
		for (const task of [single.task, parallel.task]) {
			assert.match(task, /Controller-owned review lineage: `current-4r`/);
			assert.match(task, new RegExp(`Frozen candidate tree: \`${current.candidateTree}\``));
			assert.match(task, /ambient contributor working directory is out of scope/);
		}
		for (const malformed of [
			{ agent: "review-risk", agents: ["review-risk"], task: "Inspect", mode: "task" },
			{ agents: ["review-risk", "worker"], task: "Inspect", mode: "task" },
			{ agent: "review-risk", task: "Inspect", mode: "background" },
		]) {
			const rejected = await toolCall({ toolName: "subagent_run", input: malformed }, reviewContext(cwd)) as { block?: boolean };
			assert.equal(rejected.block, true);
		}
	} finally {
		candidateViews.cleanup(current.token);
	}
});

test("controller forwards AbortSignal and retains typed native diagnostics without fallback authority", async (t) => {
	const cwd = repository(t);
	const controller = new AbortController();
	let targetSignal: AbortSignal | undefined;
	let startSignal: AbortSignal | undefined;
	const native = {
		targetStatus: async (request: { signal?: AbortSignal }) => { targetSignal = request.signal; return startStatus(cwd); },
		start: async (request: { signal?: AbortSignal }) => {
			startSignal = request.signal;
			return { lineageId: "signal-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true, riskReasons: [] };
		},
	} as unknown as NativeReviewCli;
	const started = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, controller.signal);
	assert.equal(started.operation, "start");
	assert.equal(targetSignal, controller.signal);
	assert.equal(startSignal, controller.signal);

	for (const operation of ["inspect", "start", "repair"] as const) {
		const input = operation === "start" ? JSON.stringify({ mode: "ordinary" }) : undefined;
		const failed = await __testing.executeReviewControllerOperation({ operation, ...(input === undefined ? {} : { input }) }, cwd, {
			targetStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING, "review/status", false, false, "package binary missing"); },
		} as unknown as NativeReviewCli);
		assert.equal(failed.outcome, "native-status-package-binary-missing");
		assert.equal(failed.mutation_outcome, "none");
		assert.equal((failed.diagnostics as { error_code?: string }).error_code, NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING);
	}
});
