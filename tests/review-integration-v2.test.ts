import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	REVIEW_INTEGRATION_CONTRACT,
	REVIEW_START_STATE,
	decodeAuthorityRepairAssessmentV1,
	decodeReviewArtifactSubjectV2,
	decodeReviewCapabilitiesV2,
	decodeReviewConsentV2,
	decodeReviewFailureV2,
	decodeReviewNextTransitionV3,
	decodeReviewOperationV2,
	decodeReviewProjectionV1,
	decodeReviewRepairV2,
	decodeReviewStartV3,
	decodeReviewStatusV3,
} from "../lib/review-integration-v2.ts";

const fixtureRoot = join(process.cwd(), "contracts", "review-integration", "v2", "fixtures");
const fixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as T;
const executableDigest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";
const digest = `sha256:${"a".repeat(64)}`;

type JsonObject = Record<string, unknown>;
type Decoder = (value: unknown) => unknown;

function clone<T>(value: T): T {
	return structuredClone(value);
}

function assertRequired(decoder: Decoder, source: JsonObject, fields: readonly string[]): void {
	for (const field of fields) {
		const candidate = clone(source);
		delete candidate[field];
		assert.throws(() => decoder(candidate), new RegExp(`${field}.*required|required.*${field}`), field);
	}
}

function assertNestedRequired(decoder: Decoder, source: JsonObject, path: readonly string[], fields: readonly string[]): void {
	for (const field of fields) {
		const candidate = clone(source);
		let target = candidate;
		for (const segment of path) target = target[segment] as JsonObject;
		delete target[field];
		assert.throws(() => decoder(candidate), /required/, `${path.join(".")}.${field}`);
	}
}

function assertAdditionalProperty(decoder: Decoder, source: JsonObject, path: readonly string[] = []): void {
	const candidate = clone(source);
	let target = candidate;
	for (const segment of path) target = target[segment] as JsonObject;
	target.unadvertised = true;
	assert.throws(() => decoder(candidate), /not allowed/, path.length === 0 ? "top-level" : path.join("."));
}

test("every published review integration v2 fixture decodes", () => {
	assert.equal(decodeReviewCapabilitiesV2(fixture("capabilities.fixture.json"), executableDigest).contract, REVIEW_INTEGRATION_CONTRACT);
	assert.equal(decodeReviewStartV3(fixture("start.fixture.json")).riskLevel, "high");
	assert.equal(decodeReviewStatusV3(fixture("status.fixture.json")).contract, REVIEW_INTEGRATION_CONTRACT);
	assert.equal(decodeReviewConsentV2(fixture("consent.fixture.json")).action, "consent_required");
});

test("capabilities enforce every required top-level and nested property", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode: Decoder = (value) => decodeReviewCapabilitiesV2(value, executableDigest);
	assertRequired(decode, source, ["schema", "contract", "protocol", "package", "build", "executable", "operations", "gates", "projections", "schemas", "features", "compatibility"]);
	assertNestedRequired(decode, source, ["protocol"], ["major", "minor"]);
	assertNestedRequired(decode, source, ["package"], ["name", "version", "release_channel"]);
	assertNestedRequired(decode, source, ["build"], ["id", "go_version", "module_version", "vcs", "vcs_revision", "vcs_time", "vcs_modified"]);
	assertNestedRequired(decode, source, ["executable"], ["sha256", "evidence", "verification"]);
	assertNestedRequired(decode, source, ["features"], ["mandatory", "optional"]);
	assertNestedRequired(decode, source, ["compatibility"], ["minimum_protocol_major", "maximum_protocol_major", "additive_minor_policy", "unknown_mandatory", "unknown_optional", "modes", "legacy_window"]);
});

test("capabilities reject additional properties at every exact object boundary", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode: Decoder = (value) => decodeReviewCapabilitiesV2(value, executableDigest);
	for (const path of [[], ["protocol"], ["package"], ["build"], ["executable"], ["features"], ["compatibility"], ["compatibility", "legacy_window"]] as const) {
		assertAdditionalProperty(decode, source, path);
	}
});

