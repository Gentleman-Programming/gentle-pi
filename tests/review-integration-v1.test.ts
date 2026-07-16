import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	REVIEW_INTEGRATION_CONTRACT,
	REVIEW_START_STATE,
	decodeReviewCapabilitiesV1,
	decodeReviewFailureV1,
	decodeReviewOperationV1,
	decodeReviewProjectionV1,
	decodeReviewStartV1,
	decodeReviewStatusV1,
} from "../lib/review-integration-v1.ts";

const fixtureRoot = join(process.cwd(), "contracts", "review-integration", "v1", "fixtures");
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

function finalizeEnvelope(): JsonObject {
	return fixture<JsonObject>("operation.fixture.json");
}

function validateEnvelope(): JsonObject {
	return {
		schema: "gentle-ai.review-integration.operation/v1",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.validate",
		result: {
			schema: "gentle-ai.review-gate-result/v1",
			result: "allow",
			allowed: true,
			action: "publish",
			reason: "receipt matches",
			context: { gate: "pre-pr" },
		},
	};
}

function bindEnvelope(): JsonObject {
	return {
		schema: "gentle-ai.review-integration.operation/v1",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.bind_sdd",
		result: {
			schema: "gentle-ai.sdd-review-binding/v1",
			revision: digest,
			change: "review-integration-v1",
			lineage: "review-fixture",
			authority_revision: digest,
			receipt_hash: digest,
			gate_context: { gate: "post-apply" },
		},
	};
}

test("every published review integration fixture decodes", () => {
	assert.equal(decodeReviewCapabilitiesV1(fixture("capabilities.fixture.json"), executableDigest).contract, REVIEW_INTEGRATION_CONTRACT);
	assert.equal(decodeReviewStartV1(fixture("start.fixture.json")).riskLevel, "high");
	assert.equal(decodeReviewFailureV1(fixture("failure.fixture.json")).mutationOutcome, "committed");
	assert.equal(decodeReviewOperationV1(fixture("operation.fixture.json")).operation, "review.finalize");
	for (const name of ["status.fixture.json", "status-unrelated.fixture.json", "status-ambiguous.fixture.json", "status-corrupted.fixture.json"]) {
		assert.equal(decodeReviewStatusV1(fixture(name)).contract, REVIEW_INTEGRATION_CONTRACT);
	}
});

test("capabilities enforce every required top-level and nested property", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode: Decoder = (value) => decodeReviewCapabilitiesV1(value, executableDigest);
	assertRequired(decode, source, ["schema", "contract", "protocol", "package", "build", "executable", "operations", "gates", "projections", "schemas", "features", "compatibility"]);
	assertNestedRequired(decode, source, ["protocol"], ["major", "minor"]);
	assertNestedRequired(decode, source, ["package"], ["name", "version", "release_channel"]);
	assertNestedRequired(decode, source, ["build"], ["id", "go_version", "module_version", "vcs", "vcs_revision", "vcs_time", "vcs_modified"]);
	assertNestedRequired(decode, source, ["executable"], ["sha256", "evidence", "verification"]);
	assertNestedRequired(decode, source, ["features"], ["mandatory", "optional"]);
	assertNestedRequired(decode, source, ["features", "mandatory", "0"], ["name", "supported", "requires"]);
	assertNestedRequired(decode, source, ["compatibility"], ["minimum_protocol_major", "maximum_protocol_major", "additive_minor_policy", "unknown_mandatory", "unknown_optional", "modes", "legacy_window"]);
	assertNestedRequired(decode, source, ["compatibility", "legacy_window"], ["mode", "state", "read_only", "deprecation_started", "removal", "minimum_compatibility_releases"]);
});

test("capabilities reject additional properties at every exact object boundary", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode: Decoder = (value) => decodeReviewCapabilitiesV1(value, executableDigest);
	for (const path of [[], ["protocol"], ["package"], ["build"], ["executable"], ["features"], ["features", "mandatory", "0"], ["features", "optional", "0"], ["compatibility"], ["compatibility", "legacy_window"]] as const) {
		assertAdditionalProperty(decode, source, path);
	}
});

