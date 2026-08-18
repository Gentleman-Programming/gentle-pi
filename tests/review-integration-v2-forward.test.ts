import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	decodeReviewCapabilitiesV2,
	decodeReviewConsentV2,
	decodeReviewConsentV3,
	decodeReviewFailureV2,
	decodeReviewOperationV2,
	decodeReviewResultArtifactV2,
	decodeReviewStartV3,
	decodeReviewStatusV3,
} from "../lib/review-integration-v2.ts";

// Forward decoders for the gentle-ai main line (dev-binary field-test lane).
//
// Fixture provenance:
// - capabilities-v2.2.captured.json and status-v5.captured.json were captured
//   2026-08-15 from the real binary at /home/gentleman/.cargo/bin/gentle-ai
//   reporting "gentle-ai 2.4.0-rc.8+fix.verify-attestation-recovery" (built
//   from the gentle-ai main line), in a scratch git repository:
//     gentle-ai review capabilities --contract gentle-ai.review-integration/v2
//     GENTLE_PI_REVIEW_RELAY_CONTRACT=gentle-pi.review-relay/v1 \
//       gentle-ai review status --contract gentle-ai.review-integration/v2 \
//       --cwd <scratch> --projection workspace --next-transition
// - capabilities-v2.1.derived.json is derived from the captured v2.2 payload
//   plus gentle-ai origin/main contracts/review-integration/v2/schemas/
//   capabilities-v2.1.schema.json (schema const v2.1, protocol minor 1,
//   consent/v3 + status/v3 schema advertisements, 17 optional features): no
//   installed binary emits v2.1 to capture from.
// - The v5-only next_transition samples (correction_request, provider_task,
//   submission descriptor forms) are constructed from gentle-ai origin/main
//   contracts/review-integration/v2/schemas/status-v5.schema.json and
//   contracts/review-integration/v1/schemas/correction-plan-request.schema.json.
// - consent-v3.captured.json, start-v3-consent-granted.captured.json, and
//   start-v3-consent-declined.captured.json were captured 2026-08-16 from the
//   real binary at /home/gentleman/.cargo/bin/gentle-ai reporting
//   "gentle-ai 2.4.0-main.b1afef46", in a scratch git repository holding a
//   committed internal/runner/{runner.go,runner_test.go} baseline plus 12
//   uncommitted changed lines that add a process-starting helper (risk signal
//   shell_process, high tier):
//     gentle-ai review status --contract gentle-ai.review-integration/v2 \
//       --cwd <scratch> --projection workspace --next-transition   # target source
//     gentle-ai review start --contract gentle-ai.review-integration/v2 \
//       --cwd <scratch> --target <identity> --projection workspace \
//       --consent relay                                            # consent-v3
//   then the envelope's exact declined invocation (declined capture, which
//   persists nothing) followed by its exact granted invocation (granted
//   start/v3 capture). Note: the live granted/declined invocations carry no
//   --agent token even though the envelope pins agent: claude-code — the
//   published consent-v3.schema.json invocation pattern is narrower than the
//   emitter, so the capture is authoritative (parity playbook, known traps).
// - status-v5-repository-context.captured.json was captured 2026-08-16 from
//   the real binary at /home/gentleman/.cargo/bin/gentle-ai reporting
//   "gentle-ai 2.4.0-main.b1afef46", in a scratch git repository with one
//   medium-tier lineage in state `reviewing` whose single reviewer result was
//   already admitted (consent granted start, then review capture-result):
//     gentle-ai review status --contract gentle-ai.review-integration/v2 \
//       --cwd <scratch> --agent claude-code --lineage <lineage> \
//       --projection workspace --next-transition
//   The top-level `repository_context` reference it carries is emitted by the
//   live binary but MISSING from the published status-v5.schema.json
//   (additionalProperties: false) at the same commit — the capture is
//   authoritative (parity playbook, known traps).
// - result-artifact-v2.captured.json and result-artifact-v2-path.captured.json
//   were captured 2026-08-16 from the real binary at
//   /home/gentleman/.cargo/bin/gentle-ai reporting
//   "gentle-ai 2.4.0-main.b1afef46", in a scratch git repository holding a
//   committed src/greet.js baseline plus an uncommitted shout() helper
//   (medium tier, one review-reliability lens): consent-granted START, then
//   the STATUS transition's exact `review capture-result` collect arguments
//   with a completed reviewer input document. The reference form is the
//   stdout of the --repository-context invocation (opaque rart1_ locator);
//   the path form re-ran the exact same admitted slot with --cwd instead,
//   which discovers the identical canonical bytes and answers with the
//   provider-owned store path. Both agree on every binding field.
// - status-v5-capture-result-submission.captured.json was captured 2026-08-16
//   from the real binary at /home/gentleman/.cargo/bin/gentle-ai reporting
//   "gentle-ai 2.4.0-main.b1afef46", in a scratch git repository holding a
//   committed src/add.js baseline plus an uncommitted double() helper
//   (medium tier, one review-reliability lens), with
//   GENTLE_PI_REVIEW_RELAY_CONTRACT=gentle-pi.review-relay/v1 exported:
//   negotiated STATUS (--agent pi), the rendered consent/v3 START, its exact
//   granted invocation, then
//     gentle-ai review status --contract gentle-ai.review-integration/v2 \
//       --cwd <scratch> --agent pi --next-transition
//   at reviewer_results_required. Its materialize capture-result collect
//   input carries the submission descriptor as a SINGULAR `value` object
//   with a `schema` key (emitter: gentle-ai f1a95179, singular from its
//   first commit) — not the `values` array this decoder was originally
//   written against. The capture is authoritative.

