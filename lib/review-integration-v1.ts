export const REVIEW_INTEGRATION_CONTRACT = "gentle-ai.review-integration/v1";

export const REVIEW_INTEGRATION_OPERATION = {
	BIND_SDD: "review.bind_sdd",
	CAPABILITIES: "review.capabilities",
	FINALIZE: "review.finalize",
	START: "review.start",
	STATUS: "review.status",
	VALIDATE: "review.validate",
} as const;
export type ReviewIntegrationOperation = (typeof REVIEW_INTEGRATION_OPERATION)[keyof typeof REVIEW_INTEGRATION_OPERATION];

export const REVIEW_AUTHORITY_APPLICABILITY = {
	CURRENT_TARGET: "current_target",
	UNRELATED: "unrelated",
	AMBIGUOUS: "ambiguous",
	CORRUPTED: "corrupted",
	NOT_EVALUATED: "not_evaluated",
} as const;
export type ReviewAuthorityApplicability = (typeof REVIEW_AUTHORITY_APPLICABILITY)[keyof typeof REVIEW_AUTHORITY_APPLICABILITY];

export const REVIEW_REPLAYABILITY = {
	NOT_REPLAYABLE: "not_replayable",
	EXACT_REPLAY_SAFE: "exact_replay_safe",
	STATUS_REQUIRED: "status_required",
	MANUAL_ACTION_REQUIRED: "manual_action_required",
} as const;
export type ReviewReplayability = (typeof REVIEW_REPLAYABILITY)[keyof typeof REVIEW_REPLAYABILITY];

export const REVIEW_MUTATION_OUTCOME = {
	NOT_STARTED: "not_started",
	UNKNOWN: "unknown",
	COMMITTED: "committed",
} as const;
export type ReviewMutationOutcome = (typeof REVIEW_MUTATION_OUTCOME)[keyof typeof REVIEW_MUTATION_OUTCOME];

export const REVIEW_PROJECTION = {
	STAGED: "staged",
	WORKSPACE: "workspace",
} as const;
export type ReviewProjection = (typeof REVIEW_PROJECTION)[keyof typeof REVIEW_PROJECTION];

export const REVIEW_PROJECTION_KIND = {
	CURRENT_CHANGES: "current-changes",
	BASE_DIFF: "base-diff",
	BASE_WORKSPACE_OVERLAY: "base-workspace-overlay",
	EXACT_REVISION: "exact-revision",
	FIX_DIFF: "fix-diff",
} as const;
export type ReviewProjectionKind = (typeof REVIEW_PROJECTION_KIND)[keyof typeof REVIEW_PROJECTION_KIND];

export const REVIEW_AUTHORITY_VERSION = {
	COMPACT_V2: "compact-v2",
	LEGACY_V1: "legacy-v1",
} as const;
export type ReviewAuthorityVersion = (typeof REVIEW_AUTHORITY_VERSION)[keyof typeof REVIEW_AUTHORITY_VERSION];

export const REVIEW_START_STATE = {
	UNREVIEWED: "unreviewed",
	REVIEWING: "reviewing",
	JUDGES_CONFIRMED: "judges_confirmed",
	FINDINGS_FROZEN: "findings_frozen",
	EVIDENCE_CLASSIFIED: "evidence_classified",
	FIX_REQUIRED: "fix_required",
	FIXING: "fixing",
	FIX_VALIDATING: "fix_validating",
	READY_FINAL_VERIFICATION: "ready_final_verification",
	FINAL_VERIFYING: "final_verifying",
	APPROVED: "approved",
	ESCALATED: "escalated",
	INVALIDATED: "invalidated",
} as const;
export type ReviewStartState = (typeof REVIEW_START_STATE)[keyof typeof REVIEW_START_STATE];