test("capabilities accept additive minor optional fields while rejecting unknown mandatory behavior", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	(source.protocol as JsonObject).minor = 1;
	source.future_diagnostics = { enabled: true };
	(source.package as JsonObject).future_channel_metadata = "additive";
	(((source.features as JsonObject).optional as JsonObject[])).push({
		name: "future_optional_diagnostics",
		supported: true,
		requires: [],
		future_detail: "ignored",
	});
	const decoded = decodeReviewCapabilitiesV1(source, executableDigest);
	assert.equal(decoded.optionalFeatures.has("risk_reasons"), true);
	assert.equal((decoded.optionalFeatures as ReadonlySet<string>).has("future_optional_diagnostics"), false);

	const unknownMandatory = clone(source);
	((unknownMandatory.features as JsonObject).mandatory as JsonObject[]).push({ name: "future_required_authority", supported: true, requires: [] });
	assert.throws(() => decodeReviewCapabilitiesV1(unknownMandatory, executableDigest), /unsupported/);

	const incompatibleMajor = clone(source);
	(incompatibleMajor.protocol as JsonObject).major = 2;
	assert.throws(() => decodeReviewCapabilitiesV1(incompatibleMajor, executableDigest), /incompatible/);

	const negativeMinor = clone(source);
	(negativeMinor.protocol as JsonObject).minor = -1;
	assert.throws(() => decodeReviewCapabilitiesV1(negativeMinor, executableDigest), /integer in range/);

	const duplicateOptional = clone(source);
	((duplicateOptional.features as JsonObject).optional as JsonObject[]).push({ name: "future_optional_diagnostics", supported: false, requires: [] });
	assert.throws(() => decodeReviewCapabilitiesV1(duplicateOptional, executableDigest), /duplicate/);

	const overlappingFeature = clone(source);
	((overlappingFeature.features as JsonObject).optional as JsonObject[]).push({ name: "compact_v2_authority", supported: true, requires: [] });
	assert.throws(() => decodeReviewCapabilitiesV1(overlappingFeature, executableDigest), /overlap/);
});

test("capabilities enforce exact v1.0 arrays, enums, patterns, and digest binding", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode = (value: unknown) => decodeReviewCapabilitiesV1(value, executableDigest);

	const optionalDrift = clone(source);
	(optionalDrift.features as { optional: unknown[] }).optional.push({ name: "risk_reasons", supported: true, requires: [] });
	assert.throws(() => decode(optionalDrift), /invalid length/);

	for (const field of ["operations", "gates", "projections", "schemas"] as const) {
		const duplicate = clone(source);
		const values = duplicate[field] as unknown[];
		values[values.length - 1] = values[0];
		assert.throws(() => decode(duplicate), /duplicates|required integration surface/, field);
	}

	for (const [path, invalid] of [
		[["package", "release_channel"], "nightly"],
		[["build", "vcs_modified"], "dirty"],
		[["compatibility", "legacy_window", "state"], "removed"],
		[["features", "optional", "0", "name"], "future_optional_diagnostics"],
	] as const) {
		const candidate = clone(source);
		let target = candidate;
		for (const segment of path.slice(0, -1)) target = target[segment] as JsonObject;
		target[path.at(-1)!] = invalid;
		assert.throws(() => decode(candidate));
	}

	const badRequires = clone(source);
	((badRequires.features as JsonObject).optional as JsonObject[])[0].requires = ["same", "same"];
	assert.throws(() => decode(badRequires), /duplicates/);
	const emptyGo = clone(source);
	(emptyGo.build as JsonObject).go_version = "";
	assert.throws(() => decode(emptyGo));
	const badMinimum = clone(source);
	((badMinimum.compatibility as JsonObject).legacy_window as JsonObject).minimum_compatibility_releases = 0;
	assert.throws(() => decode(badMinimum));
	const reversedModes = clone(source);
	(reversedModes.compatibility as JsonObject).modes = ["legacy-v1", "compact-v2"];
	assert.throws(() => decode(reversedModes), /out of order/);
	assert.throws(() => decodeReviewCapabilitiesV1(source, "0".repeat(64)), /executable digest mismatch/);
});