const fixtureRoot = join(import.meta.dirname, "fixtures", "devbinary");
const fixture = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as T;
const v2FixtureRoot = join(process.cwd(), "contracts", "review-integration", "v2", "fixtures");
const v2Fixture = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(join(v2FixtureRoot, name), "utf8")) as T;
const capturedDigest = "ffc91d8fa79c869aba9aa3d1ec80edebb5b1744e5a06fef75d4c8b73c0e46bc1";
const pinnedFixtureDigest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";

type JsonObject = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const sha = (fill: string): string => `sha256:${fill.repeat(64)}`;

test("the captured capabilities/v2.2 payload decodes and reports its own package version", () => {
	const capabilities = decodeReviewCapabilitiesV2(fixture("capabilities-v2.2.captured.json"), capturedDigest);
	assert.equal(capabilities.packageVersion, "2.4.0-rc.8+fix.verify-attestation-recovery");
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.status/v5"), true);
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.consent/v3"), true);
	assert.equal(capabilities.optionalFeatures.has("provider_bound_native_git_context"), true);
});

test("the derived capabilities/v2.1 payload decodes with protocol minor 1", () => {
	const capabilities = decodeReviewCapabilitiesV2(fixture("capabilities-v2.1.derived.json"), capturedDigest);
	assert.equal(capabilities.packageVersion, "2.4.0-rc.8+fix.verify-attestation-recovery");
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.status/v3"), true);
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.consent/v3"), true);
});

test("the pinned capabilities/v2 fixture still decodes unchanged", () => {
	const capabilities = decodeReviewCapabilitiesV2(v2Fixture("capabilities.fixture.json"), pinnedFixtureDigest);
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.status/v3"), true);
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.consent/v2"), true);
});

test("capabilities schema identity and protocol minor must agree", () => {
	const base = fixture<JsonObject>("capabilities-v2.2.captured.json");
	const wrongMinor = clone(base);
	(wrongMinor.protocol as JsonObject).minor = 1;
	assert.throws(() => decodeReviewCapabilitiesV2(wrongMinor, capturedDigest), /protocol/);
	const wrongSchema = clone(base);
	wrongSchema.schema = "gentle-ai.review-integration.capabilities/v2.3";
	assert.throws(() => decodeReviewCapabilitiesV2(wrongSchema, capturedDigest), /schema/);
	// The old identity never inherits the new advertisements: a v2 envelope
	// advertising the v2.2 schema surface is missing its own required floor.
	const crossed = clone(base);
	crossed.schema = "gentle-ai.review-integration.capabilities/v2";
	(crossed.protocol as JsonObject).minor = 0;
	assert.throws(() => decodeReviewCapabilitiesV2(crossed, capturedDigest), /schemas/);
});

test("the captured status/v5 payload decodes with its forecast and base-ref collect input", () => {
	const status = decodeReviewStatusV3(fixture("status-v5.captured.json"));
	assert.equal(status.applicability, "unrelated");
	assert.equal(status.action, "start");
	assert.equal(status.forecast?.horizon, "partial");
	assert.deepEqual(status.forecast?.steps, [{ step: 1, kind: "collect", reasonCode: "empty_candidate_base_ref_required", description: "empty candidate base ref required" }]);
	assert.equal(status.nextTransition?.kind, "collect");
	assert.equal(status.nextTransition?.collect?.inputs[0]?.captureOperation, "external.select_base_ref");
});

