import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { canonicalJsonV1, domainHashV1 } from "./review-canonical.ts";
import {
	COMPACT_REVIEW_STATE,
	assertCompactReceipt,
	assertCompactReviewState,
	createCompactReceipt,
	type CompactReceiptEnvelopeV2,
	type CompactReviewStateV2,
} from "./review-compact.ts";
import {
	ReviewMutationLockV1,
	type ReviewLockPlatformAdapterV1,
} from "./review-lock.ts";
import {
	assertManagedStorePathV1,
	resolveRepositoryAuthorityV1,
	type RepositoryAuthorityV1,
} from "./review-repository.ts";
import { ReviewTransactionStore } from "./review-transaction.ts";
import { assertLoadedReviewRuntimeIdentity } from "./review-runtime-contract.ts";
import {
	captureCurrentReviewCandidateTree,
	captureOrdinaryCorrectionSnapshot,
	deriveReviewSnapshotRisk,
	discoverReviewUntrackedPaths,
} from "./review-snapshot.ts";

export const COMPACT_STORE_OPERATION = {
	START: "review/start",
	COMPLETE_REVIEW: "review/complete-review",
	BEGIN_CORRECTION: "review/begin-correction",
	FREEZE_VALIDATOR_REQUEST: "review/freeze-validator-request",
	COMPLETE_CORRECTION: "review/complete-correction",
	COMPLETE_VERIFICATION: "review/complete-verification",
} as const;

export type CompactStoreOperation =
	(typeof COMPACT_STORE_OPERATION)[keyof typeof COMPACT_STORE_OPERATION];

export interface CompactStateRecordV2 {
	schema: "gentle-ai.review-state-record/v2";
	revision: string;
	state: CompactReviewStateV2;
}

export interface CompactReviewStoreOptions {
	mutationLockPlatform?: ReviewLockPlatformAdapterV1;
	faultInjector?: (point: "before-state-rename" | "before-receipt-rename") => void;
}

export const COMPACT_AUTHORITY_OUTCOME = {
	NONE: "none",
	ACTIVE: "active",
	APPROVED: "approved",
	ESCALATED: "escalated",
	INVALID: "invalid",
} as const;

export type CompactAuthorityOutcomeV2 =
	(typeof COMPACT_AUTHORITY_OUTCOME)[keyof typeof COMPACT_AUTHORITY_OUTCOME];

export interface CompactAuthorityLineageV2 {
	lineage_id: string;
	state: CompactReviewStateV2["state"];
	revision: string;
}

export interface CompactAuthorityInspectionV2 {
	outcome: CompactAuthorityOutcomeV2;
	lineages: readonly CompactAuthorityLineageV2[];
}

export class CompactReviewStoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CompactReviewStoreError";
	}
}

const LINEAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const STATE_KEYS = new Set([
	"schema", "lineage_id", "generation", "mode", "state", "initial_snapshot",
	"current_candidate_tree", "genesis_paths", "intended_untracked", "policy_hash",
	"risk_tier", "selected_lenses", "original_changed_lines", "correction_budget",
	"lens_results", "findings", "outcomes", "correction_ids", "follow_ups",
	"correction_line_forecast", "validator_request", "runtime_identity", "correction", "validation", "final_evidence_hash",
	"escalation_reasons",
]);
const SNAPSHOT_KEYS = new Set([
	"schema", "mode", "repository_root", "base_tree", "complete_snapshot_tree",
	"review_projection", "initial_review_tree", "genesis_paths", "intended_untracked",
	"diff_evidence", "route", "lenses", "risk_tier", "original_changed_lines",
	"correction_budget", "policy_hash", "object_store",
]);
const PROJECTION_KEYS = new Set(["kind", "tree"]);
const DIFF_EVIDENCE_KEYS = new Set([
	"event", "changedLines", "triviality", "evidenceComplete", "executableChanged",
	"configurationChanged", "hotPathChanged", "riskSignal", "resilienceSignal",
	"reliabilitySignal",
]);
const OBJECT_STORE_KEYS = new Set([
	"snapshot_directory", "object_directory", "alternate_object_directory", "metadata_path",
	"sensitivity", "cleanup_trigger", "cleanup_action",
]);
const LENS_RESULT_KEYS = new Set(["lens", "findings", "evidence"]);
const FINDING_KEYS = new Set([
	"id", "lens", "location", "severity", "claim", "evidence_class",
	"causal_disposition", "proof_refs",
]);
const FOLLOW_UP_KEYS = new Set(["finding_id", "location", "summary", "proof_refs"]);
const CORRECTION_KEYS = new Set([
	"candidate_tree", "changed_paths", "changed_lines", "fix_diff_hash", "correction_ids",
	"intended_untracked",
]);
const VALIDATION_KEYS = new Set([
	"correction_ids", "original_criteria", "correction_regression", "follow_ups",
]);
const VALIDATION_CHECK_KEYS = new Set(["passed", "evidence"]);
const VALIDATOR_REQUEST_KEYS = new Set(["body", "request_hash"]);
const VALIDATOR_REQUEST_BODY_KEYS = new Set([
	"schema", "purpose", "scope", "lineage_id", "candidate_tree", "fix_diff_hash", "correction_ids", "correction_paths",
	"frozen_rows", "frozen_ledger_hash",
]);
const RUNTIME_IDENTITY_KEYS = new Set([
	"schema", "compact_contract", "operation_contract", "state_schema", "record_schema", "receipt_schema",
	"canonicalization", "identity_hash",
]);
const RECEIPT_BODY_KEYS = new Set([
	"schema", "lineage_id", "generation", "authority_revision", "base_tree",
	"initial_review_tree", "final_candidate_tree", "genesis_paths_hash",
	"intended_untracked_hash", "policy_hash", "risk_tier", "selected_lenses",
	"original_changed_lines", "correction_budget", "correction_ids", "fix_diff_hash",
	"evidence_hash", "terminal_state",
]);

