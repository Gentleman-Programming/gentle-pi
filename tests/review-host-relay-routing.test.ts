import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";
import type { NativeReviewCli } from "../lib/native-review-cli.ts";
import { REVIEW_HOST_RELAY_FAILURE, REVIEW_HOST_RELAY_PI_TIMEOUT_ENV, REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS, REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE, REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE, ReviewHostRelayError, type ReviewHostRelayRequest } from "../lib/review-host-relay.ts";
import type { ReviewCaptureSubmissionV1, ReviewCollectInputV3, ReviewStatusV3 } from "../lib/review-integration-v2.ts";

// One-slot capture routing: the host relay runs only when the selected
// provider-returned collect input carries the --materialize token. Every
// other capture form stays untouched.

const SHA = `sha256:${"1".repeat(64)}`;
const TREE = "2".repeat(40);

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-relay-routing-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Relay Test", "-c", "user.email=relay@example.invalid", "commit", "-m", "initial"], { cwd });
	return cwd;
}

function bindingArguments(lineageId: string, lens: string, order: number): ReviewCollectInputV3["arguments"] {
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

function providerSubmission(lineageId: string, lens: string, order: number): ReviewCaptureSubmissionV1 {
	const bindingTokens = bindingArguments(lineageId, lens, order).map((argument) => argument.token!);
	return {
		operationToken: "capture-result",
		argumentTokens: [...bindingTokens, "--input={{value}}"],
		values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: bindingTokens.length }],
	};
}

function relayCollectInput(lineageId: string, lens: string, order: number, materialize = true, submission: ReviewCaptureSubmissionV1 | "provider" | "absent" = "provider"): ReviewCollectInputV3 {
	return {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: [
			...bindingArguments(lineageId, lens, order),
			...(materialize ? [
				{ name: "agent", value: "pi", token: "--agent=pi" },
				{ name: "materialize", value: "true", token: "--materialize=true" },
			] : []),
		],
		...(materialize && submission !== "absent" ? { submission: submission === "provider" ? providerSubmission(lineageId, lens, order) : submission } : {}),
	};
}

function finalizeStatus(lineageId: string, inputs?: readonly ReviewCollectInputV3[]): ReviewStatusV3 {
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "current_target",
		authority: { version: "compact-v2", lineageId, state: "reviewing", generation: 1, revision: SHA },
		action: "stop",
		replayability: "unknown",
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
		...(inputs === undefined ? {} : { nextTransition: { kind: "collect", reasonCode: "reviewer_results_required", collect: { inputs: [...inputs] } } }),
		raw: { schema: "gentle-ai.review-integration.status/v3", action: "stop", lineage_id: lineageId },
	} as unknown as ReviewStatusV3;
}

interface RoutingHarness {
	statusQueue: ReviewStatusV3[];
	statusCalls: Array<{ cwd: string; lineageId?: string }>;
	native: NativeReviewCli;
}

function nativeHarness(statuses: readonly ReviewStatusV3[]): RoutingHarness {
	const harness: RoutingHarness = {
		statusQueue: [...statuses],
		statusCalls: [],
		native: undefined as unknown as NativeReviewCli,
	};
	harness.native = {
		targetStatus: async (request) => {
			harness.statusCalls.push({ cwd: request.cwd, ...(request.lineageId === undefined ? {} : { lineageId: request.lineageId }) });
			const next = harness.statusQueue.shift();
			if (next === undefined) throw new Error("status queue exhausted");
			return next;
		},
	};
	return harness;
}

async function runCapture(cwd: string, harness: RoutingHarness, lineageId: string, input: Record<string, unknown> = { reviewerRunAcknowledged: true }): Promise<Record<string, unknown>> {
	const selected = harness.statusQueue[0]?.nextTransition?.collect?.inputs[0];
	if (selected === undefined) throw new Error("capture test requires one current collect input");
	return await __testing.executeReviewCaptureOperation(
		{ lineageId, collectBinding: JSON.stringify(selected), ...input },
		cwd,
		harness.native,
	) as Record<string, unknown>;
}