test("the pinned status/v3 fixture still decodes unchanged", () => {
	const status = decodeReviewStatusV3(v2Fixture("status.fixture.json"));
	assert.equal(status.contract, "gentle-ai.review-integration/v2");
});

test("the captured status/v5 payload decodes its top-level repository context reference", () => {
	const status = decodeReviewStatusV3(fixture("status-v5-repository-context.captured.json"));
	assert.equal(status.authority?.state, "reviewing");
	assert.equal(status.repositoryContext?.capability, "review.opaque_repository_context");
	assert.match(status.repositoryContext?.handle ?? "", /^rctx1_[0-9a-f]{64}$/);
	assert.equal(status.repositoryContext?.revision, status.authority?.revision);
	assert.equal(status.repositoryContext?.targetIdentity, status.targetIdentity);
	assert.equal(status.repositoryContext?.outcome, "applied");
});

test("a status/v3 payload never carries a top-level repository context", () => {
	const v5 = fixture<JsonObject>("status-v5-repository-context.captured.json");
	const downgraded = clone(v5);
	downgraded.schema = "gentle-ai.review-integration.status/v3";
	delete downgraded.forecast; // forecast is rejected first; isolate the field under test
	assert.throws(() => decodeReviewStatusV3(downgraded), /repository_context/);
});

test("a status/v3 payload never carries v5 fields", () => {
	const v5 = fixture<JsonObject>("status-v5.captured.json");
	const downgraded = clone(v5);
	downgraded.schema = "gentle-ai.review-integration.status/v3";
	// forecast is a v5 field; the v3 identity must keep rejecting it.
	assert.throws(() => decodeReviewStatusV3(downgraded), /forecast/);
	const withoutForecast = clone(downgraded);
	delete withoutForecast.forecast;
	const status = decodeReviewStatusV3(withoutForecast);
	assert.equal(status.forecast, undefined);
});

test("a v5 forecast requires the next transition and a coherent horizon", () => {
	const base = fixture<JsonObject>("status-v5.captured.json");
	const orphanForecast = clone(base);
	delete orphanForecast.next_transition;
	assert.throws(() => decodeReviewStatusV3(orphanForecast), /forecast/);
	const wrongHorizon = clone(base);
	(wrongHorizon.forecast as JsonObject).horizon = "terminal";
	assert.throws(() => decodeReviewStatusV3(wrongHorizon), /horizon/);
	const badStep = clone(base);
	((badStep.forecast as JsonObject).steps as JsonObject[])[0]!.step = 2;
	assert.throws(() => decodeReviewStatusV3(badStep), /step/);
	const extraKey = clone(base);
	(extraKey.forecast as JsonObject).unadvertised = true;
	assert.throws(() => decodeReviewStatusV3(extraKey), /not allowed/);
});

// --- v5-only next_transition surfaces, constructed per the vendored schemas ---

function v5StatusWith(nextTransition: JsonObject, forecast?: JsonObject): JsonObject {
	const base = fixture<JsonObject>("status-v5.captured.json");
	base.next_transition = nextTransition;
	if (forecast === undefined) delete base.forecast;
	else base.forecast = forecast;
	return base;
}

const correctionPlanRequest: JsonObject = {
	schema: "gentle-ai.review-correction-plan-request/v1",
	request_hash: sha("a"),
	lineage_id: "review-1d5aadacc600e167",
	expected_revision: sha("b"),
	target_identity: sha("c"),
	correction_budget: 25,
	fix_finding_ids: ["risk-1"],
	findings: [{
		id: "risk-1",
		lens: "risk",
		location: "app.ts:10",
		severity: "BLOCKER",
		claim: "candidate-introduced credential exposure",
		proof_refs: ["app.ts:10-14"],
		evidence: "the candidate logs the raw token",
		evidence_class: "deterministic",
		causal_disposition: "introduced",
	}],
};