test("capabilities reject an incompatible protocol identity", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode: Decoder = (value) => decodeReviewCapabilitiesV2(value, executableDigest);
	const wrongMajor = clone(source);
	(wrongMajor.protocol as JsonObject).major = 1;
	assert.throws(() => decode(wrongMajor), /incompatible/);
	const wrongMinor = clone(source);
	(wrongMinor.protocol as JsonObject).minor = 1;
	assert.throws(() => decode(wrongMinor), /incompatible/);
	assert.throws(() => decode({ ...clone(source), schema: "gentle-ai.review-integration.capabilities/v1" }), /schema/);
});

test("START enforces required, exact, and enum-bounded payloads", () => {
	const source = fixture<JsonObject>("start.fixture.json");
	assertRequired(decodeReviewStartV3, source, ["schema", "contract", "operation", "action", "lenses_required", "lineage_id", "state", "risk_level", "selected_lenses", "projection", "changed_files", "changed_lines", "correction_budget", "risk_reasons", "artifact_subjects"]);
	assertAdditionalProperty(decodeReviewStartV3, source);
	for (const state of Object.values(REVIEW_START_STATE)) {
		const candidate = clone(source);
		candidate.state = state;
		if (state === "reviewing") continue; // fixture is action=created, state=reviewing already requires repository_context which is present
		assert.throws(() => decodeReviewStartV3(candidate), /repository_context|state/);
	}
});

test("status enforces required properties and rejects additional keys", () => {
	const source = fixture<JsonObject>("status.fixture.json");
	assertRequired(decodeReviewStatusV3, source, ["schema", "contract", "operation", "applicability", "receipt", "action", "replayability", "target_identity", "projection", "repair", "candidates"]);
	assertAdditionalProperty(decodeReviewStatusV3, source);
});

test("projection enforces every required property and rejects additional keys", () => {
	const source = (fixture<JsonObject>("status.fixture.json").projection as JsonObject);
	assertRequired(decodeReviewProjectionV1, source, ["schema", "kind", "projection", "base_tree", "initial_review_tree", "current_candidate_tree", "paths_digest", "paths", "intended_untracked", "intended_untracked_proof", "initial_snapshot_identity", "current_snapshot_identity"]);
	assertAdditionalProperty(decodeReviewProjectionV1, source);
});

test("failure enforces exact keys, enums, and identifiers", () => {
	const source: JsonObject = {
		schema: "gentle-ai.review-integration.failure/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.finalize",
		phase: "pre_native",
		code: "gate_scope_changed",
		message: "the target scope changed since START",
		mutation_outcome: "not_started",
		authority_applicability: "current_target",
		retry_safe: true,
		replayability: "manual_action_required",
		required_inputs: [],
		next_action: "explicit-maintainer-action",
	};
	assert.equal(decodeReviewFailureV2(source).code, "gate_scope_changed");
	assertRequired(decodeReviewFailureV2, source, ["schema", "contract", "operation", "phase", "code", "message", "mutation_outcome", "authority_applicability", "retry_safe", "replayability", "required_inputs", "next_action"]);
	assertAdditionalProperty(decodeReviewFailureV2, source);
	const badCode = clone(source);
	badCode.code = "Bad-Code";
	assert.throws(() => decodeReviewFailureV2(badCode), /code/);
});

function finalizeEnvelope(): JsonObject {
	return {
		schema: "gentle-ai.review-integration.operation/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.finalize",
		result: {
			operation: "review/finalize",
			lineage_id: "review-fixture",
			state: "approved",
			action: "publish",
			store_revision: digest,
		},
	};
}

test("operation envelopes strictly bind the outer operation to one exact result variant", () => {
	const envelope = finalizeEnvelope();
	assert.equal(decodeReviewOperationV2(envelope).operation, "review.finalize");
	assertAdditionalProperty(decodeReviewOperationV2, envelope);
	assertNestedRequired(decodeReviewOperationV2, envelope, ["result"], ["operation", "lineage_id", "state", "action", "store_revision"]);
});

