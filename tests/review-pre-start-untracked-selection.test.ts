import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";
import type { NativeReviewCli } from "../lib/native-review-cli.ts";
import type { ReviewCollectInputV3, ReviewStatusV3 } from "../lib/review-integration-v2.ts";

const SHA = `sha256:${"a".repeat(64)}`;
const TREE = "b".repeat(40);
const INVENTORY = `sha256:${"d".repeat(64)}`;

function preStartSelectionInput(inventory = INVENTORY, eligible: readonly string[] = ["selected.txt", "excluded.txt"]): ReviewCollectInputV3 {
	return {
		name: "intended_untracked_selection",
		schema: "https://gentle-ai.dev/schema/review/intended-untracked-selection/v1",
		captureOperation: "external.select_intended_untracked",
		arguments: [
			{ name: "expected_untracked_inventory", value: inventory },
			{ name: "eligible_paths_json", value: JSON.stringify(eligible) },
		],
	};
}

function preStartStatus(inputs: readonly ReviewCollectInputV3[], applicability = "unrelated"): ReviewStatusV3 {
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability,
		action: "start",
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
		candidates: [],
		nextTransition: { kind: "collect", reasonCode: "intended_untracked_selection_required", collect: { inputs } },
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
}

function lineageBoundStatus(lineageId: string): ReviewStatusV3 {
	const bound = preStartStatus([]) as unknown as Record<string, unknown>;
	return {
		...bound,
		applicability: "current_target",
		action: "stop",
		authority: { version: "compact-v2", lineageId, state: "reviewing", generation: 1, revision: SHA },
		nextTransition: { kind: "stop", reasonCode: "capture_required" },
	} as unknown as ReviewStatusV3;
}

function startableStatus(): ReviewStatusV3 {
	const startable = preStartStatus([]) as unknown as Record<string, unknown>;
	delete startable.nextTransition;
	return startable as unknown as ReviewStatusV3;
}

function bindingOf(result: Record<string, unknown>): string {
	return (result.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
}

test("pre-START selection capture retains one exact wrapper answer that ordinary START consumes once", async () => {
	const cwd = process.cwd();
	const selections = new Map();
	const requests: Array<Record<string, unknown>> = [];
	const startRequests: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return request.untrackedScope === undefined
				? preStartStatus([preStartSelectionInput()])
				: startableStatus();
		},
		start: async (request: Record<string, unknown>) => {
			startRequests.push(request);
			return { lineageId: "selected-lineage", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [], raw: {} };
		},
	} as unknown as NativeReviewCli;

	const published = await __testing.executeReviewControllerOperation({ operation: "status" }, cwd, native, undefined, null, undefined, selections);
	assert.equal(published.status, "blocked");
	const binding = bindingOf(published);
	assert.equal(JSON.parse(binding).name, "intended_untracked_selection");

	const captured = await __testing.executeReviewCaptureOperation(
		{ collectBinding: binding, untrackedScope: "select", intendedUntracked: ["selected.txt"] },
		cwd,
		native,
		undefined,
		null,
		selections,
		true,
	);
	const { next_action: capturedNextAction, ...capturedRest } = captured;
	assert.deepEqual(capturedRest, {
		tool: "gentle_review_capture",
		status: "completed",
		outcome: "pre-start-untracked-selection-retained",
		workspace_root: cwd,
		target_identity: SHA,
		projection: "workspace",
		base_tree: TREE,
		current_candidate_tree: TREE,
		untracked_scope: "select",
		expected_untracked_inventory: INVENTORY,
		intended_untracked: ["selected.txt"],
		mutation_performed: false,
		mutation_outcome: "none",
	});
	assert.match(String(capturedNextAction), /START/);

	const started = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, undefined, null, undefined, selections);
	assert.equal(started.operation, "start");
	assert.equal((started.result as { lineage_id?: string }).lineage_id, "selected-lineage");
	assert.deepEqual(requests[2], { cwd, agent: "pi", untrackedScope: "select", expectedUntrackedInventory: INVENTORY, intendedUntracked: ["selected.txt"] });
	assert.equal(startRequests.length, 1);
	assert.deepEqual(
		{ untrackedScope: startRequests[0]!.untrackedScope, expectedUntrackedInventory: startRequests[0]!.expectedUntrackedInventory, intendedUntracked: startRequests[0]!.intendedUntracked },
		{ untrackedScope: "select", expectedUntrackedInventory: INVENTORY, intendedUntracked: ["selected.txt"] },
	);

	// The retained pre-START selection is one-shot: a second selectorless START
	// finds nothing retained and surfaces the provider collect state again.
	const replayed = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, undefined, null, undefined, selections);
	assert.equal(replayed.status, "blocked");
	assert.deepEqual(requests[3], { cwd, agent: "pi" });
	assert.equal(startRequests.length, 1);

	// The accepted START retained the consumed selection under its real lineage.
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId: "selected-lineage" }, cwd, native, undefined, null, undefined, selections);
	assert.deepEqual(requests[4], { cwd, lineageId: "selected-lineage", agent: "pi", untrackedScope: "select", expectedUntrackedInventory: INVENTORY, intendedUntracked: ["selected.txt"] });
});