test("a v5 correction_plan_required transition carries its correction request and plan submission", () => {
	const transition: JsonObject = {
		kind: "collect",
		reason_code: "correction_plan_required",
		correction_request: correctionPlanRequest,
		collect: {
			inputs: [{
				name: "correction_plan",
				schema: "gentle-ai.review-correction-plan/v1",
				capture_operation: "external.plan_correction",
				arguments: [{ name: "lineage", value: "review-1d5aadacc600e167" }],
				submission: {
					operation_token: "finalize",
					argument_tokens: [
						"--contract=gentle-ai.review-integration/v2",
						"--lineage=review-1d5aadacc600e167",
						`--expected-revision=${sha("b")}`,
						`--target=${sha("c")}`,
						`--request-hash=${sha("a")}`,
						`--repository-context=rctx1_${"0".repeat(64)}`,
						"--correction-lines={{value}}",
					],
					value: { slot: "correction_lines", domain: "positive_correction_lines", minimum: 1, maximum: 25, substitution_location: 6 },
				},
			}],
		},
	};
	const status = decodeReviewStatusV3(v5StatusWith(transition));
	assert.equal(status.nextTransition?.reasonCode, "correction_plan_required");
	assert.equal(status.nextTransition?.correctionRequest?.correctionBudget, 25);
	assert.equal(status.nextTransition?.collect?.inputs[0]?.submissionDescriptor?.operationToken, "finalize");
	// The same reason code without its correction request is incomplete.
	const missing = clone(transition);
	delete missing.correction_request;
	assert.throws(() => decodeReviewStatusV3(v5StatusWith(missing)), /correction_request/);
	// And correction_request never rides an unrelated reason code.
	const unrelated = clone(transition);
	unrelated.reason_code = "verification_evidence_required";
	assert.throws(() => decodeReviewStatusV3(v5StatusWith(unrelated)), /correction_request/);
});

test("a v5 capture-evidence transition decodes its evidence submission descriptor", () => {
	const transition: JsonObject = {
		kind: "collect",
		reason_code: "verification_evidence_required",
		collect: {
			inputs: [{
				name: "verification_evidence",
				schema: "https://gentle-ai.dev/schema/review/verification-evidence/v1",
				capture_operation: "review.capture-evidence",
				arguments: [{ name: "lineage", value: "review-1d5aadacc600e167" }],
				submission: {
					operation_token: "capture-evidence",
					argument_tokens: [
						"--lineage=review-1d5aadacc600e167",
						`--expected-revision=${sha("b")}`,
						`--target=${sha("c")}`,
						`--repository-context=rctx1_${"0".repeat(64)}`,
						"--outcome={{outcome}}",
						"--input={{input}}",
					],
					values: [
						{ slot: "outcome", domain: "verification_outcome", allowed_values: ["passed", "verification_failed", "procedural_tooling_failed"], substitution_location: 4 },
						{ slot: "input", domain: "artifact_path_or_stdin", schema: "https://gentle-ai.dev/schema/review/verification-evidence/v1", substitution_location: 5 },
					],
				},
			}],
		},
	};
	const status = decodeReviewStatusV3(v5StatusWith(transition));
	const input = status.nextTransition?.collect?.inputs[0];
	assert.equal(input?.submissionDescriptor?.operationToken, "capture-evidence");
	assert.equal(input?.submission, undefined);
	// Missing its required submission descriptor is incomplete.
	const missing = clone(transition);
	delete ((missing.collect as JsonObject).inputs as JsonObject[])[0]!.submission;
	assert.throws(() => decodeReviewStatusV3(v5StatusWith(missing)), /submission/);
});

test("a v5 provider role task input decodes and is confined to external.run_provider_role", () => {
	const providerTask = { agent: "review-refuter", role: "refuter", prompt: "GENTLE_AI_REVIEW_BINDING {}" };
	const transition: JsonObject = {
		kind: "collect",
		reason_code: "refuter_batch_required",
		collect: {
			inputs: [{
				name: "refuter_batch",
				schema: "https://gentle-ai.dev/schema/review/refuter/v1",
				capture_operation: "external.run_provider_role",
				arguments: [{ name: "lineage", value: "review-1d5aadacc600e167" }],
				provider_task: providerTask,
			}],
		},
	};
	const status = decodeReviewStatusV3(v5StatusWith(transition));
	assert.deepEqual(status.nextTransition?.collect?.inputs[0]?.providerTask, { agent: "review-refuter", role: "refuter", prompt: "GENTLE_AI_REVIEW_BINDING {}" });
	// The task is required on its own vector and forbidden anywhere else.
	const missing = clone(transition);
	delete ((missing.collect as JsonObject).inputs as JsonObject[])[0]!.provider_task;
	assert.throws(() => decodeReviewStatusV3(v5StatusWith(missing)), /provider_task/);
	const misplaced = fixture<JsonObject>("status-v5.captured.json");
	(((misplaced.next_transition as JsonObject).collect as JsonObject).inputs as JsonObject[])[0]!.provider_task = providerTask;
	assert.throws(() => decodeReviewStatusV3(misplaced), /provider_task/);
});

