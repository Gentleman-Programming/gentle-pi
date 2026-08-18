import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";
import { NativeReviewIntegrationError, type NativeReviewCli } from "../lib/native-review-cli.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import type { ReviewCollectInputV3, ReviewStatusV3 } from "../lib/review-integration-v2.ts";
import type { ReviewHostRelayRequest } from "../lib/review-host-relay.ts";

// Third field failure on the recovered-lineage defect (2026-08-16, gentle-pi
// main 402f9f77 + gentle-ai 2.4.0-main.20278905): STATUS recognises the
// lineage, the Pi RELAY never runs, no lens is launched, zero mutations.
//
// Measured against the live binary on a faithful reproduction (linked
// worktree, uncommitted tracked files, externally recovered successor):
//
//   agent-less STATUS  -> collect input arguments:
//       lineage, expected-revision, target, repository-context, lens, order,
//       subject-hash                      (no agent, no materialize, no submission)
//   `--agent pi` STATUS -> the same input PLUS agent=pi, materialize=true and
//       the provider submission (operation_token=capture-result)
//
// The adapter's negotiated targetStatus never sent `--agent pi`, so the
// provider never offered the materialize-marked relay slot,
// reviewHostRelaySlots() returned 0 for every real lineage, and the host relay
// was unreachable. The prior fixes all exercised dispatch-shaped slots.
//
// Binaries older than v2.4.0 do not define `--agent` on `review status` and
// refuse it outright, so the agent is probed rather than version-sniffed and
// the typed refusal must reach the user instead of being swallowed.

const SHA = `sha256:${"1".repeat(64)}`;
const TRANSPORT_REFUSAL_CODE = "immutable_review_transport_unsupported";

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-relay-transport-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Relay", "-c", "user.email=relay@example.invalid", "commit", "-m", "base"], { cwd });
	return cwd;
}

function collectInput(lineageId: string, materialize: boolean): ReviewCollectInputV3 {
	const binding = [
		{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
		{ name: "expected-revision", value: SHA, token: `--expected-revision=${SHA}` },
		{ name: "target", value: SHA, token: `--target=${SHA}` },
		{ name: "repository-context", value: `rctx1_${"e".repeat(64)}`, token: `--repository-context=rctx1_${"e".repeat(64)}` },
		{ name: "lens", value: "review-reliability", token: "--lens=review-reliability" },
		{ name: "order", value: "0", token: "--order=0" },
		{ name: "subject-hash", value: SHA, token: `--subject-hash=${SHA}` },
	];
	return {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: materialize
			? [...binding, { name: "agent", value: "pi", token: "--agent=pi" }, { name: "materialize", value: "true", token: "--materialize=true" }]
			: binding,
		artifactSubject: {
			schema: "gentle-ai.review-artifact-subject/v2",
			subjectHash: SHA,
			lineageId,
			authorityRevision: SHA,
			targetIdentity: SHA,
			baseTree: "3".repeat(40),
			candidateTree: "4".repeat(40),
			changedPathManifestSha256: SHA,
			lens: "review-reliability",
			selectedOrder: 0,
		},
		...(materialize
			? {
				submission: {
					operationToken: "capture-result",
					argumentTokens: [...binding.map((argument) => argument.token), "--input={{value}}"],
					values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: binding.length }],
				},
			}
			: {}),
	} as unknown as ReviewCollectInputV3;
}

function recoveredStatus(lineageId: string, materialize: boolean): ReviewStatusV3 {
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "current_target",
		authority: { version: "compact-v2", lineageId, state: "reviewer_results_required", generation: 2, revision: SHA },
		receipt: { status: "expected_missing" },
		action: "finalize",
		replayability: "not_replayable",
		targetIdentity: SHA,
		projection: {
			schema: "gentle-ai.review-integration.projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: "3".repeat(40),
			initialReviewTree: "4".repeat(40),
			currentCandidateTree: "4".repeat(40),
			pathsDigest: SHA,
			paths: ["app.ts"],
			intendedUntracked: [],
			intendedUntrackedProof: SHA,
			initialSnapshotIdentity: SHA,
			currentSnapshotIdentity: SHA,
		},
		candidates: [],
		nextTransition: { kind: "collect", reasonCode: "reviewer_results_required", collect: { inputs: [collectInput(lineageId, materialize)] } },
		raw: { schema: "gentle-ai.review-integration.status/v5", action: "finalize", lineage_id: lineageId },
	} as unknown as ReviewStatusV3;
}

/**
 * Mirrors the MEASURED live provider: the materialize-marked relay slot is
 * offered only when the caller asks for the pi agent.
 */
