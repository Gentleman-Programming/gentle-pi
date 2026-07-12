import { execFileSync } from "node:child_process";
import {
	closeSync,
	fsyncSync,
	linkSync,
	mkdirSync,
	openSync,
	lstatSync,
	readFileSync,
	existsSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { canonicalJsonV1, domainHashV1, parseCanonicalJsonV1 } from "./review-canonical.ts";
import { COMPACT_REVIEW_STATE, type CompactReviewStateV2 } from "./review-compact.ts";
import { CompactReviewStoreV2, discoverCompactReviewStores, hasGraphV1Authority } from "./review-compact-store.ts";
import { ReviewGraphObjectStoreV1 } from "./review-object-store.ts";
import { assertManagedStorePathV1, resolveRepositoryAuthorityV1, reviewGitEnvironment, type RepositoryAuthorityV1 } from "./review-repository.ts";
import { ReviewMutationLockV1, type ReviewLockPlatformAdapterV1 } from "./review-lock.ts";
import { discoverReviewUntrackedPaths } from "./review-snapshot.ts";
import { assertFrozenLedgerIntegrity, canonicalHash, createReceiptForState, validateReviewGraphReplayV1, type ReviewStateV1 } from "./review-transaction.ts";

const DIGEST = /^[0-9a-f]{64}$/;
const OPERATION_ID = /^[0-9a-f]{64}$/;
const CHANGE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export const REVIEW_AUTHORITY_SUPERSESSION_ERROR = {
	INVALID: "REVIEW_SUPERSESSION_INVALID",
	INELIGIBLE_SOURCE: "REVIEW_SUPERSESSION_INELIGIBLE_SOURCE",
	EQUIVALENCE_MISMATCH: "REVIEW_SUPERSESSION_EQUIVALENCE_MISMATCH",
	OPERATION_CONFLICT: "REVIEW_SUPERSESSION_OPERATION_CONFLICT",
	CHAIN_AMBIGUOUS: "REVIEW_SUPERSESSION_CHAIN_AMBIGUOUS",
	UNTRACKED_DRIFT: "REVIEW_SUPERSESSION_UNTRACKED_DRIFT",
	STALE_AUTHORIZATION: "REVIEW_SUPERSESSION_STALE_AUTHORIZATION",
	REPOSITORY_MISMATCH: "REVIEW_SUPERSESSION_REPOSITORY_MISMATCH",
	RACE_UNSAFE: "REVIEW_SUPERSESSION_RACE_UNSAFE",
} as const;

export type ReviewAuthoritySupersessionErrorCode =
	(typeof REVIEW_AUTHORITY_SUPERSESSION_ERROR)[keyof typeof REVIEW_AUTHORITY_SUPERSESSION_ERROR];

export class ReviewAuthoritySupersessionError extends Error {
	readonly code: ReviewAuthoritySupersessionErrorCode;

	constructor(code: ReviewAuthoritySupersessionErrorCode, message: string) {
		super(`${code}: ${message}`);
		this.name = "ReviewAuthoritySupersessionError";
		this.code = code;
	}
}

export interface RepositoryBindingV1 {
	repository_id: string;
	authority_id: string;
	common_directory_hash: string;
	repository_identity_hash: string;
}

export interface OpenSpecChangeBindingV1 {
	change_name: string;
	change_name_hash: string;
	change_root_relative_path: string;
}

export interface GraphAuthorityBindingV1 {
	format: "graph-v1";
	lineage_id: string;
	head_event_id: string;
	head_sequence: number;
	reduced_state_hash: string;
	source_closure_hash: string;
	receipt_hash: string;
	frozen_ledger_hash: string;
}

export interface CompactAuthorityBindingV1 {
	format: "compact-v2";
	lineage_id: string;
	authority_revision: string;
	state_hash: string;
	receipt_hash: string;
	ledger_hash: string;
	runtime_identity_hash: string;
}

export const INTENDED_UNTRACKED_PROOF_STATE = {
	ALL_UNTRACKED: "all-untracked",
	COMPLETE_INDEX: "complete-index",
} as const;

export type IntendedUntrackedProofStateV1 =
	(typeof INTENDED_UNTRACKED_PROOF_STATE)[keyof typeof INTENDED_UNTRACKED_PROOF_STATE];

export interface IntendedUntrackedProofV1 {
	state: IntendedUntrackedProofStateV1;
	candidate_tree: string;
	index_tree: string | null;
	paths: string[];
	proof_hash: string;
}

export interface RecoveryEquivalenceBindingV1 {
	base_tree: string;
	complete_snapshot_tree: string;
	initial_review_tree: string;
	final_candidate_tree: string;
	review_projection_hash: string;
	genesis_paths_hash: string;
	scope_digest: string;
	intended_untracked_hash: string;
	intended_untracked_proof_hash: string;
	policy_hash: string;
	policy_evidence_hash: string;
	source_receipt_hash: string;
	successor_receipt_hash: string;
	source_ledger_hash: string;
	successor_ledger_hash: string;
}

export interface SupersessionBodyV1 {
	schema: "gentle-ai.review-authority-supersession/v1";
	operation_id: string;
	request_hash: string;
	sequence: number;
	predecessor_recovery_id: string | null;
	repository: RepositoryBindingV1;
	change: OpenSpecChangeBindingV1;
	source: GraphAuthorityBindingV1;
	successor: CompactAuthorityBindingV1;
	equivalence: RecoveryEquivalenceBindingV1;
	authorization_hash: string;
}

export interface SupersessionEnvelopeV1 {
	body: SupersessionBodyV1;
	recovery_id: string;
}

/** Read-only inspection result required before a graph-v1 source can be superseded. */
export interface RecoverableSourceEligibilityV1 {
	repository: RepositoryBindingV1;
	change: OpenSpecChangeBindingV1;
	source: GraphAuthorityBindingV1;
	immutable: boolean;
	readable: boolean;
	graph_replay_valid: boolean;
	receipt_valid: boolean;
	frozen_ledger_valid: boolean;
	identity_broken: boolean;
	reset_in_progress: boolean;
	mixed_authority: boolean;
	duplicate_authority: boolean;
}

/** Independently derived evidence from one authority; it is never supplied by a controller hash. */
export interface RecoveryAuthorityEvidenceV1 {
	base_tree: string;
	complete_snapshot_tree: string;
	initial_review_tree: string;
	final_candidate_tree: string;
	review_projection_hash: string;
	genesis_paths_hash: string;
	scope_digest: string;
	intended_untracked_hash: string;
	intended_untracked_proof_hash: string;
	policy_hash: string;
	policy_evidence_hash: string;
	receipt_hash: string;
	ledger_hash: string;
}

export interface RecoverySuccessorEquivalenceV1 {
	repository: RepositoryBindingV1;
	change: OpenSpecChangeBindingV1;
	source: GraphAuthorityBindingV1;
	successor: CompactAuthorityBindingV1;
	source_evidence: RecoveryAuthorityEvidenceV1;
	successor_evidence: RecoveryAuthorityEvidenceV1;
}

export interface PrepareSupersessionInputV1 {
	operation_id: string;
	eligibility: RecoverableSourceEligibilityV1;
	equivalence: RecoverySuccessorEquivalenceV1;
	predecessor_recovery_id?: string | null;
	sequence?: number;
}

export interface PreparedSupersessionV1 {
	body: SupersessionBodyV1;
	request_hash: string;
	challenge: string;
}

function assertDigest(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !DIGEST.test(value)) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, `${field} must be a SHA-256 digest`);
	}
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, `${field} must be an object`);
	}
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
	if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, `${field} has an invalid schema`);
	}
}