// --- v5 pi materialize capture-result submission: the singular `value` form ---

test("the captured v5 materialize capture-result submission decodes its singular value form", () => {
	const status = decodeReviewStatusV3(fixture("status-v5-capture-result-submission.captured.json"));
	assert.equal(status.authority?.state, "reviewing");
	assert.equal(status.nextTransition?.reasonCode, "reviewer_results_required");
	const input = status.nextTransition?.collect?.inputs[0];
	assert.equal(input?.captureOperation, "review.capture-result");
	assert.equal(input?.submissionDescriptor, undefined);
	assert.equal(input?.submission?.operationToken, "capture-result");
	// The singular wire `value` normalizes into the typed one-entry values
	// array the host relay already consumes.
	assert.deepEqual(input?.submission?.values, [{
		slot: "reviewer_result",
		domain: "artifact_path_or_stdin",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		substitutionLocation: 7,
	}]);
});

test("the v5 singular capture-result value form is closed to its captured shape", () => {
	const base = fixture<JsonObject>("status-v5-capture-result-submission.captured.json");
	const withSubmission = (mutate: (submission: JsonObject) => void): JsonObject => {
		const body = clone(base);
		mutate((((body.next_transition as JsonObject).collect as JsonObject).inputs as JsonObject[])[0]!.submission as JsonObject);
		return body;
	};
	// Carrying both wire forms at once matches no captured shape.
	assert.throws(() => decodeReviewStatusV3(withSubmission((submission) => {
		submission.values = [submission.value];
	})), /value/);
	// The singular form owns no numeric or enumerated domain: minimum,
	// maximum, and allowed_values belong to the finalize/capture-evidence
	// descriptor forms only.
	for (const [key, smuggled] of [["minimum", 1], ["maximum", 2], ["allowed_values", ["x"]]] as const) {
		assert.throws(() => decodeReviewStatusV3(withSubmission((submission) => {
			(submission.value as JsonObject)[key] = smuggled;
		})), /not allowed/);
	}
	// The captured form always names its reviewer schema and slot.
	assert.throws(() => decodeReviewStatusV3(withSubmission((submission) => {
		delete (submission.value as JsonObject).schema;
	})), /schema/);
	assert.throws(() => decodeReviewStatusV3(withSubmission((submission) => {
		(submission.value as JsonObject).slot = "validation";
	})), /slot/);
	assert.throws(() => decodeReviewStatusV3(withSubmission((submission) => {
		submission.operation_token = "finalize-relay";
	})), /operation_token/);
	// The legacy values-array rows stay exactly as they were: they never
	// learned the schema key the singular form carries.
	assert.throws(() => decodeReviewStatusV3(withSubmission((submission) => {
		const row = submission.value as JsonObject;
		delete submission.value;
		submission.values = [row];
	})), /not allowed/);
});

test("the v3 identity keeps rejecting the singular capture-result value form", () => {
	const body = clone(fixture<JsonObject>("status-v5-capture-result-submission.captured.json"));
	body.schema = "gentle-ai.review-integration.status/v3";
	delete body.forecast;
	delete body.repository_context;
	assert.throws(() => decodeReviewStatusV3(body), /values is required/);
});

test("the v3 next transition keeps rejecting every v5-only surface", () => {
	const v5 = fixture<JsonObject>("status-v5.captured.json");
	// Re-identify the captured envelope as v3 (drop the v5-only forecast) and
	// then try to smuggle each v5 surface through the old identity.
	const asV3 = (mutate: (transition: JsonObject) => void): JsonObject => {
		const body = clone(v5);
		body.schema = "gentle-ai.review-integration.status/v3";
		delete body.forecast;
		mutate(body.next_transition as JsonObject);
		return body;
	};
	assert.throws(() => decodeReviewStatusV3(asV3((transition) => { transition.correction_request = correctionPlanRequest; })), /not allowed|correction_request/);
	assert.throws(() => decodeReviewStatusV3(asV3((transition) => {
		(((transition.collect as JsonObject).inputs as JsonObject[])[0]!).provider_task = { agent: "review-refuter", role: "refuter", prompt: "x" };
	})), /not allowed|provider_task/);
	assert.throws(() => decodeReviewStatusV3(asV3((transition) => {
		(((transition.collect as JsonObject).inputs as JsonObject[])[0]!).submission = { operation_token: "finalize", argument_tokens: ["--correction-lines={{value}}"], value: { slot: "correction_lines", domain: "positive_correction_lines", minimum: 1, maximum: 25, substitution_location: 6 } };
	})), /submission|values/);
});