test("pre-START exclude answer retains an exact empty selection for START", async () => {
	const cwd = process.cwd();
	const selections = new Map();
	const startRequests: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async (request: Record<string, unknown>) =>
			request.untrackedScope === undefined ? preStartStatus([preStartSelectionInput()]) : startableStatus(),
		start: async (request: Record<string, unknown>) => {
			startRequests.push(request);
			return { lineageId: "excluded-lineage", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [], raw: {} };
		},
	} as unknown as NativeReviewCli;

	const captured = await __testing.executeReviewCaptureOperation(
		{ collectBinding: JSON.stringify(preStartSelectionInput()), untrackedScope: "exclude" },
		cwd,
		native,
		undefined,
		null,
		selections,
		true,
	);
	assert.equal(captured.outcome, "pre-start-untracked-selection-retained");
	assert.deepEqual({ scope: captured.untracked_scope, intended: captured.intended_untracked }, { scope: "exclude", intended: [] });

	await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, undefined, null, undefined, selections);
	assert.deepEqual(
		{ untrackedScope: startRequests[0]!.untrackedScope, expectedUntrackedInventory: startRequests[0]!.expectedUntrackedInventory, intendedUntracked: startRequests[0]!.intendedUntracked },
		{ untrackedScope: "exclude", expectedUntrackedInventory: INVENTORY, intendedUntracked: [] },
	);
});

test("pre-START selection capture rejects stale, foreign, malformed, and out-of-inventory answers fail-closed", async () => {
	const cwd = process.cwd();
	const wrongSlot: ReviewCollectInputV3 = { ...preStartSelectionInput(), name: "reviewer_result", captureOperation: "review.capture-result" };
	const missingInventory: ReviewCollectInputV3 = { ...preStartSelectionInput(), arguments: [{ name: "eligible_paths_json", value: JSON.stringify(["selected.txt"]) }] };
	const malformedEligible: ReviewCollectInputV3 = { ...preStartSelectionInput(), arguments: [{ name: "expected_untracked_inventory", value: INVENTORY }, { name: "eligible_paths_json", value: "not json" }] };
	const cases: ReadonlyArray<[string, ReviewStatusV3, Record<string, unknown>, RegExp]> = [
		["out-of-inventory", preStartStatus([preStartSelectionInput()]), { collectBinding: JSON.stringify(preStartSelectionInput()), untrackedScope: "select", intendedUntracked: ["outside.txt"] }, /eligible inventory/],
		["stale", preStartStatus([preStartSelectionInput(`sha256:${"e".repeat(64)}`)]), { collectBinding: JSON.stringify(preStartSelectionInput()), untrackedScope: "exclude" }, /missing or stale/],
		["existing lineage", lineageBoundStatus("already-started"), { collectBinding: JSON.stringify(preStartSelectionInput()), untrackedScope: "exclude" }, /lineage already exists/],
		["ambiguous", preStartStatus([preStartSelectionInput()], "ambiguous"), { collectBinding: JSON.stringify(preStartSelectionInput()), untrackedScope: "exclude" }, /ambiguous/],
		["wrong slot", preStartStatus([wrongSlot]), { collectBinding: JSON.stringify(wrongSlot), untrackedScope: "exclude" }, /not the provider pre-START/],
		["missing inventory", preStartStatus([missingInventory]), { collectBinding: JSON.stringify(missingInventory), untrackedScope: "exclude" }, /omitted its exact/],
		["malformed eligible", preStartStatus([malformedEligible]), { collectBinding: JSON.stringify(malformedEligible), untrackedScope: "exclude" }, /malformed eligible-path inventory/],
	];
	for (const [label, status, parameters, reason] of cases) {
		const selections = new Map();
		let startCalls = 0;
		const native = {
			targetStatus: async () => status,
			start: async () => { startCalls += 1; throw new Error("unreachable"); },
		} as unknown as NativeReviewCli;
		const rejected = await __testing.executeReviewCaptureOperation(parameters, cwd, native, undefined, null, selections, true);
		assert.deepEqual(
			{ label, outcome: rejected.outcome, mutation: rejected.mutation_outcome, retained: selections.size, startCalls },
			{ label, outcome: "capture-binding-rejected", mutation: "none", retained: 0, startCalls: 0 },
		);
		assert.match(String(rejected.reason), reason, label);
	}
});