test("net-new decoders: consent, next-transition, and artifact-subject reject malformed payloads", () => {
	const consentSource = fixture<JsonObject>("consent.fixture.json");
	assertRequired(decodeReviewConsentV2, consentSource, ["schema", "contract", "operation", "action", "blocking", "target_identity", "projection", "risk_level", "changed_files", "changed_lines", "headline", "reason", "value", "risk_evidence", "choices", "off_path"]);
	assertAdditionalProperty(decodeReviewConsentV2, consentSource);

	const transitionSource = ((fixture<JsonObject>("status.fixture.json").next_transition) as JsonObject);
	assertRequired(decodeReviewNextTransitionV3, transitionSource, ["kind", "reason_code"]);
	assertAdditionalProperty(decodeReviewNextTransitionV3, transitionSource);

	const artifactSubjectSource = (((fixture<JsonObject>("start.fixture.json").artifact_subjects) as JsonObject[])[0]);
	assertRequired(decodeReviewArtifactSubjectV2, artifactSubjectSource, ["schema", "subject_hash", "lineage_id", "authority_revision", "target_identity", "base_tree", "candidate_tree", "changed_path_manifest_sha256", "lens", "selected_order"]);
	assertAdditionalProperty(decodeReviewArtifactSubjectV2, artifactSubjectSource);
});

function repairAssessment(status: "eligible" | "unsupported" = "unsupported"): JsonObject {
	if (status === "unsupported") {
		return {
			schema: "gentle-ai.review-authority-repair-assessment/v1",
			status: "unsupported",
			counts: { lineages: 0, compact_lineages: 0, legacy_lineages: 0, events: 0, bytes: 0, eligible_candidates: 0, unsupported_lineages: 0, conflicts: 0 },
			supported_operations: ["review/complete-fix", "review/validate-fix"],
			authorization_schema: "gentle-ai.review-repair-authorization/v1",
		};
	}
	return {
		schema: "gentle-ai.review-authority-repair-assessment/v1",
		status: "eligible",
		class: "legacy_v1_historical_alias",
		cause: "unsupported_historical_v1_operation_alias",
		disposition: "quarantine-approved-historical-alias",
		repository_binding: digest,
		candidate: {
			lineage_id: "review-legacy-fixture",
			revision: digest,
			chain_identity: digest,
			event_count: 3,
			alias_event_count: 1,
			operations: ["review/complete-fix"],
		},
		counts: { lineages: 1, compact_lineages: 0, legacy_lineages: 1, events: 3, bytes: 128, eligible_candidates: 1, unsupported_lineages: 0, conflicts: 0 },
		supported_operations: ["review/complete-fix", "review/validate-fix"],
		authorization_schema: "gentle-ai.review-repair-authorization/v1",
	};
}

test("authority repair assessment decodes eligible and unsupported statuses", () => {
	assert.equal(decodeAuthorityRepairAssessmentV1(repairAssessment("unsupported")).status, "unsupported");
	assert.equal(decodeAuthorityRepairAssessmentV1(repairAssessment("eligible")).status, "eligible");
	const missingClass = repairAssessment("eligible");
	delete missingClass.class;
	assert.throws(() => decodeAuthorityRepairAssessmentV1(missingClass), /requires class/);
});

test("repair execute-without-execution is rejected", () => {
	const executeMissingExecution: JsonObject = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode: "execute",
		assessment: repairAssessment("unsupported"),
		required_inputs: [],
	};
	assert.throws(() => decodeReviewRepairV2(executeMissingExecution), /execution/);
});

test("capabilities enforce the exact mandatory feature set while accepting a superset of advertised operations", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode = (value: unknown) => decodeReviewCapabilitiesV2(value, executableDigest);
	const decoded = decode(source) as { mandatoryFeatures: ReadonlySet<string>; operations: ReadonlySet<string> };
	assert.equal(decoded.mandatoryFeatures.has("compact_v2_authority"), true);
	assert.equal(decoded.operations.has("review.repair"), true);

	const extraMandatory = clone(source);
	((extraMandatory.features as JsonObject).mandatory as JsonObject[]).push({ name: "risk_reasons", supported: true, requires: [] });
	assert.throws(() => decode(extraMandatory), /mandatory/);

	// operations is a superset promise: an extra advertised operation beyond the
	// required set must not be rejected.
	const extraOperation = clone(source);
	(extraOperation.operations as string[]).push("review.future_operation");
	assert.doesNotThrow(() => decode(extraOperation));
});