// --- consent/v3 — the negotiated v2.1+ consent question (adds `agent`) ---

test("the captured consent/v3 envelope decodes with its fixed agent binding", () => {
	const consent = decodeReviewConsentV3(fixture("consent-v3.captured.json"));
	assert.equal(consent.schema, "gentle-ai.review-integration.consent/v3");
	assert.equal(consent.agent, "claude-code");
	assert.equal(consent.action, "consent_required");
	assert.equal(consent.blocking, true);
	assert.equal(consent.riskLevel, "high");
	assert.equal(consent.changedFiles, 2);
	assert.equal(consent.changedLines, 12);
	assert.equal(consent.choices[0].answer, "granted");
	assert.equal(consent.choices[1].answer, "declined");
	for (const choice of consent.choices) {
		assert.ok(choice.invocation.includes(` --target ${consent.targetIdentity} `));
	}
	assert.equal(consent.offPath.command, "gentle-ai review mode disable");
});

test("Pi consent/v3 requires provider-issued Pi invocation bindings", () => {
	const piConsent = clone(fixture<JsonObject>("consent-v3.captured.json"));
	piConsent.agent = "pi";
	for (const choice of piConsent.choices as JsonObject[]) {
		choice.invocation = String(choice.invocation).replace(" --consent ", " --agent pi --consent ");
	}
	const decoded = decodeReviewConsentV3(piConsent);
	assert.equal(decoded.agent, "pi");
	assert.ok(decoded.choices.every((choice) => choice.invocation.includes(" --agent pi ")));

	const missingInvocationBinding = clone(piConsent);
	for (const choice of missingInvocationBinding.choices as JsonObject[]) {
		choice.invocation = String(choice.invocation).replace(" --agent pi", "");
	}
	assert.throws(() => decodeReviewConsentV3(missingInvocationBinding), /agent/);
});

test("consent identities never cross-decode", () => {
	const v3 = fixture<JsonObject>("consent-v3.captured.json");
	const v2 = v2Fixture<JsonObject>("consent.fixture.json");
	// The old identity never accepts the new surface, and vice versa.
	assert.throws(() => decodeReviewConsentV2(clone(v3)), /agent|schema/);
	assert.throws(() => decodeReviewConsentV3(clone(v2)), /agent|schema/);
	// A schema-swapped v3 body keeps its agent key, which the v2 identity
	// still rejects as an unadvertised surface.
	const downgraded = clone(v3);
	downgraded.schema = "gentle-ai.review-integration.consent/v2";
	assert.throws(() => decodeReviewConsentV2(downgraded), /agent/);
	// A schema-swapped v2 body is missing the agent key v3 requires.
	const upgraded = clone(v2);
	upgraded.schema = "gentle-ai.review-integration.consent/v3";
	assert.throws(() => decodeReviewConsentV3(upgraded), /agent/);
});

test("consent/v3 keeps every v2 semantic guard and pins its agent constant", () => {
	const base = fixture<JsonObject>("consent-v3.captured.json");
	const wrongAgent = clone(base);
	wrongAgent.agent = "opencode";
	assert.throws(() => decodeReviewConsentV3(wrongAgent), /agent/);
	const swapped = clone(base);
	swapped.choices = [...(swapped.choices as JsonObject[])].reverse();
	assert.throws(() => decodeReviewConsentV3(swapped), /answer/);
	const badInvocation = clone(base);
	((badInvocation.choices as JsonObject[])[0]!).invocation = "gentle-ai review finalize --consent granted";
	assert.throws(() => decodeReviewConsentV3(badInvocation), /invocation/);
	const differentTarget = clone(base);
	differentTarget.target_identity = sha("d");
	assert.throws(() => decodeReviewConsentV3(differentTarget), /target|invocation/);
	const notBlocking = clone(base);
	notBlocking.blocking = false;
	assert.throws(() => decodeReviewConsentV3(notBlocking), /blocking/);
	const extraKey = clone(base);
	extraKey.unadvertised = true;
	assert.throws(() => decodeReviewConsentV3(extraKey), /not allowed/);
});

