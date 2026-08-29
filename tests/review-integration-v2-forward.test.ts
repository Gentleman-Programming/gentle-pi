import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	decodeReviewCapabilitiesV2,
	decodeReviewConsentV2,
	decodeReviewConsentV3,
	decodeReviewLastEventClosureV1,
	decodeReviewResultArtifactV2,
	decodeReviewStartV3,
	decodeReviewStatusV3,
} from "../lib/review-integration-v2.ts";

const DEV_FIXTURES = join(process.cwd(), "tests", "fixtures", "devbinary");
const V2_FIXTURES = join(process.cwd(), "contracts", "review-integration", "v2", "fixtures");
const CAPTURED_DIGEST = "ffc91d8fa79c869aba9aa3d1ec80edebb5b1744e5a06fef75d4c8b73c0e46bc1";

type JsonObject = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const sha = (fill: string): string => `sha256:${fill.repeat(64)}`;

function fixture(root: string, name: string): unknown {
	return JSON.parse(readFileSync(join(root, name), "utf8"));
}

function currentStatusFixture(name: string): Record<string, unknown> {
	const body = structuredClone(fixture(DEV_FIXTURES, name)) as Record<string, unknown>;
	if (body.action === "finalize") {
		body.action = "stop";
		const transition = body.next_transition as Record<string, unknown> | undefined;
		if (transition?.kind === "execute") {
			delete body.next_transition;
			delete body.forecast;
		}
	}
	return body;
}

test("captured capabilities retain their exact schema identity", () => {
	const capabilities = decodeReviewCapabilitiesV2(
		fixture(DEV_FIXTURES, "capabilities-v2.2.captured.json"),
		CAPTURED_DIGEST,
	);
	assert.equal(capabilities.packageVersion, "2.4.0-rc.8+fix.verify-attestation-recovery");
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.status/v5"), true);
});

test("historical v3 FINALIZE status remains rejected without rewriting fixture bytes", () => {
	assert.throws(
		() => decodeReviewStatusV3(fixture(V2_FIXTURES, "status.fixture.json")),
		/receipt|finalize|status/i,
	);
});

test("captured v5 STATUS preserves its strict receipt while routing intended-untracked selection", () => {
	const body = currentStatusFixture("status-v5.captured.json");
	(body.next_transition as JsonObject).reason_code = "intended_untracked_selection_required";
	const decoded = decodeReviewStatusV3(body);
	assert.deepEqual(decoded.receipt, { status: "not_applicable" });
	assert.equal(decoded.nextTransition?.kind, "collect");
	assert.equal(decoded.nextTransition?.reasonCode, "intended_untracked_selection_required");
});

test("v5 STATUS rejects malformed receipt status, identity, and extra fields", () => {
	const unsupported = currentStatusFixture("status-v5.captured.json");
	(unsupported.receipt as JsonObject).status = "retired";
	assert.throws(() => decodeReviewStatusV3(unsupported), /status\.receipt\.status/);

	const invalidIdentity = currentStatusFixture("status-v5.captured.json");
	(invalidIdentity.receipt as JsonObject).identity = "not-a-sha256";
	assert.throws(() => decodeReviewStatusV3(invalidIdentity), /status\.receipt\.identity/);

	const extra = currentStatusFixture("status-v5.captured.json");
	(extra.receipt as JsonObject).unexpected = true;
	assert.throws(() => decodeReviewStatusV3(extra), /status\.receipt\.unexpected is not allowed/);
});

test("captured terminal closure decodes without a compatibility status projection", () => {
	const closure = decodeReviewLastEventClosureV1(
		fixture(DEV_FIXTURES, "last-event-capture-result-approved.captured.json"),
	);
	assert.equal(closure.operation, "review/capture-result");
	assert.equal(closure.state, "approved");
});

test("derived and pinned capabilities remain separately schema-pinned", () => {
	const derived = decodeReviewCapabilitiesV2(fixture(DEV_FIXTURES, "capabilities-v2.1.derived.json"), CAPTURED_DIGEST);
	assert.equal(derived.schemas.has("gentle-ai.review-integration.consent/v3"), true);
	const pinned = decodeReviewCapabilitiesV2(fixture(V2_FIXTURES, "capabilities.fixture.json"), "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705");
	assert.equal(pinned.schemas.has("gentle-ai.review-integration.consent/v2"), true);
});

test("capabilities reject a protocol minor that disagrees with their exact identity", () => {
	const body = fixture(DEV_FIXTURES, "capabilities-v2.2.captured.json") as Record<string, unknown>;
	const mutated = structuredClone(body) as Record<string, unknown>;
	(mutated.protocol as Record<string, unknown>).minor = 1;
	assert.throws(() => decodeReviewCapabilitiesV2(mutated, CAPTURED_DIGEST), /protocol/);
});

test("captured v5 STATUS preserves its provider forecast and collect binding", () => {
	const decoded = decodeReviewStatusV3(currentStatusFixture("status-v5.captured.json"));
	assert.equal(decoded.forecast?.horizon, "partial");
	assert.equal(decoded.nextTransition?.kind, "collect");
	assert.equal(decoded.nextTransition?.collect?.inputs[0]?.captureOperation, "external.select_base_ref");
});