test("one materialize binding routes exactly one provider slot through the host relay", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const input = relayCollectInput(lineageId, "review-risk", 0);
	const harness = nativeHarness([finalizeStatus(lineageId, [input])]);
	const relayed: ReviewHostRelayRequest[] = [];
	__testing.setReviewHostRelayRunnerForTesting(async (request: ReviewHostRelayRequest) => {
		relayed.push(request);
		return { promptByteLength: 64, resultByteLength: 32, submission: '{"admission_decision":"completed"}' };
	});

	const result = await runCapture(cwd, harness, lineageId);

	assert.equal(relayed.length, 1);
	assert.deepEqual(relayed[0]!.captureArgumentTokens, input.arguments.map((argument) => argument.token));
	assert.deepEqual(relayed[0]!.submission, providerSubmission(lineageId, "review-risk", 0));
	assert.equal(harness.statusCalls.length, 1, "a nonterminal capture does not auto-follow STATUS");
	assert.equal(result.status, "captured");
	assert.equal((result.host_relay as { transport: string }).transport, "pi_host_relay");
});

test("Pi-authored review documents are rejected at the capture input boundary", async (t) => {
	// The narrow capture schema rejects a caller-authored reviewer document
	// before any relay launch or native call.
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const harness = nativeHarness([finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-reliability", 0)])]);
	let relayCalls = 0;
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		relayCalls += 1;
		return { promptByteLength: 1, resultByteLength: 1, submission: "{}" };
	});

	await assert.rejects(
		() => runCapture(cwd, harness, lineageId, { review_result: { lens_results: [{ findings: [], evidence: ["reviewed"] }] } }),
		/does not accept review_result/,
	);
	assert.equal(relayCalls, 0);
});

test("an old binary reports the relay as unavailable without touching existing behavior", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const harness = nativeHarness([finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-reliability", 0)])]);
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE, "materialize", REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE, { exitCode: 2, stderr: "flag provided but not defined: -materialize" });
	});

	const result = await runCapture(cwd, harness, lineageId);

	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "pi-host-relay-unavailable");
	assert.equal(result.reason, REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE);
	assert.equal(result.mutation_performed, false);
	assert.equal(result.mutation_outcome, "none");
});

test("a handshake refusal surfaces the provider refusal verbatim through the controller envelope", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const refusal = "the active runtime is not eligible for immutable receipt review; supported immutable review runtimes: claude-code, codex, opencode";
	const harness = nativeHarness([finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-reliability", 0)])]);
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.HANDSHAKE_REFUSED, "materialize", refusal, { exitCode: 1, stderr: refusal });
	});

	const result = await runCapture(cwd, harness, lineageId);

	assert.equal(result.outcome, "pi-host-relay-handshake-refused");
	assert.equal(result.reason, refusal);
	assert.equal(result.refusal, refusal);
});

test("a transport failure stops the selected capture without auto-follow", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const harness = nativeHarness([finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-risk", 0)])]);
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi", "pi subprocess failed", { exitCode: 4 });
	});

	const result = await runCapture(cwd, harness, lineageId);

	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "pi-host-relay-transport-failure");
	assert.deepEqual(result.failure, { kind: "pi-failed", stage: "pi", exit_code: 4, timed_out: false });
	assert.match(String(result.next_action), /fresh STATUS/);
	assert.equal(harness.statusCalls.length, 1, "no automatic relaunch after transport failure");
});

// gentle-pi#522 / #524: a submission Go refused at admission is a proven
// non-mutation. The model must see the refusal text, mutation_outcome none,
// and a continuation for the reoffered slot, never an unknown outcome that the
// contract forbids replaying.
test("an admission refusal reaches the model as a proven non-mutation carrying the refusal and a continuation", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const harness = nativeHarness([finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-risk", 0)])]);
	const refusal = "Error: reviewer artifact admission binding_mismatch: reviewer result echoed a different artifact subject: the rejected admission did not consume the lens slot, so re-run the lens and invoke gentle-ai review capture-result again on the same lineage with a result that echoes the binding's top-level subject_hash [invalid_request]\n";
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit", refusal.trim(), { exitCode: 1, stderr: refusal, elapsedMs: 40, timeoutMs: 120_000, mutationOutcome: "none" });
	});

	const result = await runCapture(cwd, harness, lineageId);

	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "pi-host-relay-transport-failure");
	assert.deepEqual(result.failure, { kind: "submission-refused", stage: "submit", exit_code: 1, timed_out: false, elapsed_ms: 40, timeout_ms: 120_000, stderr: refusal });
	assert.equal(result.reason, refusal.trim());
	assert.equal(result.mutation_performed, false);
	assert.equal(result.mutation_outcome, "none");
	assert.match(String(result.next_action), /did not consume the lens slot/);
	assert.match(String(result.next_action), /fresh STATUS/);
	assert.equal(harness.statusCalls.length, 1, "a proven non-mutation needs no STATUS reconciliation and no relaunch");
});