const START_ACTIONS = ["created", "resumed", "reuse-receipt", "blocked-scope-action"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
const REVIEW_LENSES = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
const RISK_REASON_CODES = ["configuration_change", "executable_change", "executable_mode", "hot_path", "large_change", "non_executable_only", "service_token", "shell_source"] as const;
const RISK_SIGNALS = ["auth", "update", "security", "payments", "permissions", "shell_process"] as const;
const STATUS_ACTIONS = ["start", "finalize", "validate", "recover", "maintainer_action", "select_lineage", "repair_authority", "reconcile_finalize", "stop"] as const;
const RECEIPT_STATUSES = ["expected_missing", "present", "publication_pending", "not_applicable"] as const;
const REQUIRED_OPERATIONS = Object.freeze(Object.values(REVIEW_INTEGRATION_OPERATION));
const REQUIRED_GATES = Object.freeze(["post-apply", "pre-commit", "pre-push", "pre-pr", "release"] as const);
const REQUIRED_PROJECTIONS = Object.freeze(Object.values(REVIEW_PROJECTION));
const REQUIRED_SCHEMAS = Object.freeze([
	"gentle-ai.review-authority-status/v1",
	"gentle-ai.review-gate-request/v1",
	"gentle-ai.review-integration.capabilities/v1",
	"gentle-ai.review-integration.failure/v1",
	"gentle-ai.review-integration.operation/v1",
	"gentle-ai.review-integration.projection/v1",
	"gentle-ai.review-integration.start/v1",
	"gentle-ai.review-integration.status/v1",
	"gentle-ai.review-receipt/v1",
	"gentle-ai.review-receipt/v2",
	"gentle-ai.review-result-artifact/v1",
	"https://gentle-ai.dev/schema/review/refuter/v1",
	"https://gentle-ai.dev/schema/review/reviewer/v1",
	"https://gentle-ai.dev/schema/review/validator/v1",
] as const);
const OPTIONAL_FEATURE_NAMES = Object.freeze([
	"bounded_process_waits",
	"exact_gate_receipt_discovery",
	"native_low_risk_verification",
	"risk_reasons",
	"scope_change_diagnostics",
] as const);
const FEATURE_NAMES = Object.freeze([
	"bounded_process_waits",
	"compact_v2_authority",
	"exact_gate_receipt_discovery",
	"exact_receipt_replay",
	"five_delivery_gates",
	"immutable_snapshot",
	"legacy_v1_target_scoped_read_only",
	"native_low_risk_verification",
	"repository_independent_capabilities",
	"restart_safe_projection",
	"risk_reasons",
	"scope_change_diagnostics",
	"sdd_receipt_binding",
	"target_scoped_status",
	"uniform_failure_envelope",
] as const);
const REQUIRED_MANDATORY_FEATURES = Object.freeze(FEATURE_NAMES.filter((name) => !(OPTIONAL_FEATURE_NAMES as readonly string[]).includes(name)));

type StartAction = (typeof START_ACTIONS)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];
type ReviewLens = (typeof REVIEW_LENSES)[number];
type RiskReasonCode = (typeof RISK_REASON_CODES)[number];
type RiskSignal = (typeof RISK_SIGNALS)[number];
type ReviewStatusAction = (typeof STATUS_ACTIONS)[number];
type ReviewReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export interface ReviewFeatureV1 {
	name: (typeof FEATURE_NAMES)[number];
	supported: boolean;
	requires: readonly string[];
}

export interface ReviewCapabilitiesV1 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	packageVersion: string;
	buildId: string;
	executableDigest: string;
	operations: ReadonlySet<string>;
	gates: ReadonlySet<string>;
	projections: ReadonlySet<string>;
	schemas: ReadonlySet<string>;
	mandatoryFeatures: ReadonlySet<string>;
	optionalFeatures: ReadonlySet<string>;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewRiskReasonV1 {
	code: RiskReasonCode;
	signal?: RiskSignal;
	path?: string;
	oldMode?: string;
	newMode?: string;
}

export interface ReviewStartV1 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	action: StartAction;
	lensesRequired: boolean;
	lineageId: string;
	state: ReviewStartState;
	riskLevel: RiskLevel;
	selectedLenses: readonly ReviewLens[];
	projection: ReviewProjection;
	changedFiles: number;
	changedLines: number;
	correctionBudget: number;
	riskReasons: readonly ReviewRiskReasonV1[];
	targetMode?: "base-workspace-overlay";
	targetIdentity?: string;
	baseTree?: string;
	candidateTree?: string;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewProjectionDescriptorV1 {
	schema: "gentle-ai.review-integration.projection/v1";
	kind: ReviewProjectionKind;
	projection: ReviewProjection;
	baseTree: string;
	initialReviewTree: string;
	currentCandidateTree: string;
	pathsDigest: string;
	paths: readonly string[];
	intendedUntracked: readonly string[];
	intendedUntrackedProof: string;
	initialSnapshotIdentity: string;
	currentSnapshotIdentity: string;
}

export interface ReviewStatusAuthorityV1 {
	version: ReviewAuthorityVersion;
	lineageId: string;
	state: string;
	generation: number;
	revision: string;
}

export interface ReviewStatusReceiptV1 {
	status: ReviewReceiptStatus;
	identity?: string;
}

export interface ReviewStatusFrozenV1 {
	tier: RiskLevel;
	originalChangedLines: number;
	correctionBudget: number;
}

export interface ReviewStatusReconciliationV1 {
	required: true;
}

export interface ReviewStatusV1 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	applicability: Exclude<ReviewAuthorityApplicability, "not_evaluated">;
	authority?: ReviewStatusAuthorityV1;
	receipt: ReviewStatusReceiptV1;
	action: ReviewStatusAction;
	replayability: ReviewReplayability;
	frozen?: ReviewStatusFrozenV1;
	reconciliation?: ReviewStatusReconciliationV1;
	targetIdentity: string;
	projection: ReviewProjectionDescriptorV1;
	candidates: readonly string[];
	raw: Readonly<Record<string, unknown>>;
}

const FAILURE_REQUIRED_INPUTS = [
	"lineage_id",
	"change",
	"expected_binding_revision",
	"predecessor_lineage_id",
	"expected_predecessor_revision",
	"successor_lineage_id",
	"disposition",
	"reason",
	"actor",
] as const;
const FAILURE_NEXT_ACTIONS = ["correct_request", "retry", "retry_with_bounded_backoff", "review.status", "review.finalize", "review.bind_sdd", "explicit-maintainer-action", "stop"] as const;
// Known cause_category values: the vendored failure.schema.json enum plus
// "incomplete_store_entry", which the v2.1.8 emitter produces beyond that enum.
// cause_category is diagnostic metadata (nothing routes on it), so unknown
// snake_case values are tolerated for forward compatibility.
const FAILURE_CAUSE_CATEGORIES = ["inventory_io_or_layout", "lock_ambiguous", "reset_residue", "record_or_graph_invalid", "inventory_incomplete", "incomplete_store_entry"] as const;
export type ReviewFailureRequiredInputV1 = (typeof FAILURE_REQUIRED_INPUTS)[number];
export type ReviewFailureNextActionV1 = (typeof FAILURE_NEXT_ACTIONS)[number];
export type ReviewFailureCauseCategoryV1 = (typeof FAILURE_CAUSE_CATEGORIES)[number] | (string & {});