function clone<T>(value: T): T {
	return JSON.parse(canonicalJsonV1(value)) as T;
}

function equal(left: unknown, right: unknown): boolean {
	return canonicalJsonV1(left) === canonicalJsonV1(right);
}

function assertExactKeys(value: object, allowed: ReadonlySet<string>, label: string): void {
	const unknown = Object.keys(value).find((key) => !allowed.has(key));
	if (unknown) throw new CompactReviewStoreError(`${label} contains unknown field ${unknown}`);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new CompactReviewStoreError(`${label} must be an object`);
	}
}

function assertObjectArray(value: unknown, label: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new CompactReviewStoreError(`${label} must be an array`);
	return value.map((item, index) => {
		assertObject(item, `${label} item ${index + 1}`);
		return item;
	});
}

function assertFollowUpShape(value: unknown, label: string): void {
	for (const followUp of assertObjectArray(value, label)) assertExactKeys(followUp, FOLLOW_UP_KEYS, label);
}

function assertExactStateShape(state: CompactReviewStateV2): void {
	assertExactKeys(state, STATE_KEYS, "Compact review state");
	assertObject(state.initial_snapshot, "Compact initial snapshot");
	assertExactKeys(state.initial_snapshot, SNAPSHOT_KEYS, "Compact initial snapshot");
	assertObject(state.initial_snapshot.review_projection, "Compact review projection");
	assertExactKeys(state.initial_snapshot.review_projection, PROJECTION_KEYS, "Compact review projection");
	assertObject(state.initial_snapshot.diff_evidence, "Compact diff evidence");
	assertExactKeys(state.initial_snapshot.diff_evidence, DIFF_EVIDENCE_KEYS, "Compact diff evidence");
	assertObject(state.initial_snapshot.object_store, "Compact snapshot object store");
	assertExactKeys(state.initial_snapshot.object_store, OBJECT_STORE_KEYS, "Compact snapshot object store");
	for (const result of assertObjectArray(state.lens_results, "Compact lens results")) {
		assertExactKeys(result, LENS_RESULT_KEYS, "Compact lens result");
		for (const finding of assertObjectArray(result.findings, "Compact findings")) {
			assertExactKeys(finding, FINDING_KEYS, "Compact finding");
		}
	}
	assertFollowUpShape(state.follow_ups, "Compact follow-ups");
	if (state.correction !== undefined) {
		assertObject(state.correction, "Compact correction");
		assertExactKeys(state.correction, CORRECTION_KEYS, "Compact correction");
	}
	assertObject(state.runtime_identity, "Compact runtime identity");
	assertExactKeys(state.runtime_identity, RUNTIME_IDENTITY_KEYS, "Compact runtime identity");
	if (state.validator_request !== undefined) {
		assertObject(state.validator_request, "Compact validator request");
		assertExactKeys(state.validator_request, VALIDATOR_REQUEST_KEYS, "Compact validator request");
		assertObject(state.validator_request.body, "Compact validator request body");
		assertExactKeys(state.validator_request.body, VALIDATOR_REQUEST_BODY_KEYS, "Compact validator request body");
		for (const finding of assertObjectArray(state.validator_request.body.frozen_rows, "Compact validator frozen rows")) {
			assertExactKeys(finding, FINDING_KEYS, "Compact validator frozen row");
		}
		if (!Array.isArray(state.validator_request.body.scope) || state.validator_request.body.scope.some((scope) => typeof scope !== "string")) {
			throw new CompactReviewStoreError("Compact validator request scope is malformed");
		}
	}
	if (state.validation !== undefined) {
		assertObject(state.validation, "Compact validation");
		assertExactKeys(state.validation, VALIDATION_KEYS, "Compact validation");
		for (const [label, check] of [
			["original criteria", state.validation.original_criteria],
			["correction regression", state.validation.correction_regression],
		] as const) {
			assertObject(check, `Compact validation ${label}`);
			assertExactKeys(check, VALIDATION_CHECK_KEYS, `Compact validation ${label}`);
		}
		assertFollowUpShape(state.validation.follow_ups, "Compact validation follow-ups");
	}
}