test("a submission whose outcome is genuinely indeterminate still reconciles through STATUS and carries its evidence", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const pending = finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-risk", 0)]);
	const harness = nativeHarness([pending, pending]);
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit", "gentle-ai capture submission exceeded its 120000ms bound after 120004ms", { exitCode: null, stderr: "", timedOut: true, elapsedMs: 120_004, timeoutMs: 120_000 });
	});

	const result = await runCapture(cwd, harness, lineageId);

	assert.equal(result.status, "reconciled");
	assert.equal(result.outcome, "native-capture-outcome-unknown");
	assert.deepEqual(result.failure, { kind: "submission-refused", stage: "submit", exit_code: null, timed_out: true, elapsed_ms: 120_004, timeout_ms: 120_000 });
	assert.match(String(result.reason), /exceeded its 120000ms bound/);
	assert.equal(harness.statusCalls.length, 2, "an indeterminate submission reconciles exactly once through STATUS");
});

test("a relay timeout reports its one-slot measurements and no auto-follow", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const harness = nativeHarness([finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-risk", 0)])]);
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		throw new ReviewHostRelayError(
			REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT,
			"pi",
			"pi reviewer subprocess exceeded the relay bound",
			{ exitCode: null, timedOut: true, elapsedMs: 2_256_004, timeoutMs: 2_256_000 },
		);
	});

	const result = await runCapture(cwd, harness, lineageId);
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "pi-host-relay-timeout");
	assert.deepEqual(result.failure, { kind: "pi-timed-out", stage: "pi", exit_code: null, timed_out: true, elapsed_ms: 2_256_004, timeout_ms: 2_256_000 });
	assert.match(String(result.next_action), new RegExp(`${REVIEW_HOST_RELAY_PI_TIMEOUT_ENV}=<milliseconds>`));
	assert.match(String(result.next_action), new RegExp(String(REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS)));
	assert.equal(harness.statusCalls.length, 1);
});

test("a non-timeout transport failure keeps its generic continuation and now carries its measurements", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const harness = nativeHarness([finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-reliability", 0)])]);
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi", "pi subprocess failed", { exitCode: 4, elapsedMs: 1_200, timeoutMs: 900_000 });
	});

	const result = await runCapture(cwd, harness, lineageId);

	assert.equal(result.outcome, "pi-host-relay-transport-failure");
	assert.deepEqual(result.failure, { kind: "pi-failed", stage: "pi", exit_code: 4, timed_out: false, elapsed_ms: 1_200, timeout_ms: 900_000 });
	assert.match(String(result.next_action), /fresh STATUS/);
});

test("materialize tokens without a provider submission fail closed as a typed contract mismatch", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const harness = nativeHarness([finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-reliability", 0, true, "absent")])]);
	let relayCalls = 0;
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		relayCalls += 1;
		return { promptByteLength: 1, resultByteLength: 1, submission: "{}" };
	});

	const result = await runCapture(cwd, harness, lineageId);

	assert.equal(relayCalls, 0, "the completing form is never synthesized, so nothing launches");
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "pi-host-relay-transport-failure");
	assert.deepEqual(result.failure, { kind: "submission-contract-mismatch", stage: "binding", exit_code: null, timed_out: false });
	assert.equal(result.reason, REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE);
	assert.equal(result.mutation_performed, false);
	assert.equal(result.mutation_outcome, "none");
	assert.equal(harness.statusCalls.length, 1, "no relaunch and no post-capture STATUS after the contract mismatch");
});

test("collect inputs without the provider-issued materialize token never reach the relay", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-lineage";
	const harness = nativeHarness([
		finalizeStatus(lineageId, [relayCollectInput(lineageId, "review-reliability", 0, false)]),
		finalizeStatus(lineageId),
	]);
	let relayCalls = 0;
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		relayCalls += 1;
		return { promptByteLength: 1, resultByteLength: 1, submission: "{}" };
	});

	// The existing lane may fail on the synthetic projection; only the relay
	// boundary is under test here: it must never be consulted.
	try {
		await runCapture(cwd, harness, lineageId);
	} catch {
		// Existing-lane behavior for this synthetic fixture is out of scope.
	}
	assert.equal(relayCalls, 0);
});