test("START accepts every normative enum value and rejects aliases", () => {
	const source = fixture<JsonObject>("start.fixture.json");
	for (const state of Object.values(REVIEW_START_STATE)) {
		const candidate = clone(source);
		candidate.state = state;
		assert.equal(decodeReviewStartV1(candidate).state, state);
	}
	for (const action of ["created", "resumed", "reuse-receipt", "blocked-scope-action"]) {
		const candidate = clone(source);
		candidate.action = action;
		assert.equal(decodeReviewStartV1(candidate).action, action);
	}
	for (const riskLevel of ["low", "medium", "high"]) {
		const candidate = clone(source);
		candidate.risk_level = riskLevel;
		assert.equal(decodeReviewStartV1(candidate).riskLevel, riskLevel);
	}
	for (const projection of ["workspace", "staged"]) {
		const candidate = clone(source);
		candidate.projection = projection;
		assert.equal(decodeReviewStartV1(candidate).projection, projection);
	}
	for (const invalid of ["correction_required", "validating", "clean"]) {
		const candidate = clone(source);
		candidate.state = invalid;
		assert.throws(() => decodeReviewStartV1(candidate), /state/);
	}
});

test("START enforces required, exact, bounded, and deeply unique payloads", () => {
	const source = fixture<JsonObject>("start.fixture.json");
	assertRequired(decodeReviewStartV1, source, ["schema", "contract", "operation", "action", "lenses_required", "lineage_id", "state", "risk_level", "selected_lenses", "projection", "changed_files", "changed_lines", "correction_budget", "risk_reasons"]);
	assertAdditionalProperty(decodeReviewStartV1, source);
	assertAdditionalProperty(decodeReviewStartV1, source, ["risk_reasons", "0"]);
	assertNestedRequired(decodeReviewStartV1, source, ["risk_reasons", "0"], ["code"]);

	for (const code of ["configuration_change", "executable_change", "executable_mode", "hot_path", "large_change", "non_executable_only", "service_token", "shell_source"]) {
		const candidate = clone(source);
		candidate.risk_reasons = [{ code }];
		assert.equal(decodeReviewStartV1(candidate).riskReasons[0]?.code, code);
	}
	for (const signal of ["auth", "update", "security", "payments", "permissions", "shell_process"]) {
		const candidate = clone(source);
		candidate.risk_reasons = [{ code: "hot_path", signal }];
		assert.equal(decodeReviewStartV1(candidate).riskReasons[0]?.signal, signal);
	}

	for (const [field, value] of [["changed_files", -1], ["changed_lines", 1.5], ["correction_budget", 201]] as const) {
		const candidate = clone(source);
		candidate[field] = value;
		assert.throws(() => decodeReviewStartV1(candidate), /range/);
	}
	const tooManyLenses = clone(source);
	tooManyLenses.selected_lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability", "review-risk"];
	assert.throws(() => decodeReviewStartV1(tooManyLenses), /invalid length/);
	const unknownLens = clone(source);
	unknownLens.selected_lenses = ["review-security"];
	assert.throws(() => decodeReviewStartV1(unknownLens), /selected_lenses/);
	const emptyReasons = clone(source);
	emptyReasons.risk_reasons = [];
	assert.throws(() => decodeReviewStartV1(emptyReasons), /invalid length/);
	const duplicateReasons = clone(source);
	duplicateReasons.risk_reasons = [{ code: "hot_path", signal: "auth" }, { signal: "auth", code: "hot_path" }];
	assert.throws(() => decodeReviewStartV1(duplicateReasons), /duplicates/);
	for (const mode of ["100644", "10064", "100648"]) {
		const candidate = clone(source);
		candidate.risk_reasons = [{ code: "executable_mode", old_mode: mode }];
		if (mode === "100644") assert.doesNotThrow(() => decodeReviewStartV1(candidate));
		else assert.throws(() => decodeReviewStartV1(candidate));
	}
});