test("START independently binds base/candidate tree and the target-mode overlay pair", () => {
	const source = fixture<JsonObject>("start.fixture.json");
	const decoded = decodeReviewStartV3(source);
	assert.equal(decoded.baseTree, source.base_tree);
	assert.equal(decoded.candidateTree, source.candidate_tree);
	assert.equal(decoded.targetMode, undefined, "the fixture never sets target_mode");

	const partialOverlay = clone(source);
	delete partialOverlay.target_identity;
	(partialOverlay as JsonObject).target_mode = "base-workspace-overlay";
	assert.throws(() => decodeReviewStartV3(partialOverlay), /target_mode.*target_identity|together/);

	const droppedManifest = clone(source);
	delete droppedManifest.changed_path_manifest;
	assert.throws(() => decodeReviewStartV3(droppedManifest), /selected_lenses|changed_path_manifest/);

	const manifestWithoutTrees = clone(source);
	delete manifestWithoutTrees.base_tree;
	delete manifestWithoutTrees.candidate_tree;
	delete manifestWithoutTrees.selected_lenses;
	(manifestWithoutTrees as JsonObject).selected_lenses = [];
	assert.throws(() => decodeReviewStartV3(manifestWithoutTrees), /changed_path_manifest/);
});

test("status enforces authority/frozen/receipt conditionals and decodes the required repair field", () => {
	const current = fixture<JsonObject>("status.fixture.json");
	const decoded = decodeReviewStatusV3(current);
	assert.equal(decoded.repair.status, "unsupported");
	assert.equal(decoded.repair.counts.eligibleCandidates, 0);

	const missingAuthority = clone(current);
	delete missingAuthority.authority;
	assert.throws(() => decodeReviewStatusV3(missingAuthority), /requires authority/);

	const compactMissingFrozen = clone(current);
	delete compactMissingFrozen.frozen;
	assert.throws(() => decodeReviewStatusV3(compactMissingFrozen), /requires frozen/);

	const legacyWithFrozen = clone(current);
	(legacyWithFrozen.authority as JsonObject).version = "legacy-v1";
	(legacyWithFrozen.receipt as JsonObject).status = "expected_missing";
	assert.throws(() => decodeReviewStatusV3(legacyWithFrozen), /legacy status cannot expose frozen/);
});

test("status validation_request and retry_final_verification require their exact authority preconditions", () => {
	const current = fixture<JsonObject>("status.fixture.json");
	const withValidationRequest = clone(current);
	withValidationRequest.validation_request = {
		schema: "gentle-ai.review-targeted-validation-request/v1",
		request_hash: digest,
		lineage_id: "review-status-fixture",
		expected_revision: digest,
		target_identity: (current.target_identity as string),
		fix_finding_ids: ["finding-1"],
		projection: "workspace",
		correction_candidate_tree: "a".repeat(40),
		correction_target_identity: digest,
		correction_paths: ["tracked.txt"],
		correction_paths_digest: digest,
	};
	// authority.state is "reviewing" in the fixture, not correction_required.
	assert.throws(() => decodeReviewStatusV3(withValidationRequest), /correction_required/);

	const retryWithoutIncident = clone(current);
	retryWithoutIncident.action = "retry_final_verification";
	retryWithoutIncident.action_disposition = "final_verification_retry";
	(retryWithoutIncident.authority as JsonObject).state = "escalated";
	assert.throws(() => decodeReviewStatusV3(retryWithoutIncident), /requires final_verification_retry/);
});

test("operation envelopes decode validate, bind_sdd, and retry_final_verification result variants", () => {
	const validateEnvelope: JsonObject = {
		schema: "gentle-ai.review-integration.operation/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.validate",
		result: { schema: "gentle-ai.review-gate-result/v1", result: "allow", allowed: true, action: "publish", reason: "receipt matches", context: { gate: "pre-pr" } },
	};
	assert.equal(decodeReviewOperationV2(validateEnvelope).operation, "review.validate");

	const bindSddEnvelope: JsonObject = {
		schema: "gentle-ai.review-integration.operation/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.bind_sdd",
		result: { schema: "gentle-ai.sdd-review-binding/v1", revision: digest, change: "migrate-review-integration-v2", lineage: "review-fixture", authority_revision: digest, receipt_hash: digest, gate_context: { gate: "post-apply" } },
	};
	assert.equal(decodeReviewOperationV2(bindSddEnvelope).operation, "review.bind_sdd");

	const retryEnvelope: JsonObject = {
		schema: "gentle-ai.review-integration.operation/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.retry_final_verification",
		result: {
			operation: "review.retry_final_verification",
			predecessor_lineage_id: "review-predecessor",
			predecessor_revision: digest,
			lineage_id: "review-successor",
			state: "validating",
			store_revision: digest,
			target_identity: digest,
			incident_digest: digest,
			recovery_disposition: "final_verification_retry",
		},
	};
	assert.equal(decodeReviewOperationV2(retryEnvelope).operation, "review.retry_final_verification");

	const crossedResult = clone(validateEnvelope);
	crossedResult.result = bindSddEnvelope.result;
	assert.throws(() => decodeReviewOperationV2(crossedResult), /does not match|not allowed|required/);
});

