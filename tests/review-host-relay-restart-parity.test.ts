import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// gentle-pi#311 P6 — restart parity for the provider-relay capture lane.
//
// P1-P5 proved same-process STATUS re-query after a relay transport failure
// (tests/review-host-relay-routing.test.ts): the controller re-queries STATUS
// in-process and directs the operator to relaunch only if the exact same
// bound slot is reoffered. P6 closes the remaining gap: the binding must
// survive a TRUE controller-process restart, and the retry discipline must
// be provable, not merely asserted.
//
// The repository's existing process/harness boundary is the spawnSync child
// process used by tests/orchestrator-budget.test.ts (a fresh
// `process.execPath --experimental-strip-types <script>` invocation with a
// fresh module load). Each scenario here runs the controller in its own
// child process (tests/fixtures/review-host-relay-restart-worker.mjs), so
// module-level state and every closure restarts from scratch.
//
// The truthful restart protocol uses the production read-only INSPECT
// operation as the decision gate:
//   1. Process A: FINALIZE observes the exact pending relay binding, then
//      the relay transport fails without capture or source/authority
//      mutation.
//   2. Process B (fresh): INSPECT queries fresh provider STATUS and exposes
//      the full raw pending collect input; it invokes neither the relay nor
//      native finalize.
//   3. The parent compares Process B's provider-returned binding to Process
//      A's observed binding (deep equal on the immutable binding/submission
//      fields, not raw byte identity).
//   4. Only when equal, fresh Process C: FINALIZE relaunches from the newly
//      reoffered slot.
//   5. Drifted reoffer: INSPECT returns a non-equal binding; the parent
//      asserts zero relay/finalize and does NOT spawn a finalize/relaunch
//      process.
//   6. Missing reoffer: INSPECT exposes no matching slot; the parent asserts
//      zero relay/finalize and does NOT relaunch.
//
// The provider (native targetStatus) is stubbed from a JSON file the parent
// controls; the provider's own durability is proven elsewhere
// (native-review-parity-runtime.test.ts drives the real binary). What is
// under test is the CONTROLLER's restart safety.

const SHA = `sha256:${"1".repeat(64)}`;
const TREE = "2".repeat(40);
const LINEAGE = "relay-lineage";
const LENS = "review-reliability";
const ORDER = 0;

function bindingArguments(lineageId, lens, order) {
	return [
		{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
		{ name: "expected-revision", value: SHA, token: `--expected-revision=${SHA}` },
		{ name: "target", value: SHA, token: `--target=${SHA}` },
		{ name: "repository-context", value: `rctx1_${"e".repeat(64)}`, token: `--repository-context=rctx1_${"e".repeat(64)}` },
		{ name: "lens", value: lens, token: `--lens=${lens}` },
		{ name: "order", value: String(order), token: `--order=${order}` },
		{ name: "subject-hash", value: `sha256:${String(order).repeat(64)}`, token: `--subject-hash=sha256:${String(order).repeat(64)}` },
	];
}

function providerSubmission(lineageId, lens, order) {
	const bindingTokens = bindingArguments(lineageId, lens, order).map((a) => a.token);
	return {
		operationToken: "capture-result",
		argumentTokens: [...bindingTokens, "--input={{value}}"],
		values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: bindingTokens.length }],
	};
}

function relayCollectInput(lineageId, lens, order) {
	return {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: [
			...bindingArguments(lineageId, lens, order),
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "materialize", value: "true", token: "--materialize=true" },
		],
		submission: providerSubmission(lineageId, lens, order),
	};
}

// A provider-shaped raw next_transition so INSPECT's public result exposes
// the exact pending slot the operator compares against.
function rawNextTransition(inputs) {
	return inputs.length === 0 ? undefined : {
		kind: "collect",
		reason_code: "reviewer_results_required",
		collect: { inputs: inputs.map((input) => ({
			name: input.name,
			schema: input.schema,
			capture_operation: input.captureOperation,
			arguments: input.arguments,
			submission: input.submission,
		})) },
	};
}

function finalizeStatus(lineageId, inputs) {
	const transition = rawNextTransition(inputs);
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "current_target",
		authority: { version: "compact-v2", lineageId, state: "reviewing", generation: 1, revision: SHA },
		receipt: { status: "none" },
		action: "finalize",
		replayability: "unknown",
		targetIdentity: SHA,
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1", kind: "current-changes", projection: "workspace",
			baseTree: TREE, initialReviewTree: TREE, currentCandidateTree: TREE,
			pathsDigest: SHA, paths: ["app.ts"], intendedUntracked: [], intendedUntrackedProof: SHA,
			initialSnapshotIdentity: SHA, currentSnapshotIdentity: SHA,
		},
		candidates: [],
		...(transition === undefined ? {} : { nextTransition: { kind: "collect", reasonCode: "reviewer_results_required", collect: { inputs: [...inputs] } } }),
		raw: {
			schema: "gentle-ai.review-integration.status/v3", contract: "gentle-ai.review-integration/v2",
			action: "finalize", lineage_id: lineageId, target_identity: SHA,
			...(transition === undefined ? {} : { next_transition: transition }),
		},
	};
}