test("projection enforces every kind, Git identity, digest, and safe path boundary", () => {
	const source = (fixture<JsonObject>("status.fixture.json").projection as JsonObject);
	for (const kind of ["current-changes", "base-diff", "exact-revision", "fix-diff"]) {
		const candidate = clone(source);
		candidate.kind = kind;
		assert.equal(decodeReviewProjectionV1(candidate).kind, kind);
	}
	assertRequired(decodeReviewProjectionV1, source, ["schema", "kind", "projection", "base_tree", "initial_review_tree", "current_candidate_tree", "paths_digest", "paths", "intended_untracked", "intended_untracked_proof", "initial_snapshot_identity", "current_snapshot_identity"]);
	assertAdditionalProperty(decodeReviewProjectionV1, source);

	for (const tree of ["a".repeat(40), "b".repeat(64)]) {
		const candidate = clone(source);
		candidate.base_tree = tree;
		assert.equal(decodeReviewProjectionV1(candidate).baseTree, tree);
	}
	for (const tree of ["a".repeat(39), "A".repeat(40), `sha256:${"a".repeat(64)}`]) {
		const candidate = clone(source);
		candidate.base_tree = tree;
		assert.throws(() => decodeReviewProjectionV1(candidate), /base_tree/);
	}
	for (const path of ["/absolute", "../escape", "safe/../escape", "safe/.."] ) {
		const candidate = clone(source);
		candidate.paths = [path];
		assert.throws(() => decodeReviewProjectionV1(candidate), /paths/);
	}
	const duplicatePaths = clone(source);
	duplicatePaths.paths = ["same", "same"];
	assert.throws(() => decodeReviewProjectionV1(duplicatePaths), /duplicates/);
	const badDigest = clone(source);
	badDigest.paths_digest = `sha256:${"A".repeat(64)}`;
	assert.throws(() => decodeReviewProjectionV1(badDigest), /paths_digest/);
});

test("status enforces required and additionalProperties at every exact boundary", () => {
	const source = fixture<JsonObject>("status.fixture.json");
	assertRequired(decodeReviewStatusV1, source, ["schema", "contract", "operation", "applicability", "receipt", "action", "replayability", "target_identity", "projection", "candidates"]);
	assertNestedRequired(decodeReviewStatusV1, source, ["authority"], ["version", "lineage_id", "state", "generation", "revision"]);
	assertNestedRequired(decodeReviewStatusV1, source, ["receipt"], ["status"]);
	assertNestedRequired(decodeReviewStatusV1, source, ["frozen"], ["tier", "original_changed_lines", "correction_budget"]);
	for (const path of [[], ["authority"], ["receipt"], ["frozen"], ["projection"]] as const) assertAdditionalProperty(decodeReviewStatusV1, source, path);
});