function transportAwareNative(options: { refusalCode?: string } = {}): {
	native: NativeReviewCli;
	agents: Array<string | undefined>;
	finalizeCalls: () => number;
} {
	const agents: Array<string | undefined> = [];
	let finalizeCalls = 0;
	const native = {
		targetStatus: async (request: { lineageId?: string; agent?: string }) => {
			agents.push(request.agent);
			if (request.agent === "pi" && options.refusalCode !== undefined) {
				throw new NativeReviewIntegrationError({
					schema: "gentle-ai.review-integration.failure/v2",
					contract: "gentle-ai.review-integration/v2",
					operation: "review.status",
					phase: "pre_native",
					code: options.refusalCode,
					message: "supported immutable review runtimes: claude-code, opencode, codex",
					mutationOutcome: "none",
					authorityApplicability: "current_target",
					retrySafe: true,
					replayability: "not_replayable",
					nextAction: "stop",
					raw: {},
				} as never);
			}
			return recoveredStatus(request.lineageId ?? "relay-lineage", request.agent === "pi");
		},
		finalize: async () => {
			finalizeCalls += 1;
			throw new Error("native finalize must not run while reviewer results are outstanding");
		},
	} as unknown as NativeReviewCli;
	return { native, agents, finalizeCalls: () => finalizeCalls };
}

async function runFinalize(cwd: string, native: NativeReviewCli, lineageId: string, input: Record<string, unknown> = { reviewer_run_acknowledged: true }): Promise<Record<string, unknown>> {
	return await __testing.executeReviewControllerOperation(
		{ operation: "finalize", lineageId, input: JSON.stringify(input) },
		cwd, native, undefined, new CandidateViewRegistry(),
	) as Record<string, unknown>;
}

async function runStatus(cwd: string, native: NativeReviewCli, lineageId: string): Promise<Record<string, unknown>> {
	return await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		cwd, native, undefined, new CandidateViewRegistry(),
	) as Record<string, unknown>;
}

test("the negotiated status asks for the pi agent so the provider offers its materialize relay slot", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "relay-recovered-successor";
	const { native, agents } = transportAwareNative();
	const relayed: ReviewHostRelayRequest[] = [];
	__testing.setReviewHostRelayRunnerForTesting(async (request: ReviewHostRelayRequest) => {
		relayed.push(request);
		return { promptByteLength: 128, resultByteLength: 64, submission: '{"admission_decision":"completed"}' };
	});

	const result = await runFinalize(cwd, native, lineageId);

	assert.equal(agents.at(0), "pi", "the successful Pi route starts with pi-bound STATUS negotiation");
	assert.ok(agents.slice(0, -1).every((agent) => agent === "pi"), "every pre-capture STATUS remains pi-bound");
	assert.equal(agents.at(-1), undefined, "the successful Pi route keeps its post-capture ordinary STATUS re-query");
	assert.equal(relayed.length, 1, "the materialize-marked slot must reach the host relay");
	assert.ok(relayed[0]!.captureArgumentTokens.includes("--materialize=true"));
	assert.ok(relayed[0]!.submission !== undefined, "the provider submission drives the completing form");
	const hostRelay = result.host_relay as { transport: string; captured_slots: readonly unknown[] } | undefined;
	assert.ok(hostRelay !== undefined, "the envelope reports the relay capture");
	assert.equal(hostRelay.transport, "pi_host_relay");
	assert.equal(hostRelay.captured_slots.length, 1);
});

test("finalize forecasts the reviewer model run once and spends nothing until it is acknowledged", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "forecast-lineage";
	const { native } = transportAwareNative();
	let launches = 0;
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		launches += 1;
		return { promptByteLength: 128, resultByteLength: 64, submission: '{"admission_decision":"completed"}' };
	});

	// An unacknowledged finalize must forecast, never spend.
	const forecast = await runFinalize(cwd, native, lineageId, {});
	assert.equal(launches, 0, "no reviewer model run may start before the forecast is acknowledged");
	assert.equal(forecast.status, "blocked");
	assert.equal(forecast.outcome, "reviewer-model-run-forecast");
	assert.equal(forecast.mutation_performed, false);
	assert.equal(forecast.mutation_outcome, "none");
	const cost = forecast.cost_forecast as { transport: string; model_runs: number; lenses: readonly string[]; side_effects: readonly string[] };
	assert.equal(cost.transport, "pi_host_relay");
	assert.equal(cost.model_runs, 1, "one model run per outstanding lens, forecast once before launch");
	assert.deepEqual(cost.lenses, ["review-reliability"]);
	assert.ok(cost.side_effects.length > 0);
	assert.match(String(forecast.reason), /model run/i);
	assert.match(String(forecast.next_action), /reviewer_run_acknowledged/);

	// The acknowledged finalize runs exactly the forecast work.
	const acknowledged = await runFinalize(cwd, native, lineageId, { reviewer_run_acknowledged: true });
	assert.equal(launches, 1, "the acknowledged finalize runs the forecast model run");
	assert.equal((acknowledged.host_relay as { captured_slots: readonly unknown[] }).captured_slots.length, 1);
});