function operationMatchesState(operation: CompactStoreOperation, state: CompactReviewStateV2): boolean {
	if (operation === COMPACT_STORE_OPERATION.START) return state.state === COMPACT_REVIEW_STATE.REVIEWING;
	if (operation === COMPACT_STORE_OPERATION.FREEZE_VALIDATOR_REQUEST) return state.validator_request !== undefined;
	if (operation === COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION) return state.final_evidence_hash !== undefined;
	if (operation === COMPACT_STORE_OPERATION.COMPLETE_CORRECTION) return state.correction !== undefined;
	if (operation === COMPACT_STORE_OPERATION.BEGIN_CORRECTION) {
		return state.correction_line_forecast !== undefined && state.correction === undefined;
	}
	return state.state !== COMPACT_REVIEW_STATE.REVIEWING &&
		state.correction_line_forecast === undefined &&
		state.correction === undefined &&
		state.final_evidence_hash === undefined;
}

function stateIsOneOf(
	state: CompactReviewStateV2["state"],
	allowed: readonly CompactReviewStateV2["state"][],
): boolean {
	return allowed.includes(state);
}

function revisionFor(state: CompactReviewStateV2): string {
	return domainHashV1("compact-state", state);
}

function recordFor(state: CompactReviewStateV2): CompactStateRecordV2 {
	assertCompactReviewState(state);
	return {
		schema: "gentle-ai.review-state-record/v2",
		revision: revisionFor(state),
		state: clone(state),
	};
}

function parseRecord(payload: string, lineageId: string): CompactStateRecordV2 {
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		throw new CompactReviewStoreError("Compact review state is malformed");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new CompactReviewStoreError("Compact review state record must be an object");
	}
	assertExactKeys(parsed, new Set(["schema", "revision", "state"]), "Compact review state record");
	const record = parsed as CompactStateRecordV2;
	if (
		record.schema !== "gentle-ai.review-state-record/v2" ||
		!DIGEST.test(record.revision) ||
		typeof record.state !== "object" ||
		record.state === null
	) {
		throw new CompactReviewStoreError("Compact review state record is invalid");
	}
	assertExactStateShape(record.state);
	assertCompactReviewState(record.state);
	if (record.state.lineage_id !== lineageId) {
		throw new CompactReviewStoreError("Compact review state does not match its lineage directory");
	}
	if (record.revision !== revisionFor(record.state)) {
		throw new CompactReviewStoreError("Compact review state revision checksum mismatch");
	}
	return clone(record);
}

function immutableBinding(state: CompactReviewStateV2): unknown {
	return {
		schema: state.schema,
		lineage_id: state.lineage_id,
		generation: state.generation,
		mode: state.mode,
		initial_snapshot: state.initial_snapshot,
		genesis_paths: state.genesis_paths,
		intended_untracked: state.intended_untracked,
		policy_hash: state.policy_hash,
		risk_tier: state.risk_tier,
		selected_lenses: state.selected_lenses,
		original_changed_lines: state.original_changed_lines,
		correction_budget: state.correction_budget,
		runtime_identity: state.runtime_identity,
	};
}