export interface ReviewFailureTargetEvidenceV1 {
	candidateTree: string;
	pathsDigest: string;
}

export interface ReviewFailureScopeChangeV1 {
	expected: ReviewFailureTargetEvidenceV1;
	actual: ReviewFailureTargetEvidenceV1;
	differingPathCount: number;
	differingPathsDigest: string;
	predecessorLineageId: string;
	predecessorRevision: string;
	recoveryOperation: "review.recover";
	recoveryRequiredInputs: readonly string[];
}

export interface ReviewFailureContextV1 {
	scopeChange: ReviewFailureScopeChangeV1;
}

export interface ReviewFailureV1 {
	schema: "gentle-ai.review-integration.failure/v1";
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: ReviewIntegrationOperation;
	phase: "preflight" | "pre_native" | "native_running" | "native_committed" | "reconciliation";
	code: string;
	message: string;
	mutationOutcome: ReviewMutationOutcome;
	authorityApplicability: ReviewAuthorityApplicability;
	retrySafe: boolean;
	replayability: ReviewReplayability;
	lineageId?: string;
	requestDigest?: string;
	requiredInputs: readonly ReviewFailureRequiredInputV1[];
	nextAction: ReviewFailureNextActionV1;
	causeCategory?: ReviewFailureCauseCategoryV1;
	context?: ReviewFailureContextV1;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewOperationV1 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: Exclude<ReviewIntegrationOperation, "review.capabilities" | "review.start" | "review.status">;
	result: Readonly<Record<string, unknown>>;
	raw: Readonly<Record<string, unknown>>;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exactRecord(value: unknown, label: string, required: readonly string[], optional: readonly string[] = [], allowAdditional = false): Record<string, unknown> {
	const body = record(value, label);
	for (const key of required) {
		if (!Object.hasOwn(body, key)) throw new TypeError(`${label}.${key} is required`);
	}
	const allowed = new Set([...required, ...optional]);
	if (!allowAdditional) for (const key of Object.keys(body)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not allowed`);
	return body;
}

function text(value: unknown, label: string, options: { minimum?: number; maximum?: number; pattern?: RegExp } = {}): string {
	const minimum = options.minimum ?? 0;
	if (typeof value !== "string" || value.length < minimum || (options.maximum !== undefined && value.length > options.maximum) || (options.pattern !== undefined && !options.pattern.test(value))) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
}

function nonempty(value: unknown, label: string): string {
	return text(value, label, { minimum: 1 });
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
	return value;
}

function integer(value: unknown, label: string, minimum = 0, maximum?: number): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
		throw new TypeError(`${label} must be an integer in range`);
	}
	return value;
}

function enumeration<T extends string>(value: unknown, values: readonly T[], label: string): T {
	if (typeof value !== "string" || !values.includes(value as T)) throw new TypeError(`${label} is unsupported`);
	return value as T;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const body = value as Record<string, unknown>;
		return `{${Object.keys(body).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(body[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function array<T>(value: unknown, label: string, decodeItem: (entry: unknown, label: string) => T, options: { minimum?: number; maximum?: number; unique?: boolean } = {}): readonly T[] {
	if (!Array.isArray(value) || value.length < (options.minimum ?? 0) || (options.maximum !== undefined && value.length > options.maximum)) {
		throw new TypeError(`${label} has an invalid length`);
	}
	const decoded = value.map((entry, index) => decodeItem(entry, `${label}[${index}]`));
	if (options.unique && new Set(decoded.map(canonicalJson)).size !== decoded.length) throw new TypeError(`${label} must not contain duplicates`);
	return decoded;
}

function stringArray(value: unknown, label: string, options: { minimum?: number; maximum?: number; unique?: boolean; pattern?: RegExp } = {}): readonly string[] {
	return array(value, label, (entry, itemLabel) => text(entry, itemLabel, { minimum: 1, pattern: options.pattern }), options);
}

function enumArray<T extends string>(value: unknown, values: readonly T[], label: string, options: { minimum?: number; maximum?: number; unique?: boolean } = {}): readonly T[] {
	return array(value, label, (entry, itemLabel) => enumeration(entry, values, itemLabel), options);
}

function sha256(value: unknown, label: string): string {
	return text(value, label, { pattern: /^sha256:[0-9a-f]{64}$/ });
}

function gitTree(value: unknown, label: string): string {
	return text(value, label, { pattern: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/ });
}

function lineage(value: unknown, label: string): string {
	return text(value, label, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ });
}

function safePath(value: unknown, label: string): string {
	return text(value, label, { minimum: 1, pattern: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/ });
}

function requireIdentity(value: Record<string, unknown>, schema: string, operation?: string): void {
	if (value.schema !== schema) throw new TypeError(`schema must be ${schema}`);
	if (value.contract !== REVIEW_INTEGRATION_CONTRACT) throw new TypeError(`contract must be ${REVIEW_INTEGRATION_CONTRACT}`);
	if (operation !== undefined && value.operation !== operation) throw new TypeError(`operation must be ${operation}`);
}

function assertExactSet(actual: readonly string[], expected: readonly string[], label: string): void {
	if (actual.length !== expected.length || expected.some((value) => !actual.includes(value))) throw new TypeError(`${label} does not match the required integration surface`);
}

function decodeFeature(value: unknown, label: string, allowAdditional = false): ReviewFeatureV1 {
	const feature = exactRecord(value, label, ["name", "supported", "requires"], [], allowAdditional);
	return {
		name: enumeration(feature.name, FEATURE_NAMES, `${label}.name`),
		supported: boolean(feature.supported, `${label}.supported`),
		requires: stringArray(feature.requires, `${label}.requires`, { unique: true }),
	};
}

function decodeOptionalFeature(value: unknown, label: string, allowUnknown: boolean): { name: string; supported: boolean; requires: readonly string[] } {
	const feature = exactRecord(value, label, ["name", "supported", "requires"], [], allowUnknown);
	const name = nonempty(feature.name, `${label}.name`);
	if (!allowUnknown && !(FEATURE_NAMES as readonly string[]).includes(name)) throw new TypeError(`${label}.name is unsupported`);
	return {
		name,
		supported: boolean(feature.supported, `${label}.supported`),
		requires: stringArray(feature.requires, `${label}.requires`, { unique: true }),
	};
}

export function decodeReviewCapabilitiesV1(value: unknown, verifiedExecutableDigest: string): ReviewCapabilitiesV1 {
	const requiredFields = ["schema", "contract", "protocol", "package", "build", "executable", "operations", "gates", "projections", "schemas", "features", "compatibility"] as const;
	const candidate = exactRecord(value, "capabilities", requiredFields, [], true);
	const candidateProtocol = exactRecord(candidate.protocol, "capabilities.protocol", ["major", "minor"], [], true);
	const protocolMajor = integer(candidateProtocol.major, "capabilities.protocol.major");
	const protocolMinor = integer(candidateProtocol.minor, "capabilities.protocol.minor");
	if (protocolMajor !== 1) throw new TypeError("incompatible review integration protocol");
	const allowAdditions = protocolMinor > 0;
	const body = exactRecord(value, "capabilities", requiredFields, [], allowAdditions);
	const capabilitiesSchema = protocolMinor === 0 ? "gentle-ai.review-integration.capabilities/v1" : `gentle-ai.review-integration.capabilities/v1.${protocolMinor}`;
	requireIdentity(body, capabilitiesSchema);
	const requiredSchemas = REQUIRED_SCHEMAS.map((schema) => (schema === "gentle-ai.review-integration.capabilities/v1" ? capabilitiesSchema : schema));

	const protocol = exactRecord(body.protocol, "capabilities.protocol", ["major", "minor"], [], allowAdditions);
	if (protocol.major !== protocolMajor || protocol.minor !== protocolMinor) throw new TypeError("incompatible review integration protocol");

	const packageIdentity = exactRecord(body.package, "capabilities.package", ["name", "version", "release_channel"], [], allowAdditions);
	if (packageIdentity.name !== "gentle-ai") throw new TypeError("capabilities package identity mismatch");
	const packageVersion = nonempty(packageIdentity.version, "capabilities.package.version");
	enumeration(packageIdentity.release_channel, ["development", "prerelease", "stable"] as const, "capabilities.package.release_channel");

	const build = exactRecord(body.build, "capabilities.build", ["id", "go_version", "module_version", "vcs", "vcs_revision", "vcs_time", "vcs_modified"], [], allowAdditions);
	const buildId = sha256(build.id, "capabilities.build.id");
	nonempty(build.go_version, "capabilities.build.go_version");
	for (const field of ["module_version", "vcs", "vcs_revision", "vcs_time"] as const) text(build[field], `capabilities.build.${field}`);
	enumeration(build.vcs_modified, ["true", "false", "unknown"] as const, "capabilities.build.vcs_modified");

	const executable = exactRecord(body.executable, "capabilities.executable", ["sha256", "evidence", "verification"], [], allowAdditions);
	const selfReportedDigest = sha256(executable.sha256, "capabilities.executable.sha256");
	if (executable.evidence !== "self-reported" || executable.verification !== "compare-with-published-manifest") throw new TypeError("capabilities executable evidence is incompatible");
	const normalizedVerifiedDigest = sha256(verifiedExecutableDigest.startsWith("sha256:") ? verifiedExecutableDigest : `sha256:${verifiedExecutableDigest}`, "verified executable digest");
	if (selfReportedDigest !== normalizedVerifiedDigest) throw new TypeError("review provider executable digest mismatch");

	const operations = enumArray(body.operations, REQUIRED_OPERATIONS, "capabilities.operations", { minimum: 6, maximum: 6, unique: true });
	const gates = enumArray(body.gates, REQUIRED_GATES, "capabilities.gates", { minimum: 5, maximum: 5, unique: true });
	const projections = enumArray(body.projections, REQUIRED_PROJECTIONS, "capabilities.projections", { minimum: 2, maximum: 2, unique: true });
	const schemas = enumArray(body.schemas, requiredSchemas, "capabilities.schemas", { minimum: 14, maximum: 14, unique: true });
	assertExactSet(operations, REQUIRED_OPERATIONS, "capabilities operations");
	assertExactSet(gates, REQUIRED_GATES, "capabilities gates");
	assertExactSet(projections, REQUIRED_PROJECTIONS, "capabilities projections");
	assertExactSet(schemas, requiredSchemas, "capabilities schemas");

	const features = exactRecord(body.features, "capabilities.features", ["mandatory", "optional"], [], allowAdditions);
	const mandatory = array(features.mandatory, "capabilities.features.mandatory", (entry, label) => decodeFeature(entry, label, allowAdditions), { minimum: 10, ...(allowAdditions ? {} : { maximum: 10 }) });
	const optional = array(features.optional, "capabilities.features.optional", (entry, label) => decodeOptionalFeature(entry, label, allowAdditions), { minimum: 5, ...(allowAdditions ? {} : { maximum: 5 }), unique: true });
	const mandatoryNames = mandatory.map((feature) => feature.name);
	const optionalNames = optional.map((feature) => feature.name);
	assertExactSet(mandatoryNames, REQUIRED_MANDATORY_FEATURES, "mandatory capabilities");
	if (new Set(optionalNames).size !== optionalNames.length) throw new TypeError("optional capabilities contain duplicate names");
	if (optionalNames.some((name) => mandatoryNames.includes(name as ReviewFeatureV1["name"]))) throw new TypeError("mandatory and optional capabilities overlap");
	if (mandatory.some((feature) => !feature.supported)) throw new TypeError("mandatory capability is unsupported");

	const compatibility = exactRecord(body.compatibility, "capabilities.compatibility", ["minimum_protocol_major", "maximum_protocol_major", "additive_minor_policy", "unknown_mandatory", "unknown_optional", "modes", "legacy_window"], [], allowAdditions);
	if (compatibility.minimum_protocol_major !== 1 || compatibility.maximum_protocol_major !== 1 || compatibility.additive_minor_policy !== "optional-fields-only" || compatibility.unknown_mandatory !== "reject" || compatibility.unknown_optional !== "ignore") {
		throw new TypeError("incompatible capability evolution policy");
	}
	const modes = enumArray(compatibility.modes, Object.values(REVIEW_AUTHORITY_VERSION), "capabilities.compatibility.modes", { minimum: 2, maximum: 2 });
	if (modes[0] !== REVIEW_AUTHORITY_VERSION.COMPACT_V2 || modes[1] !== REVIEW_AUTHORITY_VERSION.LEGACY_V1) throw new TypeError("capabilities compatibility modes are out of order");
	const legacyWindow = exactRecord(compatibility.legacy_window, "capabilities.compatibility.legacy_window", ["mode", "state", "read_only", "deprecation_started", "removal", "minimum_compatibility_releases"], [], allowAdditions);
	if (legacyWindow.mode !== REVIEW_AUTHORITY_VERSION.LEGACY_V1) throw new TypeError("capabilities legacy window mode is incompatible");
	enumeration(legacyWindow.state, ["pre-fence", "active", "deprecated", "expired"] as const, "capabilities.compatibility.legacy_window.state");
	boolean(legacyWindow.read_only, "capabilities.compatibility.legacy_window.read_only");
	boolean(legacyWindow.deprecation_started, "capabilities.compatibility.legacy_window.deprecation_started");
	nonempty(legacyWindow.removal, "capabilities.compatibility.legacy_window.removal");
	integer(legacyWindow.minimum_compatibility_releases, "capabilities.compatibility.legacy_window.minimum_compatibility_releases", 1);

	return {
		contract: REVIEW_INTEGRATION_CONTRACT,
		packageVersion,
		buildId,
		executableDigest: selfReportedDigest,
		operations: new Set(operations),
		gates: new Set(gates),
		projections: new Set(projections),
		schemas: new Set(schemas),
		mandatoryFeatures: new Set(mandatoryNames),
		optionalFeatures: new Set(optional.filter((feature) => feature.supported && (FEATURE_NAMES as readonly string[]).includes(feature.name)).map((feature) => feature.name)),
		raw: body,
	};
}

export function decodeReviewStartV1(value: unknown): ReviewStartV1 {
	const overlayFields = ["target_mode", "target_identity", "base_tree", "candidate_tree"] as const;
	const body = exactRecord(value, "start", ["schema", "contract", "operation", "action", "lenses_required", "lineage_id", "state", "risk_level", "selected_lenses", "projection", "changed_files", "changed_lines", "correction_budget", "risk_reasons"], [...overlayFields]);
	requireIdentity(body, "gentle-ai.review-integration.start/v1", REVIEW_INTEGRATION_OPERATION.START);
	const overlayPresent = overlayFields.filter((field) => body[field] !== undefined);
	if (overlayPresent.length > 0 && overlayPresent.length !== overlayFields.length) throw new TypeError("start workspace-overlay target binding requires target_mode, target_identity, base_tree, and candidate_tree together");
	let overlay: Pick<ReviewStartV1, "targetMode" | "targetIdentity" | "baseTree" | "candidateTree"> = {};
	if (overlayPresent.length === overlayFields.length) {
		overlay = {
			targetMode: enumeration(body.target_mode, ["base-workspace-overlay"] as const, "start.target_mode"),
			targetIdentity: sha256(body.target_identity, "start.target_identity"),
			baseTree: gitTree(body.base_tree, "start.base_tree"),
			candidateTree: gitTree(body.candidate_tree, "start.candidate_tree"),
		};
	}
	const riskReasons = array(body.risk_reasons, "start.risk_reasons", (entry, label): ReviewRiskReasonV1 => {
		const reason = exactRecord(entry, label, ["code"], ["signal", "path", "old_mode", "new_mode"]);
		return {
			code: enumeration(reason.code, RISK_REASON_CODES, `${label}.code`),
			...(reason.signal === undefined ? {} : { signal: enumeration(reason.signal, RISK_SIGNALS, `${label}.signal`) }),
			...(reason.path === undefined ? {} : { path: nonempty(reason.path, `${label}.path`) }),
			...(reason.old_mode === undefined ? {} : { oldMode: text(reason.old_mode, `${label}.old_mode`, { pattern: /^[0-7]{6}$/ }) }),
			...(reason.new_mode === undefined ? {} : { newMode: text(reason.new_mode, `${label}.new_mode`, { pattern: /^[0-7]{6}$/ }) }),
		};
	}, { minimum: 1, unique: true });
	return {
		contract: REVIEW_INTEGRATION_CONTRACT,
		action: enumeration(body.action, START_ACTIONS, "start.action"),
		lensesRequired: boolean(body.lenses_required, "start.lenses_required"),
		lineageId: nonempty(body.lineage_id, "start.lineage_id"),
		state: enumeration(body.state, Object.values(REVIEW_START_STATE), "start.state"),
		riskLevel: enumeration(body.risk_level, RISK_LEVELS, "start.risk_level"),
		selectedLenses: enumArray(body.selected_lenses, REVIEW_LENSES, "start.selected_lenses", { maximum: 4, unique: true }),
		projection: enumeration(body.projection, REQUIRED_PROJECTIONS, "start.projection"),
		changedFiles: integer(body.changed_files, "start.changed_files"),
		changedLines: integer(body.changed_lines, "start.changed_lines"),
		correctionBudget: integer(body.correction_budget, "start.correction_budget", 0, 200),
		riskReasons,
		...overlay,
		raw: body,
	};
}

export function decodeReviewProjectionV1(value: unknown): ReviewProjectionDescriptorV1 {
	const projection = exactRecord(value, "status.projection", ["schema", "kind", "projection", "base_tree", "initial_review_tree", "current_candidate_tree", "paths_digest", "paths", "intended_untracked", "intended_untracked_proof", "initial_snapshot_identity", "current_snapshot_identity"]);
	if (projection.schema !== "gentle-ai.review-integration.projection/v1") throw new TypeError("status.projection schema is incompatible");
	return {
		schema: "gentle-ai.review-integration.projection/v1",
		kind: enumeration(projection.kind, Object.values(REVIEW_PROJECTION_KIND), "status.projection.kind"),
		projection: enumeration(projection.projection, REQUIRED_PROJECTIONS, "status.projection.projection"),
		baseTree: gitTree(projection.base_tree, "status.projection.base_tree"),
		initialReviewTree: gitTree(projection.initial_review_tree, "status.projection.initial_review_tree"),
		currentCandidateTree: gitTree(projection.current_candidate_tree, "status.projection.current_candidate_tree"),
		pathsDigest: sha256(projection.paths_digest, "status.projection.paths_digest"),
		paths: array(projection.paths, "status.projection.paths", safePath, { unique: true }),
		intendedUntracked: array(projection.intended_untracked, "status.projection.intended_untracked", safePath, { unique: true }),
		intendedUntrackedProof: sha256(projection.intended_untracked_proof, "status.projection.intended_untracked_proof"),
		initialSnapshotIdentity: sha256(projection.initial_snapshot_identity, "status.projection.initial_snapshot_identity"),
		currentSnapshotIdentity: sha256(projection.current_snapshot_identity, "status.projection.current_snapshot_identity"),
	};
}

export function decodeReviewStatusV1(value: unknown): ReviewStatusV1 {
	const body = exactRecord(value, "status", ["schema", "contract", "operation", "applicability", "receipt", "action", "replayability", "target_identity", "projection", "candidates"], ["authority", "frozen", "reconciliation"]);
	requireIdentity(body, "gentle-ai.review-integration.status/v1", REVIEW_INTEGRATION_OPERATION.STATUS);
	const applicability = enumeration(body.applicability, ["current_target", "unrelated", "ambiguous", "corrupted"] as const, "status.applicability");
	const receiptBody = exactRecord(body.receipt, "status.receipt", ["status"], ["identity"]);
	const receiptStatus = enumeration(receiptBody.status, RECEIPT_STATUSES, "status.receipt.status");
	const receipt: ReviewStatusReceiptV1 = { status: receiptStatus, ...(receiptBody.identity === undefined ? {} : { identity: sha256(receiptBody.identity, "status.receipt.identity") }) };

	let authority: ReviewStatusAuthorityV1 | undefined;
	if (body.authority !== undefined) {
		const source = exactRecord(body.authority, "status.authority", ["version", "lineage_id", "state", "generation", "revision"]);
		authority = {
			version: enumeration(source.version, Object.values(REVIEW_AUTHORITY_VERSION), "status.authority.version"),
			lineageId: lineage(source.lineage_id, "status.authority.lineage_id"),
			state: nonempty(source.state, "status.authority.state"),
			generation: integer(source.generation, "status.authority.generation", 1),
			revision: sha256(source.revision, "status.authority.revision"),
		};
	}
	if (applicability === REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET && authority === undefined) throw new TypeError("current_target status requires authority");
	if (applicability !== REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET && authority !== undefined) throw new TypeError("non-current status cannot expose authority");

	let frozen: ReviewStatusFrozenV1 | undefined;
	if (body.frozen !== undefined) {
		const source = exactRecord(body.frozen, "status.frozen", ["tier", "original_changed_lines", "correction_budget"]);
		frozen = {
			tier: enumeration(source.tier, RISK_LEVELS, "status.frozen.tier"),
			originalChangedLines: integer(source.original_changed_lines, "status.frozen.original_changed_lines"),
			correctionBudget: integer(source.correction_budget, "status.frozen.correction_budget", 0, 200),
		};
	}
	if (authority?.version === REVIEW_AUTHORITY_VERSION.COMPACT_V2 && frozen === undefined) throw new TypeError("compact-v2 status requires frozen metadata");
	if ((authority?.version === REVIEW_AUTHORITY_VERSION.LEGACY_V1 || applicability !== REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET) && frozen !== undefined) throw new TypeError("legacy/non-current status cannot expose frozen metadata");
	if (authority?.version === REVIEW_AUTHORITY_VERSION.LEGACY_V1 && receiptStatus !== "expected_missing" && receiptStatus !== "present") throw new TypeError("legacy status receipt is incompatible");

	const action = enumeration(body.action, STATUS_ACTIONS, "status.action");
	const replayability = enumeration(body.replayability, Object.values(REVIEW_REPLAYABILITY), "status.replayability");
	let reconciliation: ReviewStatusReconciliationV1 | undefined;
	if (action === "reconcile_finalize") {
		if (body.reconciliation === undefined) throw new TypeError("reconcile_finalize status requires reconciliation");
		const source = exactRecord(body.reconciliation, "status.reconciliation", ["required"]);
		if (source.required !== true) throw new TypeError("status.reconciliation.required must be true");
		if (applicability !== REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET) throw new TypeError("reconcile_finalize status requires current_target applicability");
		if (replayability !== REVIEW_REPLAYABILITY.STATUS_REQUIRED) throw new TypeError("reconcile_finalize status requires status_required replayability");
		reconciliation = { required: true };
	} else if (body.reconciliation !== undefined) {
		throw new TypeError("status.reconciliation is only valid for the reconcile_finalize action");
	}

	return {
		contract: REVIEW_INTEGRATION_CONTRACT,
		applicability,
		...(authority === undefined ? {} : { authority }),
		receipt,
		action,
		replayability,
		...(frozen === undefined ? {} : { frozen }),
		...(reconciliation === undefined ? {} : { reconciliation }),
		targetIdentity: sha256(body.target_identity, "status.target_identity"),
		projection: decodeReviewProjectionV1(body.projection),
		candidates: stringArray(body.candidates, "status.candidates", { unique: true, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ }),
		raw: body,
	};
}

function decodeFailureTargetEvidence(value: unknown, label: string): ReviewFailureTargetEvidenceV1 {
	const evidence = exactRecord(value, label, ["candidate_tree", "paths_digest"]);
	return {
		candidateTree: gitTree(evidence.candidate_tree, `${label}.candidate_tree`),
		pathsDigest: sha256(evidence.paths_digest, `${label}.paths_digest`),
	};
}

function decodeFailureContext(value: unknown, label: string): ReviewFailureContextV1 {
	const context = exactRecord(value, label, ["scope_change"]);
	const scopeLabel = `${label}.scope_change`;
	const scope = exactRecord(context.scope_change, scopeLabel, ["expected", "actual", "differing_path_count", "differing_paths_digest", "predecessor_lineage_id", "predecessor_revision", "recovery_operation", "recovery_required_inputs"]);
	if (scope.recovery_operation !== "review.recover") throw new TypeError(`${scopeLabel}.recovery_operation is unsupported`);
	const recoveryInputs = stringArray(scope.recovery_required_inputs, `${scopeLabel}.recovery_required_inputs`, { minimum: 6, maximum: 6 });
	const expectedRecoveryInputs = ["predecessor_lineage_id", "expected_predecessor_revision", "successor_lineage_id", "disposition", "reason", "actor"];
	if (recoveryInputs.some((input, index) => input !== expectedRecoveryInputs[index])) throw new TypeError(`${scopeLabel}.recovery_required_inputs is unsupported`);
	return {
		scopeChange: {
			expected: decodeFailureTargetEvidence(scope.expected, `${scopeLabel}.expected`),
			actual: decodeFailureTargetEvidence(scope.actual, `${scopeLabel}.actual`),
			differingPathCount: integer(scope.differing_path_count, `${scopeLabel}.differing_path_count`, 0, 1_000_000),
			differingPathsDigest: sha256(scope.differing_paths_digest, `${scopeLabel}.differing_paths_digest`),
			predecessorLineageId: lineage(scope.predecessor_lineage_id, `${scopeLabel}.predecessor_lineage_id`),
			predecessorRevision: sha256(scope.predecessor_revision, `${scopeLabel}.predecessor_revision`),
			recoveryOperation: "review.recover",
			recoveryRequiredInputs: recoveryInputs,
		},
	};
}

export function decodeReviewFailureV1(value: unknown): ReviewFailureV1 {
	const body = exactRecord(value, "failure", ["schema", "contract", "operation", "phase", "code", "message", "mutation_outcome", "authority_applicability", "retry_safe", "replayability", "required_inputs", "next_action"], ["lineage_id", "request_digest", "cause_category", "context"]);
	requireIdentity(body, "gentle-ai.review-integration.failure/v1");
	return {
		schema: "gentle-ai.review-integration.failure/v1",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: enumeration(body.operation, REQUIRED_OPERATIONS, "failure.operation"),
		phase: enumeration(body.phase, ["preflight", "pre_native", "native_running", "native_committed", "reconciliation"] as const, "failure.phase"),
		code: text(body.code, "failure.code", { pattern: /^[a-z0-9]+(?:_[a-z0-9]+)*$/ }),
		message: text(body.message, "failure.message", { minimum: 1, maximum: 240, pattern: /^[^\r\n]+$/ }),
		mutationOutcome: enumeration(body.mutation_outcome, Object.values(REVIEW_MUTATION_OUTCOME), "failure.mutation_outcome"),
		authorityApplicability: enumeration(body.authority_applicability, Object.values(REVIEW_AUTHORITY_APPLICABILITY), "failure.authority_applicability"),
		retrySafe: boolean(body.retry_safe, "failure.retry_safe"),
		replayability: enumeration(body.replayability, Object.values(REVIEW_REPLAYABILITY), "failure.replayability"),
		...(body.lineage_id === undefined ? {} : { lineageId: lineage(body.lineage_id, "failure.lineage_id") }),
		...(body.request_digest === undefined ? {} : { requestDigest: sha256(body.request_digest, "failure.request_digest") }),
		requiredInputs: enumArray(body.required_inputs, FAILURE_REQUIRED_INPUTS, "failure.required_inputs", { unique: true }),
		nextAction: enumeration(body.next_action, FAILURE_NEXT_ACTIONS, "failure.next_action"),
		...(body.cause_category === undefined ? {} : { causeCategory: text(body.cause_category, "failure.cause_category", { minimum: 1, pattern: /^[a-z0-9]+(?:_[a-z0-9]+)*$/ }) }),
		...(body.context === undefined ? {} : { context: decodeFailureContext(body.context, "failure.context") }),
		raw: body,
	};
}

export function decodeReviewOperationV1(value: unknown): ReviewOperationV1 {
	const body = exactRecord(value, "operation", ["schema", "contract", "operation", "result"]);
	requireIdentity(body, "gentle-ai.review-integration.operation/v1");
	const operation = enumeration(body.operation, ["review.finalize", "review.validate", "review.bind_sdd"] as const, "operation.operation");
	let result: Record<string, unknown>;
	if (operation === REVIEW_INTEGRATION_OPERATION.FINALIZE) {
		result = exactRecord(body.result, "operation.result", ["operation", "lineage_id", "state", "action", "store_revision"]);
		if (result.operation !== "review/finalize") throw new TypeError("operation.result does not match review.finalize");
		nonempty(result.lineage_id, "operation.result.lineage_id");
		nonempty(result.state, "operation.result.state");
		nonempty(result.action, "operation.result.action");
		sha256(result.store_revision, "operation.result.store_revision");
	} else if (operation === REVIEW_INTEGRATION_OPERATION.VALIDATE) {
		result = exactRecord(body.result, "operation.result", ["schema", "result", "allowed", "action", "reason", "context"]);
		if (result.schema !== "gentle-ai.review-gate-result/v1") throw new TypeError("operation.result does not match review.validate");
		enumeration(result.result, ["allow", "scope-changed", "invalidated", "escalated"] as const, "operation.result.result");
		boolean(result.allowed, "operation.result.allowed");
		nonempty(result.action, "operation.result.action");
		nonempty(result.reason, "operation.result.reason");
		record(result.context, "operation.result.context");
	} else {
		result = exactRecord(body.result, "operation.result", ["schema", "revision", "change", "lineage", "authority_revision", "receipt_hash", "gate_context"]);
		if (result.schema !== "gentle-ai.sdd-review-binding/v1") throw new TypeError("operation.result does not match review.bind_sdd");
		sha256(result.revision, "operation.result.revision");
		nonempty(result.change, "operation.result.change");
		nonempty(result.lineage, "operation.result.lineage");
		sha256(result.authority_revision, "operation.result.authority_revision");
		sha256(result.receipt_hash, "operation.result.receipt_hash");
		record(result.gate_context, "operation.result.gate_context");
	}
	return { contract: REVIEW_INTEGRATION_CONTRACT, operation, result, raw: body };
}