test("a provider that refuses the pi transport blocks immediately without an agent-less lifecycle fallback", async (t) => {
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	const cwd = repository(t);
	const lineageId = "legacy-transport-lineage";
	const { native, agents, finalizeCalls } = transportAwareNative({ refusalCode: TRANSPORT_REFUSAL_CODE });
	let relayCalls = 0;
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		relayCalls += 1;
		return { promptByteLength: 1, resultByteLength: 1, submission: "{}" };
	});

	const result = await runFinalize(cwd, native, lineageId);

	assert.deepEqual(agents, ["pi"], "the refusal path issues one pi-bound STATUS and never falls back to an agent-less STATUS");
	assert.equal(relayCalls, 0, "a refused transport must not launch a relay capture");
	assert.equal(finalizeCalls(), 0, "a refused transport must not mutate through native finalize");
	const transport = result.relay_transport as { supported: boolean; code: string; message: string } | undefined;
	assert.ok(transport !== undefined, "the blocked envelope must report the typed transport refusal");
	assert.equal(transport.supported, false);
	assert.equal(transport.code, TRANSPORT_REFUSAL_CODE);
	assert.match(transport.message, /immutable review runtimes/i);
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "pi-host-relay-transport-unavailable");
	assert.equal(result.mutation_performed, false);
	assert.equal(result.mutation_outcome, "none");
	assert.match(String(result.next_action), /support.*--agent pi/i);
	assert.doesNotMatch(JSON.stringify(result), /no current controller-owned candidate view/);
	assert.doesNotMatch(JSON.stringify(result), /"status":"(?:approved|allowed)"/);
});

test("a remembered pi transport refusal remains blocked without re-probing or lifecycle continuation", async (t) => {
	const cwd = repository(t);
	const { native, agents, finalizeCalls } = transportAwareNative({ refusalCode: TRANSPORT_REFUSAL_CODE });
	const first = await runFinalize(cwd, native, "probe-lineage");
	const second = await runFinalize(cwd, native, "probe-lineage");
	assert.equal(first.outcome, "pi-host-relay-transport-unavailable");
	assert.equal(second.outcome, "pi-host-relay-transport-unavailable");
	assert.deepEqual(agents, ["pi"], "a cached refusal must not re-probe or issue an agent-less STATUS");
	assert.equal(finalizeCalls(), 0, "a cached refusal must not continue native lifecycle work");
	__testing.clearReviewTransportProbeForTesting(native);
});

test("every typed Pi transport refusal code fails closed", async (t) => {
	const refusalCodes = [
		"immutable_review_transport_unsupported",
		"unsupported_agent",
		"unknown_flag",
	];
	for (const refusalCode of refusalCodes) {
		const cwd = repository(t);
		const { native, agents, finalizeCalls } = transportAwareNative({ refusalCode });
		const result = await runFinalize(cwd, native, `refusal-${refusalCode}`);
		assert.equal(result.status, "blocked", `${refusalCode} must be blocked`);
		assert.equal(result.outcome, "pi-host-relay-transport-unavailable", `${refusalCode} must use the unavailable envelope`);
		assert.equal((result.relay_transport as { code: string }).code, refusalCode);
		assert.deepEqual(agents, ["pi"], `${refusalCode} must not fall back to agent-less STATUS`);
		assert.equal(finalizeCalls(), 0, `${refusalCode} must not continue native lifecycle work`);
		__testing.clearReviewTransportProbeForTesting(native);
	}
});

test("typed status errors outside the Pi transport refusal set remain native errors", async (t) => {
	const cwd = repository(t);
	const { native, agents, finalizeCalls } = transportAwareNative({ refusalCode: "provider_unavailable" });
	const result = await runFinalize(cwd, native, "non-transport-status-error");
	assert.deepEqual(agents, ["pi"], "a non-transport error must not be retried as an agent-less lifecycle STATUS");
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, undefined, "a non-transport error must not be coerced into a transport refusal envelope");
	assert.ok("native_failure" in result, "the native error envelope must remain available to the caller");
	assert.equal(result.relay_transport, undefined);
	assert.equal(finalizeCalls(), 0);
});

test("ordinary non-lifecycle STATUS inspection remains agent-less", async (t) => {
	const cwd = repository(t);
	const { native, agents } = transportAwareNative();
	const result = await runStatus(cwd, native, "ordinary-status-lineage");
	assert.deepEqual(agents, [undefined], "ordinary STATUS must retain its public agent-less route");
	assert.equal(result.operation, "status");
});

test("a fresh controller provider instance probes the Pi transport again", async (t) => {
	const cwd = repository(t);
	const first = transportAwareNative({ refusePiAgent: true });
	await runFinalize(cwd, first.native, "fresh-probe-lineage");
	assert.equal(first.agents.filter((agent) => agent === "pi").length, 1);

	const fresh = transportAwareNative({ refusePiAgent: true });
	await runFinalize(cwd, fresh.native, "fresh-probe-lineage");
	assert.equal(fresh.agents.filter((agent) => agent === "pi").length, 1,
		"transport refusal caching must not leak across fresh controller provider instances");
});