function assertSuccessor(
	previous: CompactReviewStateV2,
	next: CompactReviewStateV2,
	operation: CompactStoreOperation,
): void {
	if (!equal(immutableBinding(previous), immutableBinding(next))) {
		throw new CompactReviewStoreError("Compact review scope, risk tier, policy, and budget are immutable");
	}
	if (
		previous.state === COMPACT_REVIEW_STATE.APPROVED ||
		previous.state === COMPACT_REVIEW_STATE.ESCALATED
	) {
		throw new CompactReviewStoreError("Terminal compact review authority is immutable");
	}
	if (operation === COMPACT_STORE_OPERATION.COMPLETE_REVIEW) {
		if (
			previous.state !== COMPACT_REVIEW_STATE.REVIEWING ||
			!stateIsOneOf(next.state, [COMPACT_REVIEW_STATE.CORRECTION_REQUIRED, COMPACT_REVIEW_STATE.VALIDATING, COMPACT_REVIEW_STATE.ESCALATED]) ||
			next.current_candidate_tree !== previous.current_candidate_tree ||
			next.correction !== undefined ||
			next.validation !== undefined ||
			next.final_evidence_hash !== undefined
		) {
			throw new CompactReviewStoreError("Invalid compact review completion successor");
		}
		return;
	}
	if (operation === COMPACT_STORE_OPERATION.BEGIN_CORRECTION) {
		if (
			previous.state !== COMPACT_REVIEW_STATE.CORRECTION_REQUIRED ||
			previous.correction_line_forecast !== undefined ||
			next.correction_line_forecast === undefined ||
			!stateIsOneOf(next.state, [COMPACT_REVIEW_STATE.CORRECTION_REQUIRED, COMPACT_REVIEW_STATE.ESCALATED])
		) {
			throw new CompactReviewStoreError("Invalid compact correction forecast successor");
		}
		const expected = clone(previous);
		expected.correction_line_forecast = next.correction_line_forecast;
		expected.state = next.state;
		expected.escalation_reasons = next.escalation_reasons;
		if (!equal(expected, next)) throw new CompactReviewStoreError("Compact correction forecast changed unrelated state");
		return;
	}
	if (operation === COMPACT_STORE_OPERATION.FREEZE_VALIDATOR_REQUEST) {
		if (
			previous.state !== COMPACT_REVIEW_STATE.CORRECTION_REQUIRED ||
			previous.correction_line_forecast === undefined ||
			previous.validator_request !== undefined ||
			next.validator_request === undefined
		) {
			throw new CompactReviewStoreError("Invalid compact validator request successor");
		}
		const expected = clone(previous);
		expected.validator_request = next.validator_request;
		if (!equal(expected, next)) throw new CompactReviewStoreError("Compact validator request changed unrelated state");
		return;
	}
	if (operation === COMPACT_STORE_OPERATION.COMPLETE_CORRECTION) {
		if (
			previous.state !== COMPACT_REVIEW_STATE.CORRECTION_REQUIRED ||
			previous.correction_line_forecast === undefined ||
			!stateIsOneOf(next.state, [COMPACT_REVIEW_STATE.VALIDATING, COMPACT_REVIEW_STATE.ESCALATED]) ||
			!next.correction ||
			!next.validation ||
			!previous.validator_request ||
			!equal(previous.validator_request, next.validator_request) ||
			next.final_evidence_hash !== undefined ||
			!equal(previous.lens_results, next.lens_results) ||
			!equal(previous.findings, next.findings) ||
			!equal(previous.outcomes, next.outcomes) ||
			!equal(previous.correction_ids, next.correction_ids)
		) {
			throw new CompactReviewStoreError("Invalid compact correction completion successor");
		}
		return;
	}
	if (operation === COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION) {
		if (
			previous.state !== COMPACT_REVIEW_STATE.VALIDATING ||
			!stateIsOneOf(next.state, [COMPACT_REVIEW_STATE.APPROVED, COMPACT_REVIEW_STATE.ESCALATED]) ||
			!DIGEST.test(next.final_evidence_hash ?? "")
		) {
			throw new CompactReviewStoreError("Invalid compact final verification successor");
		}
		const expected = clone(previous);
		expected.state = next.state;
		expected.final_evidence_hash = next.final_evidence_hash;
		expected.escalation_reasons = next.escalation_reasons;
		if (!equal(expected, next)) throw new CompactReviewStoreError("Compact verification changed unrelated state");
		return;
	}
	throw new CompactReviewStoreError(`Unsupported compact store operation: ${operation}`);
}