test("the pinned consent/v2 fixture still decodes unchanged", () => {
	const consent = decodeReviewConsentV2(v2Fixture("consent.fixture.json"));
	assert.equal(consent.schema, "gentle-ai.review-integration.consent/v2");
	assert.equal(consent.action, "consent_required");
});

// --- start/v3 — main extends repository_context with event_id/outcome ---

test("the captured granted start/v3 decodes with its repository context event binding", () => {
	const start = decodeReviewStartV3(fixture("start-v3-consent-granted.captured.json"));
	assert.equal(start.lineageId, "review-377c60e10b852cfc");
	assert.equal(start.state, "reviewing");
	assert.equal(start.riskLevel, "high");
	assert.equal(start.selectedLenses.length, 4);
	assert.equal(start.correctionBudget, 6);
	assert.equal(start.repositoryContext?.outcome, "applied");
	assert.match(start.repositoryContext?.eventId ?? "", /^sha256:[0-9a-f]{64}$/);
});

test("start/v3 repository context event fields stay optional and exact", () => {
	// The pinned fixture carries neither field and still decodes unchanged.
	const pinned = decodeReviewStartV3(v2Fixture("start.fixture.json"));
	assert.equal(pinned.repositoryContext?.eventId, undefined);
	assert.equal(pinned.repositoryContext?.outcome, undefined);
	const base = fixture<JsonObject>("start-v3-consent-granted.captured.json");
	const badEvent = clone(base);
	(badEvent.repository_context as JsonObject).event_id = "not-a-digest";
	assert.throws(() => decodeReviewStartV3(badEvent), /event_id/);
	const badOutcome = clone(base);
	(badOutcome.repository_context as JsonObject).outcome = "unheard-of";
	assert.throws(() => decodeReviewStartV3(badOutcome), /outcome/);
	const extraKey = clone(base);
	(extraKey.repository_context as JsonObject).unadvertised = true;
	assert.throws(() => decodeReviewStartV3(extraKey), /not allowed/);
});

// --- result-artifact/v2: the `review capture-result` admission envelope ---

test("the captured reference-form result artifact decodes with its rart1 locator", () => {
	const artifact = decodeReviewResultArtifactV2(fixture("result-artifact-v2.captured.json"));
	assert.equal(artifact.schema, "gentle-ai.review-result-artifact/v2");
	assert.equal(artifact.capability, "review.native_result_artifact");
	assert.match(artifact.reference ?? "", /^rart1_[0-9a-f]{64}$/);
	assert.equal(artifact.path, undefined);
	assert.equal(artifact.lineageId, "review-ceeb2b862bd39709");
	assert.equal(artifact.lens, "review-reliability");
	assert.equal(artifact.selectedOrder, 0);
	assert.equal(artifact.admissionDecision, "completed");
	assert.match(artifact.sha256, /^sha256:[0-9a-f]{64}$/);
	assert.match(artifact.subjectHash, /^sha256:[0-9a-f]{64}$/);
	assert.match(artifact.targetIdentity, /^sha256:[0-9a-f]{64}$/);
});

test("the captured path-form result artifact decodes with its provider-owned path", () => {
	const artifact = decodeReviewResultArtifactV2(fixture("result-artifact-v2-path.captured.json"));
	assert.equal(artifact.reference, undefined);
	assert.match(artifact.path ?? "", /reviewer-results\/00-review-reliability\.json$/);
	// Same admitted slot through both locator forms: every binding agrees.
	const reference = decodeReviewResultArtifactV2(fixture("result-artifact-v2.captured.json"));
	assert.equal(artifact.sha256, reference.sha256);
	assert.equal(artifact.subjectHash, reference.subjectHash);
	assert.equal(artifact.lineageId, reference.lineageId);
	assert.equal(artifact.targetIdentity, reference.targetIdentity);
});

test("a result artifact carries exactly one locator", () => {
	const base = fixture<JsonObject>("result-artifact-v2.captured.json");
	const both = clone(base);
	both.path = "/store/reviewer-results/00-review-reliability.json";
	assert.throws(() => decodeReviewResultArtifactV2(both), /exactly one/);
	const neither = clone(base);
	delete neither.reference;
	assert.throws(() => decodeReviewResultArtifactV2(neither), /exactly one/);
});