function assertBinding(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
	assertObject(value, field);
	assertExactKeys(value, keys, field);
	for (const key of keys) {
		if (key !== "format" && key !== "lineage_id" && key !== "head_sequence") assertDigest(value[key], `${field}.${key}`);
	}
	return value;
}

function assertBody(value: unknown): asserts value is SupersessionBodyV1 {
	assertObject(value, "body");
	assertExactKeys(value, ["schema", "operation_id", "request_hash", "sequence", "predecessor_recovery_id", "repository", "change", "source", "successor", "equivalence", "authorization_hash"], "body");
	if (value.schema !== "gentle-ai.review-authority-supersession/v1") throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "unsupported supersession schema");
	if (typeof value.operation_id !== "string" || !OPERATION_ID.test(value.operation_id)) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "operation_id must be a digest");
	assertDigest(value.request_hash, "request_hash");
	assertDigest(value.authorization_hash, "authorization_hash");
	if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "sequence must be a non-negative integer");
	if (value.predecessor_recovery_id !== null) assertDigest(value.predecessor_recovery_id, "predecessor_recovery_id");
	assertRepositoryBinding(value.repository);
	assertChangeBinding(value.change);
	assertSourceBinding(value.source);
	assertSuccessorBinding(value.successor);
	assertBinding(value.equivalence, ["base_tree", "complete_snapshot_tree", "initial_review_tree", "final_candidate_tree", "review_projection_hash", "genesis_paths_hash", "scope_digest", "intended_untracked_hash", "intended_untracked_proof_hash", "policy_hash", "policy_evidence_hash", "source_receipt_hash", "successor_receipt_hash", "source_ledger_hash", "successor_ledger_hash"], "equivalence");
}

function assertRecoveryEvidence(value: unknown, field: string): asserts value is RecoveryAuthorityEvidenceV1 {
	assertObject(value, field);
	const keys = ["base_tree", "complete_snapshot_tree", "initial_review_tree", "final_candidate_tree", "review_projection_hash", "genesis_paths_hash", "scope_digest", "intended_untracked_hash", "intended_untracked_proof_hash", "policy_hash", "policy_evidence_hash", "receipt_hash", "ledger_hash"] as const;
	assertExactKeys(value, keys, field);
	for (const key of keys) assertDigest(value[key], `${field}.${key}`);
}

function assertSourceBinding(value: unknown): asserts value is GraphAuthorityBindingV1 {
	const source = assertBinding(value, ["format", "lineage_id", "head_event_id", "head_sequence", "reduced_state_hash", "source_closure_hash", "receipt_hash", "frozen_ledger_hash"], "source");
	if (source.format !== "graph-v1" || typeof source.lineage_id !== "string" || !source.lineage_id || !Number.isSafeInteger(source.head_sequence) || (source.head_sequence as number) < 0) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "source binding is invalid");
	}
}

function assertSuccessorBinding(value: unknown): asserts value is CompactAuthorityBindingV1 {
	const successor = assertBinding(value, ["format", "lineage_id", "authority_revision", "state_hash", "receipt_hash", "ledger_hash", "runtime_identity_hash"], "successor");
	if (successor.format !== "compact-v2" || typeof successor.lineage_id !== "string" || !successor.lineage_id) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "successor binding is invalid");
	}
}

function assertRepositoryBinding(value: unknown): asserts value is RepositoryBindingV1 {
	assertBinding(value, ["repository_id", "authority_id", "common_directory_hash", "repository_identity_hash"], "repository");
}

function assertChangeBinding(value: unknown): asserts value is OpenSpecChangeBindingV1 {
	assertObject(value, "change");
	assertExactKeys(value, ["change_name", "change_name_hash", "change_root_relative_path"], "change");
	if (typeof value.change_name !== "string" || !CHANGE_NAME.test(value.change_name) || value.change_root_relative_path !== `openspec/changes/${value.change_name}`) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "change binding is not canonical");
	assertDigest(value.change_name_hash, "change.change_name_hash");
	if (value.change_name_hash !== domainHashV1("openspec-change-name", value.change_name)) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "change binding hash does not match the canonical change name");
	}
}

export function assertRecoverableSourceEligibilityV1(input: unknown): RecoverableSourceEligibilityV1 {
	assertObject(input, "source eligibility");
	const keys = ["repository", "change", "source", "immutable", "readable", "graph_replay_valid", "receipt_valid", "frozen_ledger_valid", "identity_broken", "reset_in_progress", "mixed_authority", "duplicate_authority"] as const;
	assertExactKeys(input, keys, "source eligibility");
	assertRepositoryBinding(input.repository);
	assertChangeBinding(input.change);
	assertSourceBinding(input.source);
	for (const key of keys.slice(3)) if (typeof input[key] !== "boolean") throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, `source eligibility.${key} must be boolean`);
	if (!input.immutable || !input.readable || !input.graph_replay_valid || !input.receipt_valid || !input.frozen_ledger_valid || input.identity_broken || input.reset_in_progress || input.mixed_authority || input.duplicate_authority) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INELIGIBLE_SOURCE, "source is not one readable immutable unambiguous approved graph-v1 authority");
	}
	return input as RecoverableSourceEligibilityV1;
}