function repository(t) {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-relay-restart-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Relay Restart Test", "-c", "user.email=relay-restart@example.invalid", "commit", "-m", "initial"], { cwd });
	return cwd;
}

// Escape regex metacharacters in a literal path so it can be anchored safely
// inside a RegExp that asserts the candidate-views root lives under cwd.
function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runWorker(t, cwd, statuses, mode) {
	const scratch = mkdtempSync(join(tmpdir(), "gentle-pi-relay-restart-run-"));
	t.after(() => rmSync(scratch, { recursive: true, force: true }));
	const statusFile = join(scratch, "statuses.json");
	const outFile = join(scratch, "out.json");
	writeFileSync(statusFile, JSON.stringify(statuses));
	const script = join(import.meta.dirname, "fixtures", "review-host-relay-restart-worker.mjs");
	const out = execFileSync(process.execPath, ["--experimental-strip-types", script, cwd, statusFile, mode, outFile], {
		encoding: "utf8", env: process.env, timeout: 15_000,
	});
	assert.equal(out.length, 0, `worker should write nothing to stdout, got: ${out}`);
	return JSON.parse(readFileSync(outFile, "utf8"));
}

// Extract the provider-returned pending relay slot from an INSPECT result's
// raw next_transition, for comparison against the binding a relay launch
// observed. Returns undefined when the provider offers no matching slot.
function inspectRelaySlot(inspectResult) {
	const raw = inspectResult?.result;
	const inputs = raw?.next_transition?.collect?.inputs;
	if (!Array.isArray(inputs)) return undefined;
	const slot = inputs.find((input) => input.capture_operation === "review.capture-result"
		&& (input.arguments ?? []).some((a) => a.name === "agent" && a.value === "pi")
		&& (input.arguments ?? []).some((a) => a.name === "materialize" && a.value === "true"));
	if (slot === undefined) return undefined;
	return {
		captureArgumentTokens: slot.arguments.map((a) => a.token),
		submission: slot.submission,
	};
}

const PENDING = finalizeStatus(LINEAGE, [relayCollectInput(LINEAGE, LENS, ORDER)]);
const CONVERGED = finalizeStatus(LINEAGE, []);

test("INSPECT after a transport failure reoffers the exact pending binding; FINALIZE relaunches only after the parent confirms equality", async (t) => {
	const cwd = repository(t);

	// Process A: FINALIZE observes the exact pending relay binding, transport
	// fails without capture or source/authority mutation.
	const failure = runWorker(t, cwd, [PENDING], "finalize-fail");
	assert.equal(failure.error, undefined, `failure run threw: ${JSON.stringify(failure.error)}`);
	assert.equal(failure.relayRequests.length, 1, "Process A observed exactly one pending slot");
	assert.equal(failure.statusCalls.length, 1, "no automatic STATUS re-query after transport failure");
	assert.equal(failure.statusCalls[0].lineageId, LINEAGE, "Process A STATUS carried the relay lineage selector");
	assert.match(failure.statusCalls[0].cwd, new RegExp(`^${escapeRegex(cwd)}/\\.git/gentle-ai/candidate-views/`), "Process A STATUS targeted the candidate-views root under cwd");
	assert.equal(failure.finalizeCalls, 0, "transport failure never invokes native finalize");
	const failedResult = failure.result;
	assert.equal(failedResult.status, "blocked");
	assert.equal(failedResult.outcome, "pi-host-relay-transport-failure");
	assert.deepEqual(failedResult.failure, { kind: "pi-failed", stage: "pi", exit_code: 4, timed_out: false });
	assert.equal((failedResult.captured_slots ?? []).length, 0, "transport failure captures nothing");
	assert.equal(failedResult.mutation_performed, false);
	assert.match(String(failedResult.next_action), /Re-query negotiated STATUS/);
	assert.match(String(failedResult.next_action), /exact same bound slot/);
	const observedBinding = failure.relayRequests[0];

	// Process B (fresh process): the read-only INSPECT queries fresh provider
	// STATUS and exposes the full raw pending collect input. It invokes
	// neither the relay nor native finalize.
	const inspect = runWorker(t, cwd, [PENDING], "inspect");
	assert.equal(inspect.error, undefined, `inspect run threw: ${JSON.stringify(inspect.error)}`);
	assert.equal(inspect.relayRequests.length, 0, "INSPECT never launches the relay");
	assert.equal(inspect.finalizeCalls, 0, "INSPECT never invokes native finalize");
	assert.equal(inspect.statusCalls.length, 1, "INSPECT queries STATUS exactly once");
	assert.equal(inspect.result.operation, "inspect");
	const inspectSlot = inspectRelaySlot(inspect.result);
	assert.ok(inspectSlot !== undefined, "INSPECT exposed the provider-returned pending relay slot");

	// The parent compares the provider-returned binding to the binding the
	// relay observed in Process A. Deep equal on the immutable
	// binding/submission fields, not raw byte identity.
	assert.deepEqual(inspectSlot, observedBinding, "the fresh reoffer is deep-equal to the observed binding");

	// Process C (fresh process): only because the parent confirmed equality,
	// FINALIZE relaunches from the newly reoffered slot. The provider offers
	// the pending slot again, then a converged STATUS after the capture.
	const relaunch = runWorker(t, cwd, [PENDING, CONVERGED], "finalize-succeed");
	assert.equal(relaunch.error, undefined, `relaunch threw: ${JSON.stringify(relaunch.error)}`);
	assert.equal(relaunch.relayRequests.length, 1, "Process C launched the relay exactly once from the fresh reoffer");
	assert.equal(relaunch.statusCalls.length, 2, "Process C re-queried STATUS after the capture");
	assert.equal(relaunch.statusCalls[0].lineageId, LINEAGE, "Process C first STATUS carried the relay lineage selector");
	assert.match(relaunch.statusCalls[0].cwd, new RegExp(`^${escapeRegex(cwd)}/\\.git/gentle-ai/candidate-views/`), "Process C first STATUS targeted the candidate-views root under cwd");
	assert.deepEqual(relaunch.statusCalls[1], { cwd, lineageId: LINEAGE });
	// The relaunch came from the fresh reoffered binding, byte-for-byte /
	// deep-equal to the binding the failed process observed.
	assert.deepEqual(relaunch.relayRequests[0], observedBinding);
	assert.deepEqual(relaunch.relayRequests[0].submission, providerSubmission(LINEAGE, LENS, ORDER));
	assert.equal(relaunch.result.status, "in-progress");
	assert.equal((relaunch.result.host_relay?.captured_slots ?? []).length, 1);
	assert.equal(relaunch.result.host_relay.transport, "pi_host_relay");
});