test("pre-START selection capture parameters are validated fail-closed before any native call", async () => {
	const binding = JSON.stringify(preStartSelectionInput());
	const cases: ReadonlyArray<[Record<string, unknown>, RegExp]> = [
		[{ collectBinding: binding, untrackedScope: "select", intendedUntracked: ["a.txt"], lineageId: "x" }, /does not accept lineageId/],
		[{ collectBinding: binding, untrackedScope: "select", intendedUntracked: ["a.txt"], reviewerRunAcknowledged: true }, /does not accept reviewerRunAcknowledged/],
		[{ collectBinding: binding, untrackedScope: "select", intendedUntracked: ["a.txt"], correctionLines: 1 }, /does not accept correctionLines/],
		[{ collectBinding: binding, untrackedScope: "select" }, /requires a non-empty intendedUntracked/],
		[{ collectBinding: binding, untrackedScope: "select", intendedUntracked: [] }, /requires a non-empty intendedUntracked/],
		[{ collectBinding: binding, untrackedScope: "exclude", intendedUntracked: ["a.txt"] }, /forbids intendedUntracked/],
		[{ collectBinding: binding, untrackedScope: "select", intendedUntracked: ["a.txt", "a.txt"] }, /unique repository-relative untracked paths/],
		[{ collectBinding: binding, untrackedScope: "select", intendedUntracked: ["../escape"] }, /unique repository-relative untracked paths/],
		[{ collectBinding: binding, untrackedScope: "select", intendedUntracked: ["/absolute.txt"] }, /unique repository-relative untracked paths/],
		[{ collectBinding: binding, untrackedScope: "all", intendedUntracked: ["a.txt"] }, /untrackedScope must be/],
		[{ collectBinding: binding, intendedUntracked: ["a.txt"] }, /untrackedScope must be/],
		[{ collectBinding: binding }, /requires an exact non-empty lineageId/],
	];
	for (const [parameters, expected] of cases) {
		await assert.rejects(() => __testing.executeReviewCaptureOperation(parameters, process.cwd(), null), expected);
	}
});

test("selectorless ordinary START names the wrapper route for the pre-START selection collect", async () => {
	const native = {
		targetStatus: async () => preStartStatus([preStartSelectionInput()]),
		start: async () => { throw new Error("unreachable"); },
	} as unknown as NativeReviewCli;
	const blocked = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, process.cwd(), native, undefined, null);
	assert.equal(blocked.status, "blocked");
	assert.equal((blocked.collectBindings as readonly unknown[]).length, 1);
	assert.match(String(blocked.next_action), /gentle_review_capture/);
	assert.match(String(blocked.next_action), /untrackedScope/);
});