function graphCurrentExists(authority: RepositoryAuthorityV1): boolean {
	const graphRoot = join(authority.store_root, "graph-v1");
	return [0, 1, 2].some((slot) => existsSync(join(graphRoot, `CURRENT.${slot}`)));
}

export function hasGraphV1Authority(cwd: string): boolean {
	return graphCurrentExists(resolveRepositoryAuthorityV1(cwd));
}

export function graphV1LineageExists(cwd: string, lineageId: string): boolean {
	const authority = resolveRepositoryAuthorityV1(cwd);
	if (!graphCurrentExists(authority)) return false;
	try {
		ReviewTransactionStore.forRepository(cwd).read(lineageId);
		return true;
	} catch (error) {
		if (error instanceof Error && /Graph lineage is missing from authoritative root set/.test(error.message)) return false;
		throw error;
	}
}

export class CompactReviewStoreV2 {
	readonly root: string;
	readonly lineageDirectory: string;
	readonly statePath: string;
	readonly receiptPath: string;
	readonly #lineageId: string;
	readonly #cwd: string;
	readonly #authority: RepositoryAuthorityV1;
	readonly #lock: ReviewMutationLockV1;
	readonly #faultInjector?: CompactReviewStoreOptions["faultInjector"];

	static forRepository(
		cwd: string,
		lineageId: string,
		options: CompactReviewStoreOptions = {},
	): CompactReviewStoreV2 {
		if (!LINEAGE_ID.test(lineageId)) throw new CompactReviewStoreError("Compact lineage ID is invalid");
		const authority = resolveRepositoryAuthorityV1(cwd);
		return new CompactReviewStoreV2(cwd, authority, lineageId, options);
	}