test("failure context accepts scope_change or binding_revision but rejects both or neither", () => {
	const base: JsonObject = {
		schema: "gentle-ai.review-integration.failure/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.finalize",
		phase: "pre_native",
		code: "gate_scope_changed",
		message: "the target scope changed since START",
		mutation_outcome: "not_started",
		authority_applicability: "current_target",
		retry_safe: true,
		replayability: "manual_action_required",
		required_inputs: ["predecessor_lineage_id", "expected_predecessor_revision", "successor_lineage_id", "disposition", "reason", "actor"],
		next_action: "explicit-maintainer-action",
		context: {
			binding_revision: { expected: digest, current: "" },
		},
	};
	const decoded = decodeReviewFailureV2(base);
	assert.equal(decoded.context?.bindingRevision?.current, "");

	const neither = clone(base);
	neither.context = {};
	assert.throws(() => decodeReviewFailureV2(neither), /exactly one/);

	const both = clone(base);
	both.context = { binding_revision: { expected: digest, current: digest }, scope_change: (both.context as JsonObject) };
	assert.throws(() => decodeReviewFailureV2(both), /exactly one|not allowed/);
});

test("consent rejects a swapped choice order and an invocation missing the exact answer suffix", () => {
	const source = fixture<JsonObject>("consent.fixture.json");
	const swapped = clone(source);
	swapped.choices = [(source.choices as JsonObject[])[1], (source.choices as JsonObject[])[0]];
	assert.throws(() => decodeReviewConsentV2(swapped), /answer/);

	const badInvocation = clone(source);
	(badInvocation.choices as JsonObject[])[0].invocation = "gentle-ai review start --contract gentle-ai.review-integration/v1 --consent granted";
	assert.throws(() => decodeReviewConsentV2(badInvocation), /invocation/);
});

test("next_transition decodes an execute variant and rejects a stop that carries a transition", () => {
	const execute: JsonObject = {
		kind: "execute",
		reason_code: "fresh_target_ready",
		execute: {
			operation: "review.start",
			arguments: [{ name: "lineage", value: "review-fixture", token: "--lineage=review-fixture" }],
			preconditions: [{ name: "clean", value: "true" }],
			binding: { target_identity: digest },
		},
	};
	const decoded = decodeReviewNextTransitionV3(execute);
	assert.equal(decoded.execute?.operation, "review.start");
	assert.equal(decoded.execute?.arguments[0]?.token, "--lineage=review-fixture");

	const stopWithExecute = clone(execute);
	stopWithExecute.kind = "stop";
	assert.throws(() => decodeReviewNextTransitionV3(stopWithExecute), /stop cannot carry/);
});

test("repair decodes a committed execute result and rejects a non-eligible preflight carrying provider_inputs", () => {
	const executed: JsonObject = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode: "execute",
		assessment: repairAssessment("eligible"),
		required_inputs: [],
		execution: {
			status: "committed",
			class: "legacy_v1_historical_alias",
			lineage_id: "review-legacy-fixture",
			revision: digest,
			chain_identity: digest,
			cause: "unsupported_historical_v1_operation_alias",
			disposition: "quarantine-approved-historical-alias",
			assessment_digest: digest,
			request_digest: digest,
			record_identity: digest,
		},
	};
	assert.equal(decodeReviewRepairV2(executed).execution?.status, "committed");

	const nonEligibleWithInputs: JsonObject = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode: "preflight",
		assessment: repairAssessment("unsupported"),
		provider_inputs: {
			class: "legacy_v1_historical_alias",
			lineage_id: "review-legacy-fixture",
			expected_revision: digest,
			cause: "unsupported_historical_v1_operation_alias",
			disposition: "quarantine-approved-historical-alias",
			repository_binding: digest,
			authorization_schema: "gentle-ai.review-repair-authorization/v1",
		},
		required_inputs: [],
	};
	assert.throws(() => decodeReviewRepairV2(nonEligibleWithInputs), /provider_inputs is only valid/);
});