test("v3 status identity rejects v5-only forecast fields", () => {
	const body = currentStatusFixture("status-v5.captured.json");
	body.schema = "gentle-ai.review-integration.status/v3";
	delete body.receipt;
	assert.throws(() => decodeReviewStatusV3(body), /forecast/);
});

test("captured v5 STATUS retains its opaque repository context reference", () => {
	const decoded = decodeReviewStatusV3(currentStatusFixture("status-v5-repository-context.captured.json"));
	assert.match(decoded.repositoryContext?.handle ?? "", /^rctx1_[0-9a-f]{64}$/);
	assert.equal(decoded.repositoryContext?.targetIdentity, decoded.targetIdentity);
});

test("the singular v5 capture-result submission normalizes to one typed value", () => {
	const decoded = decodeReviewStatusV3(currentStatusFixture("status-v5-capture-result-submission.captured.json"));
	const input = decoded.nextTransition?.collect?.inputs[0];
	assert.equal(input?.captureOperation, "review.capture-result");
	assert.deepEqual(input?.submission?.values, [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", schema: "https://gentle-ai.dev/schema/review/reviewer/v1", substitutionLocation: 7 }]);
});

test("the singular capture-result form rejects competing legacy values", () => {
	const body = currentStatusFixture("status-v5-capture-result-submission.captured.json");
	const input = (((body.next_transition as Record<string, unknown>).collect as Record<string, unknown>).inputs as Record<string, unknown>[])[0]!;
	const submission = input.submission as Record<string, unknown>;
	submission.values = [submission.value];
	assert.throws(() => decodeReviewStatusV3(body), /value/);
});

test("consent/v3 accepts the Pi runtime only when its exact agent binding matches", () => {
	const captured = fixture(DEV_FIXTURES, "consent-v3.captured.json") as Record<string, unknown>;
	const piConsent = decodeReviewConsentV3({ ...captured, agent: "pi" }, "pi");
	assert.equal(piConsent.agent, "pi");
	assert.throws(() => decodeReviewConsentV3(captured, "pi"), /consent\.agent/);
});

test("consent identities remain cross-decoder incompatible", () => {
	const v3 = fixture(DEV_FIXTURES, "consent-v3.captured.json");
	const v2 = fixture(V2_FIXTURES, "consent.fixture.json");
	assert.throws(() => decodeReviewConsentV2(v3), /agent|schema/);
	assert.throws(() => decodeReviewConsentV3(v2), /agent|schema/);
});

test("captured granted START keeps its repository-context event binding", () => {
	const start = decodeReviewStartV3(fixture(DEV_FIXTURES, "start-v3-consent-granted.captured.json"));
	assert.equal(start.state, "reviewing");
	assert.match(start.repositoryContext?.eventId ?? "", /^sha256:[0-9a-f]{64}$/);
});

test("result artifacts retain mutually exclusive reference and path locators", () => {
	const reference = decodeReviewResultArtifactV2(fixture(DEV_FIXTURES, "result-artifact-v2.captured.json"));
	const path = decodeReviewResultArtifactV2(fixture(DEV_FIXTURES, "result-artifact-v2-path.captured.json"));
	assert.match(reference.reference ?? "", /^rart1_[0-9a-f]{64}$/);
	assert.equal(reference.path, undefined);
	assert.equal(path.reference, undefined);
	assert.equal(path.sha256, reference.sha256);
});

test("result artifacts reject a second locator", () => {
	const body = structuredClone(fixture(DEV_FIXTURES, "result-artifact-v2.captured.json")) as Record<string, unknown>;
	body.path = "/store/reviewer-results/00-review-reliability.json";
	assert.throws(() => decodeReviewResultArtifactV2(body), /exactly one/);
});

test("nonuniform role capture closures retain their exact upstream operation identities", () => {
	assert.equal(decodeReviewLastEventClosureV1(fixture(DEV_FIXTURES, "last-event-capture-refuter-approved.captured.json")).operation, "review.capture-refuter");
	assert.equal(decodeReviewLastEventClosureV1(fixture(DEV_FIXTURES, "last-event-capture-validation-approved.captured.json")).operation, "review/capture-validation");
});

test("the derived capabilities/v2.1 payload decodes with protocol minor 1", () => {
	const capabilities = decodeReviewCapabilitiesV2(fixture(DEV_FIXTURES, "capabilities-v2.1.derived.json"), CAPTURED_DIGEST);
	assert.equal(capabilities.packageVersion, "2.4.0-rc.8+fix.verify-attestation-recovery");
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.status/v3"), true);
	assert.equal(capabilities.schemas.has("gentle-ai.review-integration.consent/v3"), true);
});

test("a status/v3 payload never carries a top-level repository context", () => {
	const body = currentStatusFixture("status-v5-repository-context.captured.json");
	body.schema = "gentle-ai.review-integration.status/v3";
	delete body.receipt;
	delete body.forecast;
	assert.throws(() => decodeReviewStatusV3(body), /repository_context/);
});

test("a v5 forecast requires the next transition and a coherent horizon", () => {
	const orphanForecast = currentStatusFixture("status-v5.captured.json");
	delete orphanForecast.next_transition;
	assert.throws(() => decodeReviewStatusV3(orphanForecast), /forecast/);
	const wrongHorizon = currentStatusFixture("status-v5.captured.json");
	(wrongHorizon.forecast as JsonObject).horizon = "terminal";
	assert.throws(() => decodeReviewStatusV3(wrongHorizon), /horizon/);
	const badStep = currentStatusFixture("status-v5.captured.json");
	((badStep.forecast as JsonObject).steps as JsonObject[])[0]!.step = 2;
	assert.throws(() => decodeReviewStatusV3(badStep), /step/);
});

test("a v5 provider role task input decodes and is confined to external.run_provider_role", () => {
	const body = currentStatusFixture("status-v5.captured.json");
	const transition = body.next_transition as JsonObject;
	const input = ((transition.collect as JsonObject).inputs as JsonObject[])[0]!;
	input.name = "refuter_batch";
	input.schema = "https://gentle-ai.dev/schema/review/refuter/v1";
	input.capture_operation = "external.run_provider_role";
	input.provider_task = { agent: "review-refuter", role: "refuter", prompt: "GENTLE_AI_REVIEW_BINDING {}" };
	const decoded = decodeReviewStatusV3(body);
	assert.deepEqual(decoded.nextTransition?.collect?.inputs[0]?.providerTask, { agent: "review-refuter", role: "refuter", prompt: "GENTLE_AI_REVIEW_BINDING {}" });
	const missing = clone(body);
	delete ((((missing.next_transition as JsonObject).collect as JsonObject).inputs as JsonObject[])[0]!).provider_task;
	assert.throws(() => decodeReviewStatusV3(missing), /provider_task/);
});

test("the v3 identity keeps rejecting the singular capture-result value form", () => {
	const body = currentStatusFixture("status-v5-capture-result-submission.captured.json");
	body.schema = "gentle-ai.review-integration.status/v3";
	delete body.receipt;
	delete body.forecast;
	delete body.repository_context;
	assert.throws(() => decodeReviewStatusV3(body), /values is required/);
});

test("the v3 next transition keeps rejecting every v5-only surface", () => {
	const v5 = currentStatusFixture("status-v5.captured.json");
	v5.schema = "gentle-ai.review-integration.status/v3";
	delete v5.receipt;
	delete v5.forecast;
	const transition = v5.next_transition as JsonObject;
	transition.correction_request = { schema: "gentle-ai.review-correction-plan-request/v1", request_hash: sha("a") };
	assert.throws(() => decodeReviewStatusV3(v5), /not allowed|correction_request/);
});

test("consent/v3 keeps every v2 semantic guard and rejects agents outside the fixed runtime contract", () => {
	const base = fixture(DEV_FIXTURES, "consent-v3.captured.json") as JsonObject;
	for (const agent of ["kilocode", "future-runtime", ""] as const) {
		assert.throws(() => decodeReviewConsentV3({ ...clone(base), agent }), /agent/);
	}
	const swapped = clone(base);
	swapped.choices = [...(swapped.choices as JsonObject[])].reverse();
	assert.throws(() => decodeReviewConsentV3(swapped), /answer/);
	const wrongTarget = clone(base);
	wrongTarget.target_identity = sha("d");
	assert.throws(() => decodeReviewConsentV3(wrongTarget), /target|invocation/);
});

test("start/v3 repository context event fields stay optional and exact", () => {
	const pinned = decodeReviewStartV3(fixture(V2_FIXTURES, "start.fixture.json"));
	assert.equal(pinned.repositoryContext?.eventId, undefined);
	assert.equal(pinned.repositoryContext?.outcome, undefined);
	const badEvent = clone(fixture(DEV_FIXTURES, "start-v3-consent-granted.captured.json") as JsonObject);
	(badEvent.repository_context as JsonObject).event_id = "not-a-digest";
	assert.throws(() => decodeReviewStartV3(badEvent), /event_id/);
	const badOutcome = clone(fixture(DEV_FIXTURES, "start-v3-consent-granted.captured.json") as JsonObject);
	(badOutcome.repository_context as JsonObject).outcome = "unheard-of";
	assert.throws(() => decodeReviewStartV3(badOutcome), /outcome/);
});

test("a result artifact rejects unknown keys and weakened bindings", () => {
	const base = fixture(DEV_FIXTURES, "result-artifact-v2.captured.json") as JsonObject;
	const extra = clone(base);
	extra.unadvertised = true;
	assert.throws(() => decodeReviewResultArtifactV2(extra), /not allowed/);
	const wrongCapability = clone(base);
	wrongCapability.capability = "review.result_artifact";
	assert.throws(() => decodeReviewResultArtifactV2(wrongCapability), /capability/);
	const foreignLocator = clone(base);
	foreignLocator.reference = `rref1_${"b".repeat(64)}`;
	assert.throws(() => decodeReviewResultArtifactV2(foreignLocator), /reference/);
});