	private constructor(
		cwd: string,
		authority: RepositoryAuthorityV1,
		lineageId: string,
		options: CompactReviewStoreOptions,
	) {
		this.#cwd = cwd;
		this.#authority = authority;
		this.#lineageId = lineageId;
		this.root = assertManagedStorePathV1(authority.common_directory, join(authority.store_root, "compact-v2"));
		this.lineageDirectory = assertManagedStorePathV1(authority.common_directory, join(this.root, lineageId));
		this.statePath = join(this.lineageDirectory, "review-state.json");
		this.receiptPath = join(this.lineageDirectory, "review-receipt.json");
		this.#lock = new ReviewMutationLockV1(
			join(authority.store_root, "control"),
			authority.repository_id,
			authority.authority_id,
			options.mutationLockPlatform,
		);
		this.#faultInjector = options.faultInjector;
	}

	load(): CompactStateRecordV2 {
		try {
			const record = parseRecord(readFileSync(this.statePath, "utf8"), this.#lineageId);
			this.assertRuntimeIdentity(record.state);
			return record;
		} catch (error) {
			if (error instanceof CompactReviewStoreError) throw error;
			throw new CompactReviewStoreError(`Compact review state is unavailable: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	replace(
		expectedRevision: string,
		operation: CompactStoreOperation,
		nextState: CompactReviewStateV2,
	): string {
		assertCompactReviewState(nextState);
		this.assertRuntimeIdentity(nextState);
		if (nextState.lineage_id !== this.#lineageId) throw new CompactReviewStoreError("Compact state lineage does not match the store");
		const owner = this.#lock.acquire();
		try {
			this.assertCurrentAuthority();
			const current = existsSync(this.statePath) ? this.load() : undefined;
			const next = recordFor(nextState);
			if (current && current.revision === next.revision && equal(current.state, next.state)) {
				if (!operationMatchesState(operation, next.state)) {
					throw new CompactReviewStoreError("Compact exact retry operation does not match the persisted state transition");
				}
				return current.revision;
			}
			if ((current?.revision ?? "") !== expectedRevision) {
				throw new CompactReviewStoreError(`Compact compare-and-swap failed: expected ${expectedRevision || "<empty>"}, current ${current?.revision ?? "<empty>"}`);
			}
			if (!current) {
				if (operation !== COMPACT_STORE_OPERATION.START || next.state.state !== COMPACT_REVIEW_STATE.REVIEWING) {
					throw new CompactReviewStoreError("Compact authority must start in reviewing state");
				}
				if (graphV1LineageExists(this.#cwd, this.#lineageId)) {
					throw new CompactReviewStoreError("Graph-v1 and compact-v2 authority are ambiguous for this lineage");
				}
				const risk = deriveReviewSnapshotRisk(next.state.initial_snapshot);
				if (
					risk.tier !== next.state.risk_tier ||
					risk.original_changed_lines !== next.state.original_changed_lines ||
					risk.correction_budget !== next.state.correction_budget ||
					!equal(risk.selected_lenses, next.state.selected_lenses) ||
					!equal(discoverReviewUntrackedPaths(this.#cwd), next.state.intended_untracked) ||
					captureCurrentReviewCandidateTree(next.state.initial_snapshot) !== next.state.initial_snapshot.initial_review_tree
				) {
					throw new CompactReviewStoreError("Compact authored-risk baseline does not match repository evidence");
				}
			} else {
				assertSuccessor(current.state, next.state, operation);
				if (operation === COMPACT_STORE_OPERATION.BEGIN_CORRECTION && (
					captureCurrentReviewCandidateTree(current.state.initial_snapshot) !== current.state.initial_snapshot.initial_review_tree ||
					!equal(discoverReviewUntrackedPaths(this.#cwd), current.state.intended_untracked)
				)) {
					throw new CompactReviewStoreError("Compact correction forecast must be recorded before editing the frozen candidate");
				}
				if (operation === COMPACT_STORE_OPERATION.COMPLETE_CORRECTION) {
					const derived = captureOrdinaryCorrectionSnapshot(
						next.state.initial_snapshot,
						next.state.current_candidate_tree,
					);
					if (
						!next.state.correction ||
						derived.candidate_tree !== next.state.correction.candidate_tree ||
						derived.changed_lines !== next.state.correction.changed_lines ||
						derived.fix_diff_hash !== next.state.correction.fix_diff_hash ||
						!equal(derived.changed_paths, next.state.correction.changed_paths) ||
						!equal(discoverReviewUntrackedPaths(this.#cwd), next.state.intended_untracked)
					) {
						throw new CompactReviewStoreError("Compact correction does not match repository-derived evidence");
					}
				}
			}
			this.writeAtomic(this.statePath, `${JSON.stringify(next, null, 2)}\n`, "before-state-rename");
			return this.load().revision;
		} finally {
			this.#lock.release(owner);
		}
	}

	materializeTerminalReceipt(): CompactReceiptEnvelopeV2 {
		const owner = this.#lock.acquire();
		try {
			this.assertCurrentAuthority();
			const record = this.load();
			const receipt = createCompactReceipt(record.state, record.revision);
			if (existsSync(this.receiptPath)) {
				const existing = this.readReceiptFile();
				if (!equal(existing, receipt)) throw new CompactReviewStoreError("Existing compact receipt conflicts with terminal authority");
			} else {
				this.writeAtomic(this.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "before-receipt-rename");
			}
			const reloadedState = this.load();
			const reloadedReceipt = this.readReceiptFile();
			if (
				reloadedState.revision !== record.revision ||
				!equal(reloadedReceipt, createCompactReceipt(reloadedState.state, reloadedState.revision))
			) {
				throw new CompactReviewStoreError("Compact receipt readback does not match reloaded terminal authority");
			}
			return reloadedReceipt;
		} finally {
			this.#lock.release(owner);
		}
	}

	loadTerminalReceipt(): { record: CompactStateRecordV2; receipt: CompactReceiptEnvelopeV2 } {
		const record = this.load();
		const receipt = this.readReceiptFile();
		const expected = createCompactReceipt(record.state, record.revision);
		if (!equal(receipt, expected)) throw new CompactReviewStoreError("Compact receipt does not match current terminal authority");
		return { record, receipt };
	}

	private readReceiptFile(): CompactReceiptEnvelopeV2 {
		let value: unknown;
		try {
			value = JSON.parse(readFileSync(this.receiptPath, "utf8"));
		} catch {
			throw new CompactReviewStoreError("Compact review receipt is unavailable or malformed");
		}
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CompactReviewStoreError("Compact review receipt must be an object");
		assertExactKeys(value, new Set(["body", "receipt_hash"]), "Compact review receipt");
		const receipt = value as CompactReceiptEnvelopeV2;
		assertObject(receipt.body, "Compact review receipt body");
		assertExactKeys(receipt.body, RECEIPT_BODY_KEYS, "Compact review receipt body");
		assertCompactReceipt(receipt);
		return clone(receipt);
	}

	private assertRuntimeIdentity(state: CompactReviewStateV2): void {
		try {
			assertLoadedReviewRuntimeIdentity(state.runtime_identity);
		} catch {
			throw new CompactReviewStoreError("Persisted compact runtime identity is incompatible: REVIEW_RUNTIME_INCOMPATIBLE");
		}
	}

	private assertCurrentAuthority(): void {
		const current = resolveRepositoryAuthorityV1(this.#cwd);
		if (
			current.common_directory !== this.#authority.common_directory ||
			current.repository_id !== this.#authority.repository_id ||
			current.authority_id !== this.#authority.authority_id
		) {
			throw new CompactReviewStoreError("Repository authority changed before compact mutation");
		}
	}

	private writeAtomic(
		path: string,
		content: string,
		faultPoint: "before-state-rename" | "before-receipt-rename",
	): void {
		mkdirSync(this.lineageDirectory, { recursive: true, mode: 0o700 });
		chmodSync(this.root, 0o700);
		chmodSync(this.lineageDirectory, 0o700);
		const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
		try {
			writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
			const file = openSync(temporary, "r+");
			try { fsyncSync(file); } finally { closeSync(file); }
			this.#faultInjector?.(faultPoint);
			renameSync(temporary, path);
			if (process.platform !== "win32") {
				const directory = openSync(this.lineageDirectory, "r");
				try { fsyncSync(directory); } finally { closeSync(directory); }
			}
		} finally {
			rmSync(temporary, { force: true });
		}
	}
}

export function discoverCompactReviewStores(cwd: string): CompactReviewStoreV2[] {
	const authority = resolveRepositoryAuthorityV1(cwd);
	const root = assertManagedStorePathV1(authority.common_directory, join(authority.store_root, "compact-v2"));
	if (!existsSync(root)) return [];
	const rootStat = lstatSync(root);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
		throw new CompactReviewStoreError("Invalid compact authority entry: compact-v2 root is not a real directory");
	}
	const entries = readdirSync(root, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.isSymbolicLink() || !LINEAGE_ID.test(entry.name)) {
			throw new CompactReviewStoreError(`Invalid compact authority entry: ${entry.name}`);
		}
	}
	return entries
		.map((entry) => CompactReviewStoreV2.forRepository(cwd, entry.name))
		.toSorted((left, right) => left.lineageDirectory.localeCompare(right.lineageDirectory));
}

export function compactV2LineageExists(cwd: string, lineageId: string): boolean {
	const store = CompactReviewStoreV2.forRepository(cwd, lineageId);
	return existsSync(store.statePath) && statSync(store.statePath).isFile();
}

export function inspectCompactReviewAuthorityV2(cwd: string): CompactAuthorityInspectionV2 {
	const lineages: CompactAuthorityLineageV2[] = [];
	try {
		for (const store of discoverCompactReviewStores(cwd)) {
			const record = store.load();
			lineages.push({
				lineage_id: record.state.lineage_id,
				state: record.state.state,
				revision: record.revision,
			});
		}
	} catch {
		return { outcome: COMPACT_AUTHORITY_OUTCOME.INVALID, lineages };
	}
	if (lineages.length === 0) return { outcome: COMPACT_AUTHORITY_OUTCOME.NONE, lineages };
	if (lineages.some((lineage) =>
		lineage.state !== COMPACT_REVIEW_STATE.APPROVED &&
		lineage.state !== COMPACT_REVIEW_STATE.ESCALATED
	)) {
		return { outcome: COMPACT_AUTHORITY_OUTCOME.ACTIVE, lineages };
	}
	if (lineages.some((lineage) => lineage.state === COMPACT_REVIEW_STATE.ESCALATED)) {
		return { outcome: COMPACT_AUTHORITY_OUTCOME.ESCALATED, lineages };
	}
	if (lineages.some((lineage) => lineage.state === COMPACT_REVIEW_STATE.APPROVED)) {
		return { outcome: COMPACT_AUTHORITY_OUTCOME.APPROVED, lineages };
	}
	throw new CompactReviewStoreError("Compact authority inspection found no terminal or active lineage");
}