test("every provider-owned binding drift forbids relaunch and no relay/finalize fires", async (t) => {
	const cwd = repository(t);

	// Process A: observe the original binding, transport fails.
	const failure = runWorker(t, cwd, [PENDING], "finalize-fail");
	assert.equal(failure.relayRequests.length, 1);
	assert.equal(failure.result.outcome, "pi-host-relay-transport-failure");
	const observedBinding = failure.relayRequests[0];
	const baseInput = relayCollectInput(LINEAGE, LENS, ORDER);
	const driftArgument = (name, value, token) => {
		const input = structuredClone(baseInput);
		const argument = input.arguments.find((candidate) => candidate.name === name);
		assert.ok(argument !== undefined);
		const originalToken = argument.token;
		Object.assign(argument, { value, token });
		input.submission.argumentTokens = input.submission.argumentTokens.map((candidate) => candidate === originalToken ? token : candidate);
		return input;
	};
	const driftedSubmission = structuredClone(baseInput);
	driftedSubmission.submission.values[0]!.slot = "drifted_reviewer_result";
	const driftSha = `sha256:${"f".repeat(64)}`;
	const driftCases = [
		{ field: "submission", input: driftedSubmission },
		{ field: "captureArgumentTokens", input: driftArgument("expected-revision", driftSha, `--expected-revision=${driftSha}`) },
		{ field: "order", input: driftArgument("order", String(ORDER + 1), `--order=${ORDER + 1}`) },
		{ field: "subjectHash", input: driftArgument("subject-hash", driftSha, `--subject-hash=${driftSha}`) },
		{ field: "lens", input: driftArgument("lens", "review-risk", "--lens=review-risk") },
	];

	for (const { field, input } of driftCases) {
		// Process B (fresh): INSPECT reoffers one independently drifted binding.
		const inspect = runWorker(t, cwd, [finalizeStatus(LINEAGE, [input])], "inspect");
		assert.equal(inspect.relayRequests.length, 0, `${field}: INSPECT never launches the relay`);
		assert.equal(inspect.finalizeCalls, 0, `${field}: INSPECT never invokes native finalize`);
		const inspectSlot = inspectRelaySlot(inspect.result);
		assert.ok(inspectSlot !== undefined, `${field}: INSPECT exposes the drifted slot for comparison`);
		assert.notDeepEqual(inspectSlot, observedBinding, `${field}: the drifted reoffer must not equal the observed binding`);
	}
});

test("a missing INSPECT reoffer exposes no matching slot; the parent does NOT relaunch and no relay/finalize fires", async (t) => {
	const cwd = repository(t);

	// Process A: observe the original binding, transport fails.
	const failure = runWorker(t, cwd, [PENDING], "finalize-fail");
	assert.equal(failure.relayRequests.length, 1);
	assert.equal(failure.result.outcome, "pi-host-relay-transport-failure");

	// Process B (fresh): INSPECT returns a converged STATUS with no matching
	// relay slot. The parent confirms no slot is exposed, so the retry
	// discipline FORBIDS relaunch. No finalize/relaunch process is spawned.
	const inspect = runWorker(t, cwd, [CONVERGED], "inspect");
	assert.equal(inspect.relayRequests.length, 0, "INSPECT never launches the relay");
	assert.equal(inspect.finalizeCalls, 0, "INSPECT never invokes native finalize");
	assert.equal(inspectRelaySlot(inspect.result), undefined, "INSPECT exposed no matching relay slot");
});