test("a result artifact rejects unknown keys and weakened bindings", () => {
	const base = fixture<JsonObject>("result-artifact-v2.captured.json");
	const extra = clone(base);
	extra.unadvertised = true;
	assert.throws(() => decodeReviewResultArtifactV2(extra), /not allowed/);
	const wrongCapability = clone(base);
	wrongCapability.capability = "review.result_artifact";
	assert.throws(() => decodeReviewResultArtifactV2(wrongCapability), /capability/);
	const unadmitted = clone(base);
	unadmitted.admission_decision = "quarantined";
	assert.throws(() => decodeReviewResultArtifactV2(unadmitted), /admission_decision/);
	const foreignLocator = clone(base);
	foreignLocator.reference = `rref1_${"b".repeat(64)}`;
	assert.throws(() => decodeReviewResultArtifactV2(foreignLocator), /reference/);
	const outOfRange = clone(base);
	outOfRange.selected_order = 4;
	assert.throws(() => decodeReviewResultArtifactV2(outOfRange), /selected_order/);
});

test("result artifact identities never cross-decode", () => {
	// A prior identity rejects the new surface (it carries no negotiated
	// contract/operation identity pair at all)...
	assert.throws(() => decodeReviewOperationV2(fixture("result-artifact-v2.captured.json")), /contract|schema/);
	// ...the new decoder pins its own exact identity...
	const downgraded = clone(fixture<JsonObject>("result-artifact-v2.captured.json"));
	downgraded.schema = "gentle-ai.review-result-artifact/v1";
	assert.throws(() => decodeReviewResultArtifactV2(downgraded), /schema/);
	// ...and rejects prior surfaces wholesale.
	assert.throws(() => decodeReviewResultArtifactV2({
		schema: "gentle-ai.review-provider-role-capture/v1",
		lineage_id: "review-1d5aadacc600e167",
		target_identity: `sha256:${"9".repeat(64)}`,
		role: "targeted-validator",
		captured: true,
	}));
	assert.throws(() => decodeReviewResultArtifactV2(v2Fixture("status.fixture.json")));
});

// Fixture provenance:
// - failure-v2-capture-evidence.captured.json was captured 2026-08-16 from a
//   binary built at gentle-ai commit a2d57117 (branch
//   fix/capture-evidence-typed-refusal, `go build ./cmd/gentle-ai`, version
//   banner "gentle-ai dev"), in a scratch git repository driven to the
//   correction evidence-pending state (medium start with consent granted,
//   one deterministic BLOCKER capture-result, rendered finalize transition,
//   rendered plan-correction submission, bounded fix edit), then a
//   deliberately misbound capture:
//     gentle-ai review capture-evidence --cwd <scratch> --lineage <lineage> \
//       --target <live workspace identity> --expected-revision <revision> \
//       --outcome passed --input <evidence file>
//   The live workspace identity instead of the slot's fix-diff --target is
//   the exact fambig misbinding shape; the branch answers it with the typed
//   failure/v2 envelope on stdout (operation review.capture-evidence, code
//   verification_evidence_binding_mismatch, mutation_outcome not_started)
//   instead of a bare stderr line.
// - The other three capture-verb operations are constructed from the same
//   captured envelope, grounded in that branch's
//   contracts/review-integration/v2/schemas/failure.schema.json 12-value
//   operation enum; no cheap live flow provokes them individually.
test("failure/v2 decodes the four collect-capture operations the typed-refusal branch emits", () => {
	const captured = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "devbinary", "failure-v2-capture-evidence.captured.json"), "utf8")) as Record<string, unknown>;
	const decoded = decodeReviewFailureV2(captured);
	assert.equal(decoded.operation, "review.capture-evidence");
	assert.equal(decoded.code, "verification_evidence_binding_mismatch");
	assert.equal(decoded.mutationOutcome, "not_started");
	assert.equal(decoded.nextAction, "review.status");
	for (const operation of ["review.capture-result", "review.capture-refuter", "review.capture-validation"]) {
		assert.equal(decodeReviewFailureV2({ ...captured, operation }).operation, operation, operation);
	}
	// Cross-pinned rejection preserved: an operation outside the published
	// 12-value enum never decodes.
	assert.throws(() => decodeReviewFailureV2({ ...captured, operation: "review.capture-bogus" }), /failure\.operation/);
	assert.throws(() => decodeReviewFailureV2({ ...captured, operation: "review.recover" }), /failure\.operation/);
});