test("status enforces applicability, authority version, receipt, and frozen conditionals", () => {
	const current = fixture<JsonObject>("status.fixture.json");
	for (const name of ["status-unrelated.fixture.json", "status-ambiguous.fixture.json", "status-corrupted.fixture.json"]) assert.doesNotThrow(() => decodeReviewStatusV1(fixture(name)));
	const missingAuthority = clone(current);
	delete missingAuthority.authority;
	assert.throws(() => decodeReviewStatusV1(missingAuthority), /requires authority/);
	const nonCurrentAuthority = fixture<JsonObject>("status-unrelated.fixture.json");
	nonCurrentAuthority.authority = clone(current.authority);
	assert.throws(() => decodeReviewStatusV1(nonCurrentAuthority), /cannot expose authority/);
	const compactMissingFrozen = clone(current);
	delete compactMissingFrozen.frozen;
	assert.throws(() => decodeReviewStatusV1(compactMissingFrozen), /requires frozen/);
	const legacy = clone(current);
	(legacy.authority as JsonObject).version = "legacy-v1";
	delete legacy.frozen;
	assert.doesNotThrow(() => decodeReviewStatusV1(legacy));
	(legacy.receipt as JsonObject).status = "publication_pending";
	assert.throws(() => decodeReviewStatusV1(legacy), /legacy status receipt/);

	const badLineage = clone(current);
	(badLineage.authority as JsonObject).lineage_id = "Review_Bad";
	assert.throws(() => decodeReviewStatusV1(badLineage), /lineage_id/);
	const badGeneration = clone(current);
	(badGeneration.authority as JsonObject).generation = 0;
	assert.throws(() => decodeReviewStatusV1(badGeneration), /range/);
	const badBudget = clone(current);
	(badBudget.frozen as JsonObject).correction_budget = 201;
	assert.throws(() => decodeReviewStatusV1(badBudget), /range/);
	const badCandidate = clone(current);
	badCandidate.candidates = ["review-a", "review-a"];
	assert.throws(() => decodeReviewStatusV1(badCandidate), /duplicates/);
});

test("failure enforces exact keys, enums, identifiers, message bounds, and required-input uniqueness", () => {
	const source = fixture<JsonObject>("failure.fixture.json");
	assertRequired(decodeReviewFailureV1, source, ["schema", "contract", "operation", "phase", "code", "message", "mutation_outcome", "authority_applicability", "retry_safe", "replayability", "required_inputs", "next_action"]);
	assertAdditionalProperty(decodeReviewFailureV1, source);
	for (const [field, value] of [
		["code", "Bad-Code"],
		["message", "line one\nline two"],
		["message", "x".repeat(241)],
		["lineage_id", "Review_Bad"],
		["request_digest", `sha256:${"A".repeat(64)}`],
		["mutation_outcome", "not_committed"],
		["authority_applicability", "clean"],
		["next_action", "replay"],
	] as const) {
		const candidate = clone(source);
		candidate[field] = value;
		assert.throws(() => decodeReviewFailureV1(candidate), new RegExp(field));
	}
	const duplicateInputs = clone(source);
	duplicateInputs.required_inputs = ["lineage_id", "lineage_id"];
	assert.throws(() => decodeReviewFailureV1(duplicateInputs), /duplicates/);
	const unknownInput = clone(source);
	unknownInput.required_inputs = ["cwd"];
	assert.throws(() => decodeReviewFailureV1(unknownInput), /required_inputs/);
});

test("operation envelopes strictly bind the outer operation to one exact result variant", () => {
	const envelopes = [finalizeEnvelope(), validateEnvelope(), bindEnvelope()];
	for (const envelope of envelopes) {
		assert.equal(decodeReviewOperationV1(envelope).operation, envelope.operation);
		assertAdditionalProperty(decodeReviewOperationV1, envelope);
		assertAdditionalProperty(decodeReviewOperationV1, envelope, ["result"]);
	}
	assertRequired(decodeReviewOperationV1, finalizeEnvelope(), ["schema", "contract", "operation", "result"]);
	assertNestedRequired(decodeReviewOperationV1, finalizeEnvelope(), ["result"], ["operation", "lineage_id", "state", "action", "store_revision"]);
	assertNestedRequired(decodeReviewOperationV1, validateEnvelope(), ["result"], ["schema", "result", "allowed", "action", "reason", "context"]);
	assertNestedRequired(decodeReviewOperationV1, bindEnvelope(), ["result"], ["schema", "revision", "change", "lineage", "authority_revision", "receipt_hash", "gate_context"]);

	for (const [operation, result] of [
		["review.finalize", validateEnvelope().result],
		["review.validate", bindEnvelope().result],
		["review.bind_sdd", finalizeEnvelope().result],
	] as const) {
		const candidate = finalizeEnvelope();
		candidate.operation = operation;
		candidate.result = result;
		assert.throws(() => decodeReviewOperationV1(candidate), /does not match|not allowed|required/);
	}
});