test("artifact-subject accepts an optional correction_target_identity", () => {
	const source = ((fixture<JsonObject>("start.fixture.json").artifact_subjects) as JsonObject[])[0];
	const withCorrection = clone(source);
	withCorrection.correction_target_identity = digest;
	const decoded = decodeReviewArtifactSubjectV2(withCorrection);
	assert.equal(decoded.correctionTargetIdentity, digest);
	assert.equal(decodeReviewArtifactSubjectV2(source).correctionTargetIdentity, undefined);
});

test("repair eligible preflight with wrong required_inputs order is rejected", () => {
	const wrongOrder: JsonObject = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode: "preflight",
		assessment: repairAssessment("eligible"),
		provider_inputs: {
			class: "legacy_v1_historical_alias",
			lineage_id: "review-legacy-fixture",
			expected_revision: digest,
			cause: "unsupported_historical_v1_operation_alias",
			disposition: "quarantine-approved-historical-alias",
			repository_binding: digest,
			authorization_schema: "gentle-ai.review-repair-authorization/v1",
		},
		required_inputs: ["reason", "actor", "maintainer_authorization"],
	};
	assert.throws(() => decodeReviewRepairV2(wrongOrder), /required_inputs/);
});

// Three decode defects the after-bench found by driving the real v2.2.2 binary.
// Every native call exited 0 and authority advanced; Pi threw locally on the
// RESPONSE. The mirrored fixture never caught them because it only exercises
// the `collect` transition kind, so no `execute` payload was ever decoded.
//
// The authority here is contracts/review-integration/v1/schemas/status-v2.schema.json
// $defs.transition_execution, which declares optional `command`,
// `selector_arguments`, and `artifacts`, and a `binding` with NO declared
// properties and no required list -- an OPEN object. Pi had closed execute to
// `command` alone and binding to three keys, making it stricter than the
// contract it implements.

test("next_transition.execute accepts the optional selector_arguments and artifacts the schema declares", () => {
	const base = {
		kind: "execute" as const,
		reason_code: "captured_results_ready",
		execute: {
			operation: "review.finalize",
			command: "gentle-ai review finalize --lineage=review-96f29cbd865e77a9 --captured-results=true",
			arguments: [{ name: "lineage", value: "review-96f29cbd865e77a9", token: "--lineage=review-96f29cbd865e77a9" }],
			preconditions: [{ name: "target_identity", value: "sha256:" + "9".repeat(64) }],
			binding: { target_identity: "sha256:" + "9".repeat(64) },
		},
	};

	assert.doesNotThrow(() => decodeReviewNextTransitionV3(base));
	assert.doesNotThrow(() => decodeReviewNextTransitionV3({ ...base, execute: { ...base.execute, artifacts: [{ name: "receipt", path: "review-receipt.json" }] } }));
	assert.doesNotThrow(() => decodeReviewNextTransitionV3({ ...base, execute: { ...base.execute, selector_arguments: [{ name: "projection", value: "workspace", token: "--projection=workspace" }] } }));
});

test("next_transition.execute.binding stays open, as its schema declares no properties", () => {
	const withContext = {
		kind: "execute" as const,
		reason_code: "approved_receipt_ready",
		execute: {
			operation: "review.validate",
			arguments: [{ name: "gate", value: "pre-commit", token: "--gate=pre-commit" }],
			preconditions: [{ name: "target_identity", value: "sha256:" + "8".repeat(64) }],
			// The provider sends this. The schema constrains nothing here, so Pi
			// closing the object was stricter than the contract.
			binding: { target_identity: "sha256:" + "8".repeat(64), repository_context: "rctx1_" + "c".repeat(64) },
		},
	};

	assert.doesNotThrow(() => decodeReviewNextTransitionV3(withContext));
});