function assertCanonicalRepositoryPathV1(path: string): void {
	if (!path || path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, "intended-untracked path is not canonical");
	}
}

function runProofGitV1(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: reviewGitEnvironment(),
	}).trim();
}

function candidateTreeEntryV1(cwd: string, candidateTree: string, path: string): { mode: string; object: string } {
	const entry = execFileSync("git", ["ls-tree", "-z", candidateTree, "--", path], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: reviewGitEnvironment(),
	});
	const record = entry.split("\0").filter(Boolean);
	if (record.length !== 1) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, `candidate tree is missing intended-untracked path ${path}`);
	}
	const match = /^(100644|100755|120000) blob ([0-9a-f]{40,64})\t/.exec(record[0]!);
	if (!match) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, `candidate tree has an invalid intended-untracked entry for ${path}`);
	}
	return { mode: match[1]!, object: match[2]! };
}

function workingTreeEntryV1(cwd: string, path: string): { mode: string; object: string } {
	const entry = lstatSync(join(cwd, path));
	const mode = entry.isSymbolicLink() ? "120000" : entry.isFile() ? (entry.mode & 0o111 ? "100755" : "100644") : null;
	if (mode === null) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, `intended-untracked path is not a file or symlink: ${path}`);
	}
	return { mode, object: runProofGitV1(cwd, ["hash-object", "--path", path, path]) };
}

/**
 * Re-derives the only two permitted live states for frozen intended-untracked paths.
 * It never trusts a prior proof: every path, blob, mode, untracked set, and index tree
 * is read from the repository at invocation time.
 */
export function deriveIntendedUntrackedProofV1(cwd: string, candidateTree: string, intendedPaths: readonly string[]): IntendedUntrackedProofV1 {
	const paths = [...intendedPaths];
	if (paths.length === 0 || new Set(paths).size !== paths.length) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, "intended-untracked paths must be a non-empty unique set");
	}
	for (const path of paths) assertCanonicalRepositoryPathV1(path);
	paths.sort();
	const root = runProofGitV1(cwd, ["rev-parse", "--show-toplevel"]);
	const resolvedCandidate = runProofGitV1(root, ["rev-parse", `${candidateTree}^{tree}`]);
	const untracked = discoverReviewUntrackedPaths(root);
	const allUntracked = untracked.length === paths.length && untracked.every((path, index) => path === paths[index]);
	if (allUntracked) {
		for (const path of paths) {
			const candidate = candidateTreeEntryV1(root, resolvedCandidate, path);
			const working = workingTreeEntryV1(root, path);
			if (candidate.mode !== working.mode || candidate.object !== working.object) {
				throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, `working-tree content or mode drifted for ${path}`);
			}
		}
		const state = INTENDED_UNTRACKED_PROOF_STATE.ALL_UNTRACKED;
		return { state, candidate_tree: resolvedCandidate, index_tree: null, paths, proof_hash: domainHashV1("review-intended-untracked-proof", { state, candidate_tree: resolvedCandidate, paths }) };
	}
	if (untracked.length !== 0) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, "intended-untracked paths are in a mixed, missing, or extra untracked state");
	}
	for (const path of paths) {
		if (!runProofGitV1(root, ["ls-files", "--error-unmatch", "--", path])) {
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, `index is missing intended-untracked path ${path}`);
		}
	}
	const indexTree = runProofGitV1(root, ["write-tree"]);
	if (indexTree !== resolvedCandidate) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT, "complete index tree does not exactly match the approved candidate");
	}
	const state = INTENDED_UNTRACKED_PROOF_STATE.COMPLETE_INDEX;
	return { state, candidate_tree: resolvedCandidate, index_tree: indexTree, paths, proof_hash: domainHashV1("review-intended-untracked-proof", { state, candidate_tree: resolvedCandidate, index_tree: indexTree, paths }) };
}

export function assertRecoverySuccessorEquivalenceV1(input: unknown): RecoverySuccessorEquivalenceV1 {
	assertObject(input, "successor equivalence");
	assertExactKeys(input, ["repository", "change", "source", "successor", "source_evidence", "successor_evidence"], "successor equivalence");
	assertRepositoryBinding(input.repository);
	assertChangeBinding(input.change);
	assertSourceBinding(input.source);
	assertSuccessorBinding(input.successor);
	assertRecoveryEvidence(input.source_evidence, "source evidence");
	assertRecoveryEvidence(input.successor_evidence, "successor evidence");
	const source = input.source_evidence;
	const successor = input.successor_evidence;
	const shared = ["base_tree", "complete_snapshot_tree", "initial_review_tree", "final_candidate_tree", "review_projection_hash", "genesis_paths_hash", "scope_digest", "intended_untracked_hash", "intended_untracked_proof_hash", "policy_hash", "policy_evidence_hash"] as const;
	if (shared.some((key) => source[key] !== successor[key]) || source.receipt_hash !== input.source.receipt_hash || source.ledger_hash !== input.source.frozen_ledger_hash || successor.receipt_hash !== input.successor.receipt_hash || successor.ledger_hash !== input.successor.ledger_hash) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.EQUIVALENCE_MISMATCH, "source and successor do not prove complete target and evidence equivalence");
	}
	return input as RecoverySuccessorEquivalenceV1;
}

function repositoryBindingV1(cwd: string): RepositoryBindingV1 {
	const authority = resolveRepositoryAuthorityV1(cwd);
	return {
		repository_id: authority.repository_id,
		authority_id: authority.authority_id,
		common_directory_hash: domainHashV1("common-directory", authority.common_directory),
		repository_identity_hash: domainHashV1("repository-identity", authority.repository_identity),
	};
}

function assertNoSupersessionResetInProgressV1(storeRoot: string): void {
	const resetPath = join(storeRoot, "control", "reset-state.json");
	if (!existsSync(resetPath)) return;
	try {
		const reset = JSON.parse(readFileSync(resetPath, "utf8")) as { body?: { phase?: unknown } };
		if (reset.body?.phase === "complete") return;
	} catch {
		// An unreadable reset marker is authority ambiguity, never permission to recover.
	}
	throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INELIGIBLE_SOURCE, "destructive reset is in progress or unreadable");
}

function changeBindingV1(changeName: string): OpenSpecChangeBindingV1 {
	if (!CHANGE_NAME.test(changeName)) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "change name is not canonical");
	return { change_name: changeName, change_name_hash: domainHashV1("openspec-change-name", changeName), change_root_relative_path: `openspec/changes/${changeName}` };
}

/** Read a graph-v1 source directly from its immutable repository store without mutation. */
export function hasEligibleGraphV1RecoveryAuthorityV1(cwd: string): boolean {
	if (!hasGraphV1Authority(cwd)) return false;
	try {
		const authority = resolveRepositoryAuthorityV1(cwd);
		assertNoSupersessionResetInProgressV1(authority.store_root);
		const graph = new ReviewGraphObjectStoreV1(join(authority.store_root, "graph-v1"), authority.repository_id, authority.authority_id);
		const entries = graph.readCurrent().body.lineages as Array<Record<string, unknown>>;
		for (const entry of entries) {
			if (entry.mode !== "graph") continue;
			if (typeof entry.lineage_id !== "string" || typeof entry.head_event_id !== "string" || typeof entry.sequence !== "number" || typeof entry.reduced_state_hash !== "string") {
				throw new Error("graph authority head is malformed");
			}
			const reversed: ReturnType<ReviewGraphObjectStoreV1["readEvent"]>[] = [];
			let eventId: string | null = entry.head_event_id;
			let sequence = entry.sequence;
			while (eventId !== null) {
				const event = graph.readEvent(eventId);
				if (event.body.lineage_id !== entry.lineage_id || event.body.sequence !== sequence) throw new Error("graph authority closure is discontinuous");
				reversed.push(event);
				eventId = event.body.predecessor_event_id;
				sequence -= 1;
			}
			const state = validateReviewGraphReplayV1(reversed.reverse());
			if (state.mode !== "ordinary" || state.terminal_state !== "approved" || !state.frozen_ledger) continue;
			assertFrozenLedgerIntegrity(state.frozen_ledger);
			if (canonicalHash(state) !== entry.reduced_state_hash || createReceiptForState(state).body.terminal_state !== "approved") {
				throw new Error("graph authority replay or receipt is invalid");
			}
			return true;
		}
		return false;
	} catch (error) {
		if (error instanceof ReviewAuthoritySupersessionError) throw error;
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INELIGIBLE_SOURCE, `graph recovery eligibility inspection failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function inspectRecoverableGraphSourceV1(cwd: string, changeName: string, lineageId: string): RecoverableSourceEligibilityV1 {
	try {
		const authority = resolveRepositoryAuthorityV1(cwd);
		assertNoSupersessionResetInProgressV1(authority.store_root);
		const graph = new ReviewGraphObjectStoreV1(join(authority.store_root, "graph-v1"), authority.repository_id, authority.authority_id);
		const root = graph.readCurrent();
		const graphEntries = root.body.lineages as Array<Record<string, unknown>>;
		const entries = graphEntries.filter((entry) => entry.lineage_id === lineageId && entry.mode === "graph");
		if (entries.length !== 1) throw new Error("source lineage is absent or duplicated");
		const entry = entries[0]!;
		if (typeof entry.head_event_id !== "string" || typeof entry.sequence !== "number" || typeof entry.reduced_state_hash !== "string") throw new Error("source graph head is malformed");
		const reversed: ReturnType<ReviewGraphObjectStoreV1["readEvent"]>[] = [];
		let eventId: string | null = entry.head_event_id;
		let sequence = entry.sequence;
		while (eventId !== null) {
			const event = graph.readEvent(eventId);
			if (event.body.lineage_id !== lineageId || event.body.sequence !== sequence) throw new Error("source graph closure is discontinuous");
			reversed.push(event);
			eventId = event.body.predecessor_event_id;
			sequence -= 1;
		}
		const events = reversed.reverse();
		const state = validateReviewGraphReplayV1(events);
		if (state.mode !== "ordinary" || state.terminal_state !== "approved" || !state.frozen_ledger) throw new Error("source is not an approved ordinary graph lineage");
		assertFrozenLedgerIntegrity(state.frozen_ledger);
		const receipt = createReceiptForState(state);
		if (receipt.body.terminal_state !== "approved") throw new Error("source receipt is not approved");
		return assertRecoverableSourceEligibilityV1({
			repository: repositoryBindingV1(cwd),
			change: changeBindingV1(changeName),
			source: {
				format: "graph-v1", lineage_id: lineageId, head_event_id: entry.head_event_id, head_sequence: entry.sequence,
				reduced_state_hash: entry.reduced_state_hash, source_closure_hash: domainHashV1("graph-source-closure", events),
				receipt_hash: receipt.receipt_hash, frozen_ledger_hash: state.frozen_ledger.frozen_ledger_hash,
			},
			immutable: true, readable: true, graph_replay_valid: canonicalHash(state) === entry.reduced_state_hash,
			receipt_valid: true, frozen_ledger_valid: true, identity_broken: false, reset_in_progress: false, mixed_authority: false, duplicate_authority: false,
		});
	} catch (error) {
		if (error instanceof ReviewAuthoritySupersessionError) throw error;
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INELIGIBLE_SOURCE, `source inspection failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Load and validate an independently approved compact-v2 successor from its repository store. */
export function inspectApprovedCompactSuccessorV1(cwd: string, lineageId: string): CompactAuthorityBindingV1 {
	try {
		const claimants = discoverCompactReviewStores(cwd);
		if (claimants.length !== 1) {
			throw new Error("successor authority is absent or ambiguous");
		}
		const terminal = claimants[0]!.loadTerminalReceipt();
		if (terminal.record.state.lineage_id !== lineageId) {
			throw new Error("successor authority is claimed by another compact lineage");
		}
		if (terminal.record.state.state !== COMPACT_REVIEW_STATE.APPROVED) throw new Error("successor is not approved");
		return {
			format: "compact-v2", lineage_id: terminal.record.state.lineage_id, authority_revision: terminal.record.revision,
			state_hash: canonicalHash(terminal.record.state), receipt_hash: terminal.receipt.receipt_hash,
			ledger_hash: domainHashV1("compact-findings", terminal.record.state.findings), runtime_identity_hash: terminal.record.state.runtime_identity.identity_hash,
		};
	} catch (error) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INELIGIBLE_SOURCE, `successor inspection failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function prepareSupersessionV1(input: PrepareSupersessionInputV1): PreparedSupersessionV1 {
	if (typeof input.operation_id !== "string" || !OPERATION_ID.test(input.operation_id)) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "operation_id must be a digest");
	}
	const eligibility = assertRecoverableSourceEligibilityV1(input.eligibility);
	const equivalence = assertRecoverySuccessorEquivalenceV1(input.equivalence);
	if (
		canonicalJsonV1(eligibility.repository) !== canonicalJsonV1(equivalence.repository) ||
		canonicalJsonV1(eligibility.change) !== canonicalJsonV1(equivalence.change) ||
		canonicalJsonV1(eligibility.source) !== canonicalJsonV1(equivalence.source)
	) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.EQUIVALENCE_MISMATCH, "inspection identities do not bind the same source");
	}
	const predecessor = input.predecessor_recovery_id ?? null;
	if (predecessor !== null) assertDigest(predecessor, "predecessor_recovery_id");
	const sequence = input.sequence ?? 0;
	if (!Number.isSafeInteger(sequence) || sequence < 0) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "sequence must be a non-negative integer");
	}
	const equivalenceBinding: RecoveryEquivalenceBindingV1 = {
		base_tree: equivalence.source_evidence.base_tree,
		complete_snapshot_tree: equivalence.source_evidence.complete_snapshot_tree,
		initial_review_tree: equivalence.source_evidence.initial_review_tree,
		final_candidate_tree: equivalence.source_evidence.final_candidate_tree,
		review_projection_hash: equivalence.source_evidence.review_projection_hash,
		genesis_paths_hash: equivalence.source_evidence.genesis_paths_hash,
		scope_digest: equivalence.source_evidence.scope_digest,
		intended_untracked_hash: equivalence.source_evidence.intended_untracked_hash,
		intended_untracked_proof_hash: equivalence.source_evidence.intended_untracked_proof_hash,
		policy_hash: equivalence.source_evidence.policy_hash,
		policy_evidence_hash: equivalence.source_evidence.policy_evidence_hash,
		source_receipt_hash: eligibility.source.receipt_hash,
		successor_receipt_hash: equivalence.successor.receipt_hash,
		source_ledger_hash: eligibility.source.frozen_ledger_hash,
		successor_ledger_hash: equivalence.successor.ledger_hash,
	};
	const request = { operation_id: input.operation_id, sequence, predecessor_recovery_id: predecessor, repository: eligibility.repository, change: eligibility.change, source: eligibility.source, successor: equivalence.successor, equivalence: equivalenceBinding };
	const request_hash = domainHashV1("review-authority-supersession-request", request);
	const challenge = `SUPERSEDE REVIEW AUTHORITY ${eligibility.repository.repository_id} CHANGE ${eligibility.change.change_name}\nSOURCE graph-v1:${eligibility.source.lineage_id}@${eligibility.source.head_event_id}\nWITH compact-v2:${equivalence.successor.lineage_id}@${equivalence.successor.authority_revision}\nREQUEST ${request_hash}`;
	return {
		request_hash,
		challenge,
		body: {
			schema: "gentle-ai.review-authority-supersession/v1",
			...request,
			request_hash,
			authorization_hash: domainHashV1("review-authority-supersession-pending-authorization", { challenge, request_hash }),
		},
	};
}

export function createSupersessionEnvelopeV1(body: SupersessionBodyV1): SupersessionEnvelopeV1 {
	assertBody(body);
	const canonicalBody = JSON.parse(canonicalJsonV1(body)) as SupersessionBodyV1;
	return { body: canonicalBody, recovery_id: domainHashV1("review-authority-supersession", canonicalBody) };
}

export function parseSupersessionEnvelopeV1(input: string): SupersessionEnvelopeV1 {
	const parsed = parseCanonicalJsonV1(input);
	assertObject(parsed, "supersession envelope");
	assertExactKeys(parsed, ["body", "recovery_id"], "supersession envelope");
	assertBody(parsed.body);
	assertDigest(parsed.recovery_id, "recovery_id");
	const expected = createSupersessionEnvelopeV1(parsed.body);
	if (expected.recovery_id !== parsed.recovery_id) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "recovery_id does not bind the body");
	return expected;
}

/** Atomically append one operation record. Existing identical bytes are an idempotent retry. */
export interface SupersessionWriteOptionsV1 {
	faultInjector?: (point: "before-temp-fsync" | "before-link" | "after-link" | "before-directory-fsync") => void;
}

function fsyncDirectoryV1(directory: string): void {
	const handle = openSync(directory, "r");
	try { fsyncSync(handle); } finally { closeSync(handle); }
}

function fsyncSupersessionDirectoryV1(directory: string, options: SupersessionWriteOptionsV1): void {
	options.faultInjector?.("before-directory-fsync");
	fsyncDirectoryV1(directory);
}

export function writeSupersessionRecordV1(directory: string, envelope: SupersessionEnvelopeV1, options: SupersessionWriteOptionsV1 = {}): string {
	const canonical = createSupersessionEnvelopeV1(envelope.body);
	if (canonical.recovery_id !== envelope.recovery_id) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "envelope is not content-bound");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, `${canonical.body.operation_id}.json`);
	const bytes = canonicalJsonV1(canonical);
	try {
		const existing = readFileSync(path, "utf8");
		if (existing === bytes) {
			fsyncSupersessionDirectoryV1(directory, options);
			return path;
		}
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.OPERATION_CONFLICT, "operation ID already has different semantics");
	} catch (error) {
		if (error instanceof ReviewAuthoritySupersessionError) throw error;
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const temporary = join(directory, `.${canonical.body.operation_id}.${process.pid}.tmp`);
	try {
		writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
		options.faultInjector?.("before-temp-fsync");
		const file = openSync(temporary, "r");
		try { fsyncSync(file); } finally { closeSync(file); }
		options.faultInjector?.("before-link");
		try { linkSync(temporary, path); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = readFileSync(path, "utf8");
			if (existing !== bytes) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.OPERATION_CONFLICT, "operation ID already has different semantics");
		}
		options.faultInjector?.("after-link");
		fsyncSupersessionDirectoryV1(directory, options);
		return path;
	} finally {
		rmSync(temporary, { force: true });
	}
}

function chainError(message: string): never {
	throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, message);
}

/**
 * Read immutable records for one change and derive their sole linear head.
 * Filesystem ordering is deliberately ignored; every predecessor and sequence
 * is bound by record content.
 */
export function loadSupersessionChainV1(directory: string): SupersessionEnvelopeV1[] {
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const records: SupersessionEnvelopeV1[] = [];
	for (const name of names) {
		if (/^\.[0-9a-f]{64}\.\d+\.tmp$/.test(name)) continue;
		if (!/^[0-9a-f]{64}\.json$/.test(name)) chainError("supersession directory contains an unexpected entry");
		const path = join(directory, name);
		if (!lstatSync(path).isFile()) chainError("supersession record is not a regular file");
		const record = parseSupersessionEnvelopeV1(readFileSync(path, "utf8"));
		if (name !== `${record.body.operation_id}.json`) chainError("supersession record filename does not bind its operation");
		records.push(record);
	}
	if (records.length === 0) return [];
	const byRecoveryId = new Map(records.map((record) => [record.recovery_id, record]));
	if (byRecoveryId.size !== records.length) chainError("duplicate recovery identity");
	const children = new Map<string | null, SupersessionEnvelopeV1[]>();
	for (const record of records) {
		const predecessor = record.body.predecessor_recovery_id;
		if (predecessor !== null && !byRecoveryId.has(predecessor)) chainError("supersession predecessor is missing");
		const siblings = children.get(predecessor) ?? [];
		siblings.push(record);
		children.set(predecessor, siblings);
	}
	if ((children.get(null) ?? []).length !== 1) chainError("supersession chain must have one root");
	const chain: SupersessionEnvelopeV1[] = [];
	let current = children.get(null)![0]!;
	while (true) {
		if (current.body.sequence !== chain.length) chainError("supersession sequence is not contiguous");
		chain.push(current);
		const next = children.get(current.recovery_id) ?? [];
		if (next.length === 0) break;
		if (next.length !== 1) chainError("supersession chain forks");
		current = next[0]!;
	}
	if (chain.length !== records.length) chainError("supersession chain contains a cycle or disconnected record");
	return chain;
}


export interface SupersessionStoreOptionsV1 extends SupersessionWriteOptionsV1 {
	mutationLockPlatform?: ReviewLockPlatformAdapterV1;
}

export interface InstalledSupersessionV1 {
	recovery_id: string;
	path: string;
}

/** A caller-owned live observation that is checked only after acquiring the mutation lock. */
export interface SupersessionCasCheckV1 {
	label: string;
	expected: string;
	observe: () => string;
}

export interface SupersessionInstallOptionsV1 {
	casChecks?: readonly SupersessionCasCheckV1[];
}

/**
 * Repository-anchored append-only supersession storage. This is deliberately
 * storage-only: change-aware authority selection remains Task 4.
 */
export class SupersessionStoreV1 {
	readonly root: string;
	readonly #authority: RepositoryAuthorityV1;
	readonly #lock: ReviewMutationLockV1;
	readonly #options: SupersessionStoreOptionsV1;

	static forRepository(cwd: string, options: SupersessionStoreOptionsV1 = {}): SupersessionStoreV1 {
		return new SupersessionStoreV1(resolveRepositoryAuthorityV1(cwd), options);
	}

	private constructor(authority: RepositoryAuthorityV1, options: SupersessionStoreOptionsV1) {
		this.#authority = authority;
		this.#options = options;
		this.root = assertManagedStorePathV1(authority.common_directory, join(authority.store_root, "control", "authority-supersession-v1"));
		this.#lock = new ReviewMutationLockV1(join(authority.store_root, "control"), authority.repository_id, authority.authority_id, options.mutationLockPlatform);
	}

	load(changeName: string): SupersessionEnvelopeV1[] {
		return loadSupersessionChainV1(this.directoryForChange(changeName, false));
	}

	hasRecoveryRequiredMarker(changeName?: string): boolean {
		if (changeName !== undefined) return this.isRecoveryRequiredMarker(this.recoveryMarkerPath(changeName, false));
		try {
			return readdirSync(this.recoveryMarkerDirectory(false)).some((name) =>
				/^[0-9a-f]{64}\.json$/.test(name) && this.isRecoveryRequiredMarker(join(this.recoveryMarkerDirectory(false), name)),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			return true;
		}
	}

	hasValidRecoveryRequiredMarker(changeName: string): boolean {
		const path = this.recoveryMarkerPath(changeName, false);
		try {
			const entry = lstatSync(path);
			if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("marker is not a regular file");
			const expected = { schema: "gentle-ai.recovery-required/v1", change_name: changeName };
			const raw = readFileSync(path, "utf8");
			if (canonicalJsonV1(JSON.parse(raw)) !== canonicalJsonV1(expected)) throw new Error("marker content is invalid");
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, `recovery-required marker is unreadable or invalid: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	install(changeName: string, input: SupersessionEnvelopeV1, installOptions: SupersessionInstallOptionsV1 = {}): InstalledSupersessionV1 {
		const envelope = createSupersessionEnvelopeV1(input.body);
		if (envelope.recovery_id !== input.recovery_id) {
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "installation envelope is not content-bound");
		}
		const owner = this.#lock.acquire();
		try {
			const directory = this.directoryForChange(changeName, true);
			this.assertCurrentRepository(envelope, changeName);
			const chain = loadSupersessionChainV1(directory);
			for (const check of installOptions.casChecks ?? []) {
				if (!check.label || check.observe() !== check.expected) {
					throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.STALE_AUTHORIZATION, `live ${check.label || "authority"} binding changed after preparation`);
				}
			}
			const existing = chain.find((record) => record.body.operation_id === envelope.body.operation_id);
			if (existing) {
				if (canonicalJsonV1(existing) !== canonicalJsonV1(envelope)) {
					throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.OPERATION_CONFLICT, "operation ID already has different semantics");
				}
				return { recovery_id: existing.recovery_id, path: writeSupersessionRecordV1(directory, envelope, this.#options) };
			}
			const predecessor = chain.at(-1);
			if (envelope.body.predecessor_recovery_id !== (predecessor?.recovery_id ?? null) || envelope.body.sequence !== chain.length) {
				throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.STALE_AUTHORIZATION, "prepared predecessor or sequence is stale");
			}
			for (const record of chain) this.assertSameChainBinding(record, envelope);
			this.writeRecoveryRequiredMarker(changeName);
			const path = writeSupersessionRecordV1(directory, envelope, this.#options);
			const reread = loadSupersessionChainV1(directory);
			if (reread.at(-1)?.recovery_id !== envelope.recovery_id || reread.length !== chain.length + 1) {
				throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.RACE_UNSAFE, "supersession readback did not produce one expected chain head");
			}
			return { recovery_id: envelope.recovery_id, path };
		} finally {
			this.#lock.release(owner);
		}
	}

	private directoryForChange(changeName: string, create: boolean): string {
		if (!CHANGE_NAME.test(changeName)) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "change name is not canonical");
		const directory = assertManagedStorePathV1(this.#authority.common_directory, join(this.root, domainHashV1("openspec-change-name", changeName)));
		try {
			if (create) this.ensureAnchoredDirectory(directory);
			else if (existsSync(directory)) this.assertAnchoredDirectory(directory);
			return directory;
		} catch (error) {
			if (error instanceof ReviewAuthoritySupersessionError) throw error;
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.REPOSITORY_MISMATCH, `supersession store path is unsafe: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private recoveryMarkerDirectory(create: boolean): string {
		const directory = assertManagedStorePathV1(this.#authority.common_directory, join(this.root, "recovery-required-v1"));
		if (create) this.ensureAnchoredDirectory(directory);
		else if (existsSync(directory)) this.assertAnchoredDirectory(directory);
		return directory;
	}

	private recoveryMarkerPath(changeName: string, create: boolean): string {
		if (!CHANGE_NAME.test(changeName)) throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.INVALID, "change name is not canonical");
		return join(this.recoveryMarkerDirectory(create), `${domainHashV1("openspec-change-name", changeName)}.json`);
	}

	private isRecoveryRequiredMarker(path: string): boolean {
		try {
			const entry = lstatSync(path);
			return entry.isFile() && !entry.isSymbolicLink();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			return true;
		}
	}

	private writeRecoveryRequiredMarker(changeName: string): void {
		const path = this.recoveryMarkerPath(changeName, true);
		if (!this.isRecoveryRequiredMarker(path)) {
			writeFileSync(path, canonicalJsonV1({ schema: "gentle-ai.recovery-required/v1", change_name: changeName }), { flag: "wx", mode: 0o600 });
			const file = openSync(path, "r");
			try { fsyncSync(file); } finally { closeSync(file); }
		}
		fsyncDirectoryV1(this.recoveryMarkerDirectory(false));
	}

	private ensureAnchoredDirectory(directory: string): void {
		let current = this.#authority.common_directory;
		for (const part of relative(current, directory).split(/[\\/]/).filter(Boolean)) {
			const parent = current;
			current = join(parent, part);
			if (!existsSync(current)) {
				mkdirSync(current, { mode: 0o700 });
				fsyncDirectoryV1(parent);
			}
			this.assertAnchoredDirectory(current);
		}
	}

	private assertAnchoredDirectory(directory: string): void {
		const entry = lstatSync(directory);
		if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("supersession store directory is not a real directory");
		assertManagedStorePathV1(this.#authority.common_directory, directory);
	}

	private assertCurrentRepository(envelope: SupersessionEnvelopeV1, changeName: string): void {
		const expected = repositoryBindingV1(this.#authority.common_directory);
		if (canonicalJsonV1(envelope.body.repository) !== canonicalJsonV1(expected) || envelope.body.change.change_name !== changeName) {
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.REPOSITORY_MISMATCH, "supersession does not bind this repository and change");
		}
	}

	private assertSameChainBinding(previous: SupersessionEnvelopeV1, next: SupersessionEnvelopeV1): void {
		if (canonicalJsonV1(previous.body.repository) !== canonicalJsonV1(next.body.repository) || canonicalJsonV1(previous.body.change) !== canonicalJsonV1(next.body.change) || canonicalJsonV1(previous.body.source) !== canonicalJsonV1(next.body.source)) {
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "supersession chain changes its repository, change, or source binding");
		}
	}
}

/**
 * Re-derive successor-owned recovery bindings from live compact authority. This is
 * intentionally read-only and is called on both sides of a lifecycle final recheck.
 */
export function assertLiveRecoveredSuccessorBindingV1(cwd: string, recovery: SupersessionEnvelopeV1, state: CompactReviewStateV2): void {
	const proofHash = state.intended_untracked.length === 0
		? domainHashV1("review-recovery-empty-untracked", { candidate_tree: state.current_candidate_tree, paths: [] })
		: deriveIntendedUntrackedProofV1(cwd, state.current_candidate_tree, state.intended_untracked).proof_hash;
	const live = {
		base_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.base_tree),
		complete_snapshot_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.complete_snapshot_tree),
		initial_review_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.initial_review_tree),
		final_candidate_tree: domainHashV1("review-recovery-tree", state.current_candidate_tree),
		review_projection_hash: domainHashV1("review-recovery-projection", state.initial_snapshot.review_projection),
		genesis_paths_hash: domainHashV1("compact-paths", state.genesis_paths),
		scope_digest: domainHashV1("review-recovery-scope", {
			base_tree: state.initial_snapshot.base_tree,
			complete_snapshot_tree: state.initial_snapshot.complete_snapshot_tree,
			initial_review_tree: state.initial_snapshot.initial_review_tree,
			final_candidate_tree: state.current_candidate_tree,
			genesis_paths: state.genesis_paths,
			intended_untracked: state.intended_untracked,
		}),
		intended_untracked_hash: domainHashV1("compact-untracked", state.intended_untracked),
		intended_untracked_proof_hash: proofHash,
		policy_hash: state.policy_hash,
		policy_evidence_hash: domainHashV1("review-recovery-policy-evidence", { policy_hash: state.policy_hash, runtime_identity_hash: state.runtime_identity.identity_hash }),
		successor_ledger_hash: domainHashV1("compact-findings", state.findings),
	};
	const bound = recovery.body.equivalence;
	for (const [field, value] of Object.entries(live)) {
		if (bound[field as keyof RecoveryEquivalenceBindingV1] !== value) {
		throw new ReviewAuthoritySupersessionError(
			field.includes("untracked") ? REVIEW_AUTHORITY_SUPERSESSION_ERROR.UNTRACKED_DRIFT : REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS,
			`recovery ${field} no longer matches live compact authority`,
		);
		}
	}
	if (bound.successor_receipt_hash !== recovery.body.successor.receipt_hash || bound.successor_ledger_hash !== recovery.body.successor.ledger_hash) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "recovery receipt or ledger binding is inconsistent");
	}
}

/**
 * Re-derive graph-v1 source-owned evidence from immutable authority before and
 * after a recovered lifecycle target evaluation. Graph-v1 has no runtime
 * identity field, so policy evidence is established by its immutable policy
 * hash while the compact-side validator rederives the shared runtime evidence.
 */
export function assertLiveRecoveredSourceBindingV1(cwd: string, recovery: SupersessionEnvelopeV1): void {
	const source = inspectRecoverableGraphSourceV1(cwd, recovery.body.change.change_name, recovery.body.source.lineage_id);
	if (
		canonicalJsonV1(source.repository) !== canonicalJsonV1(recovery.body.repository) ||
		canonicalJsonV1(source.change) !== canonicalJsonV1(recovery.body.change) ||
		canonicalJsonV1(source.source) !== canonicalJsonV1(recovery.body.source)
	) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "recovery source identity no longer matches live graph authority");
	}
	const authority = resolveRepositoryAuthorityV1(cwd);
	const graph = new ReviewGraphObjectStoreV1(join(authority.store_root, "graph-v1"), authority.repository_id, authority.authority_id);
	const entry = (graph.readCurrent().body.lineages as Array<Record<string, unknown>>).find((candidate) => candidate.lineage_id === source.source.lineage_id && candidate.mode === "graph");
	if (!entry || typeof entry.head_event_id !== "string" || typeof entry.sequence !== "number") {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "live graph source head is unavailable");
	}
	const reversed: ReturnType<ReviewGraphObjectStoreV1["readEvent"]>[] = [];
	let eventId: string | null = entry.head_event_id;
	let sequence = entry.sequence;
	while (eventId !== null) {
		const event = graph.readEvent(eventId);
		if (event.body.lineage_id !== source.source.lineage_id || event.body.sequence !== sequence) {
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "live graph source closure is discontinuous");
		}
		reversed.push(event);
		eventId = event.body.predecessor_event_id;
		sequence -= 1;
	}
	const state = validateReviewGraphReplayV1(reversed.reverse());
	if (!state.frozen_ledger || !state.final_candidate_tree) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "live graph source lacks terminal evidence");
	}
	// Graph-v1 did not persist an intended-untracked path set. Its immutable source
	// target therefore proves the only representable graph-v1 state: an empty set.
	const intendedUntracked: string[] = [];
	const intendedUntrackedProofHash = domainHashV1("review-recovery-empty-untracked", {
		candidate_tree: state.final_candidate_tree,
		paths: intendedUntracked,
	});
	const genesisPaths = state.genesis_paths ?? [];
	const live = {
		base_tree: domainHashV1("review-recovery-tree", state.base_tree),
		complete_snapshot_tree: domainHashV1("review-recovery-tree", state.complete_snapshot_tree),
		initial_review_tree: domainHashV1("review-recovery-tree", state.initial_review_tree),
		final_candidate_tree: domainHashV1("review-recovery-tree", state.final_candidate_tree),
		review_projection_hash: domainHashV1("review-recovery-projection", state.review_projection),
		genesis_paths_hash: domainHashV1("compact-paths", genesisPaths),
		scope_digest: domainHashV1("review-recovery-scope", {
			base_tree: state.base_tree,
			complete_snapshot_tree: state.complete_snapshot_tree,
			initial_review_tree: state.initial_review_tree,
			final_candidate_tree: state.final_candidate_tree,
			genesis_paths: genesisPaths,
			intended_untracked: intendedUntracked,
		}),
		intended_untracked_hash: domainHashV1("compact-untracked", intendedUntracked),
		intended_untracked_proof_hash: intendedUntrackedProofHash,
		policy_hash: state.policy_hash,
		source_receipt_hash: createReceiptForState(state).receipt_hash,
		source_ledger_hash: state.frozen_ledger.frozen_ledger_hash,
	};
	for (const [field, value] of Object.entries(live)) {
		if (recovery.body.equivalence[field as keyof RecoveryEquivalenceBindingV1] !== value) {
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, `recovery ${field} no longer matches live graph authority`);
		}
	}
}

/** A compact authority selected only through a complete, change-scoped recovery chain. */
export interface ResolvedReviewAuthorityForChangeV1 {
	recovery: SupersessionEnvelopeV1;
	store: CompactReviewStoreV2;
	record: ReturnType<CompactReviewStoreV2["load"]>;
}

/**
 * Resolve recovery authority for one canonical OpenSpec change. Generic compact
 * discovery intentionally does not call this: without the change name it cannot
 * prove which supersession applies and must preserve graph/compact ambiguity.
 */
export function resolveReviewAuthorityForChange(cwd: string, changeName: string): ResolvedReviewAuthorityForChangeV1 | undefined {
	const supersessions = SupersessionStoreV1.forRepository(cwd);
	const eligibleGraphAuthority = hasEligibleGraphV1RecoveryAuthorityV1(cwd);
	const markerIsValid = supersessions.hasValidRecoveryRequiredMarker(changeName);
	const chain = supersessions.load(changeName);
	if (chain.length === 0) {
		if (eligibleGraphAuthority || markerIsValid) {
			throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "recovery-required authority has no bound supersession record");
		}
		return undefined;
	}
	if (!markerIsValid) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "recovery-required supersession is missing its valid marker");
	}
	const recovery = chain.at(-1)!;
	let source: RecoverableSourceEligibilityV1;
	let successor: CompactAuthorityBindingV1;
	try {
		source = inspectRecoverableGraphSourceV1(cwd, changeName, recovery.body.source.lineage_id);
		successor = inspectApprovedCompactSuccessorV1(cwd, recovery.body.successor.lineage_id);
	} catch (error) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, `recovery authority is unreadable or ambiguous: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (
		canonicalJsonV1(source.repository) !== canonicalJsonV1(recovery.body.repository) ||
		canonicalJsonV1(source.change) !== canonicalJsonV1(recovery.body.change) ||
		canonicalJsonV1(source.source) !== canonicalJsonV1(recovery.body.source)
	) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "recovery source or repository binding no longer matches live authority");
	}
	if (canonicalJsonV1(successor) !== canonicalJsonV1(recovery.body.successor)) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "recovery successor binding no longer matches live authority");
	}
	const store = CompactReviewStoreV2.forRepository(cwd, successor.lineage_id);
	const record = store.load();
	if (record.state.state !== COMPACT_REVIEW_STATE.APPROVED || !existsSync(store.receiptPath)) {
		throw new ReviewAuthoritySupersessionError(REVIEW_AUTHORITY_SUPERSESSION_ERROR.CHAIN_AMBIGUOUS, "recovery successor is not terminally approved");
	}
	assertLiveRecoveredSourceBindingV1(cwd, recovery);
	assertLiveRecoveredSuccessorBindingV1(cwd, recovery, record.state);
	return { recovery, store, record };
}
