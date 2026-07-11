import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type BigIntStats } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { canonicalJsonV1, domainHashV1 } from "./review-canonical.ts";
import { inspectLegacyReviewAuthorityV1, type LegacyInspectionV1 } from "./review-legacy-detector.ts";
import { ReviewMutationLockV1, type ReviewLockPlatformAdapterV1 } from "./review-lock.ts";
import { ReviewGraphObjectStoreV1, type ReviewStoreDescriptorV1 } from "./review-object-store.ts";
import { IDENTITY_FILENAME, resolveRepositoryAuthorityForRecoveryV1, resolveRepositoryAuthorityV1, writePinnedRepositoryIdentityV1, type RepositoryAuthorityV1 } from "./review-repository.ts";

export class ReviewResetError extends Error { constructor(message: string) { super(message); this.name = "ReviewResetError"; } }
type ResetPhase = "marked" | "quarantining" | "deleting" | "initializing" | "verifying" | "complete" | "failed-closed";
interface ResetState { body: { schema: "gentle-ai.review-reset-state/v1"; reset_id: string; repository_id: string; common_directory_hash: string; authorized_inventory_hash: string; authorization_hash: string; sequence: number; phase: ResetPhase; quarantine_relative_path: string; moved_roots: string[]; deleted_roots: string[]; store_epoch?: string; authority_incarnation_id?: string; empty_root_set_id?: string; identity_recovery?: boolean; }; reset_state_hash: string; }
export type ResetRaceWindowOperation = "quarantine-move" | "quarantine-delete";
export interface ResetRaceWindowEventV1 { operation: ResetRaceWindowOperation; path: string; }
export interface DestructiveResetOptionsV1 {
	cwd: string; repositoryId: string; commonDirHash: string; inventoryHash: string; confirmation: string; resume?: boolean; mutationLockPlatform?: ReviewLockPlatformAdapterV1; faultAfterPhase?: Exclude<ResetPhase, "complete" | "failed-closed">; raceWindowHook?: (event: ResetRaceWindowEventV1) => void;
	// RESL2-001 / RELY2-001 recovery mode: a pinned root commit removed by an
	// ordinary history rewrite breaks the identity SUBSET check permanently,
	// and by default this reset stays fail-closed like any other access. An
	// operator who explicitly wants to recover from that broken pin must
	// pass this flag; it is never inferred or defaulted on.
	allowBrokenIdentity?: boolean;
}
export interface DestructiveResetResultV1 { reset_id: string; store: ReviewStoreDescriptorV1; }

// Descriptor-anchored destructive operations (BRGP2-001 TOCTOU remediation).
// Every quarantine/delete mutation opens its complete parent-directory chain
// from the canonical Git common directory with O_DIRECTORY|O_NOFOLLOW handles,
// then proves handle/path identity (device and inode) immediately before and
// after the destructive syscall. A symlink, reparse point, or substituted
// directory discovered after validation fails closed; a path precheck alone
// never authorizes a destructive operation.
const ANCHORED_DIRECTORY_FLAGS = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0);
interface AnchoredDirectoryHandleV1 { descriptor: number; path: string; device: bigint; inode: bigint; }

function raceUnsafeError(path: string): ReviewResetError {
	return new ReviewResetError(`REVIEW_RESET_RACE_UNSAFE: review store path was replaced by a symlink, reparse point, or substituted directory during a destructive reset operation: ${path}`);
}

function openAnchoredDirectoryV1(path: string): AnchoredDirectoryHandleV1 {
	let descriptor: number;
	try { descriptor = openSync(path, ANCHORED_DIRECTORY_FLAGS); } catch { throw raceUnsafeError(path); }
	try {
		const identity = fstatSync(descriptor, { bigint: true });
		if (!identity.isDirectory()) throw raceUnsafeError(path);
		const handle: AnchoredDirectoryHandleV1 = { descriptor, path, device: identity.dev, inode: identity.ino };
		assertAnchoredHandleV1(handle);
		return handle;
	} catch (error) { closeSync(descriptor); throw error instanceof ReviewResetError ? error : raceUnsafeError(path); }
}

function assertAnchoredHandleV1(handle: AnchoredDirectoryHandleV1): void {
	let live: BigIntStats;
	try { live = lstatSync(handle.path, { bigint: true }); } catch { throw raceUnsafeError(handle.path); }
	if (live.isSymbolicLink() || !live.isDirectory() || live.dev !== handle.device || live.ino !== handle.inode) throw raceUnsafeError(handle.path);
}

function assertNonSymlinkTargetV1(path: string): void {
	let live: BigIntStats | undefined;
	try { live = lstatSync(path, { bigint: true, throwIfNoEntry: false }); } catch { throw raceUnsafeError(path); }
	if (live?.isSymbolicLink()) throw raceUnsafeError(path);
}

function openAnchoredParentChainV1(anchor: string, target: string): AnchoredDirectoryHandleV1[] {
	const relativeTarget = relative(anchor, target);
	if (relativeTarget.length === 0 || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) throw new ReviewResetError("Destructive reset target escapes the canonical Git common directory");
	const handles: AnchoredDirectoryHandleV1[] = [];
	try {
		handles.push(openAnchoredDirectoryV1(anchor));
		let current = anchor;
		const parts = relativeTarget.split(sep).filter(Boolean);
		for (const part of parts.slice(0, -1)) {
			current = join(current, part);
			handles.push(openAnchoredDirectoryV1(current));
		}
		return handles;
	} catch (error) { for (const handle of handles) closeSync(handle.descriptor); throw error; }
}

function anchoredDestructiveOperationV1(options: { anchor: string; operation: ResetRaceWindowOperation; primaryPath: string; paths: readonly string[]; hook?: (event: ResetRaceWindowEventV1) => void; action: () => void; }): void {
	const handles: AnchoredDirectoryHandleV1[] = [];
	try {
		for (const path of options.paths) handles.push(...openAnchoredParentChainV1(options.anchor, path));
		for (const path of options.paths) assertNonSymlinkTargetV1(path);
		options.hook?.({ operation: options.operation, path: options.primaryPath });
		for (const handle of handles) assertAnchoredHandleV1(handle);
		for (const path of options.paths) assertNonSymlinkTargetV1(path);
		options.action();
		for (const handle of handles) assertAnchoredHandleV1(handle);
	} finally { for (const handle of handles) closeSync(handle.descriptor); }
}

function statePath(root: string): string { return join(root, "control", "reset-state.json"); }
function fsyncPath(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function writeState(root: string, body: ResetState["body"]): ResetState {
	const control = join(root, "control");
	mkdirSync(control, { recursive: true, mode: 0o700 });
	const envelope: ResetState = { body, reset_state_hash: domainHashV1("reset-state", body) };
	const temporary = `${statePath(root)}.${process.pid}.tmp`;
	writeFileSync(temporary, canonicalJsonV1(envelope), { flag: "w", mode: 0o600 });
	fsyncPath(temporary); renameSync(temporary, statePath(root)); fsyncPath(control);
	return envelope;
}
function readState(root: string): ResetState {
	try { const state = JSON.parse(readFileSync(statePath(root), "utf8")) as ResetState; if (state.body.schema !== "gentle-ai.review-reset-state/v1" || state.reset_state_hash !== domainHashV1("reset-state", state.body)) throw new Error("hash"); return state; }
	catch { throw new ReviewResetError("Reset state is malformed or unavailable"); }
}
function next(root: string, state: ResetState, phase: ResetPhase, extra: Partial<ResetState["body"]> = {}, fault?: string): ResetState {
	const updated = writeState(root, { ...state.body, ...extra, phase, sequence: state.body.sequence + 1 });
	if (fault === phase) throw new ReviewResetError(`Injected reset crash after ${phase}`);
	return updated;
}
// A genesis (generation-0) CURRENT quorum can be lost to a crash between
// writing its 3 pointer slots. `repairCurrentPointers()` forward-recovers
// that specific, unambiguous case from the durably-installed root-set
// object; any other quorum loss stays fail-closed with the original error.
function readCurrentWithGenesisRepair(graph: ReviewGraphObjectStoreV1): ReturnType<ReviewGraphObjectStoreV1["readCurrent"]> {
	try {
		return graph.readCurrent();
	} catch (error) {
		try {
			graph.repairCurrentPointers();
		} catch {
			throw error;
		}
		return graph.readCurrent();
	}
}

function assertExact(inspection: LegacyInspectionV1, options: DestructiveResetOptionsV1): void {
	const request = inspection.reset_request;
	if (options.repositoryId !== request.repositoryId || options.commonDirHash !== request.commonDirHash || options.inventoryHash !== request.inventoryHash || options.confirmation !== request.confirmation) throw new ReviewResetError("Destructive reset confirmation does not exactly match the current repository inventory");
}

export function destructiveResetReviewAuthorityV1(options: DestructiveResetOptionsV1): DestructiveResetResultV1 {
	const authority: RepositoryAuthorityV1 & { identity_broken?: boolean } = options.allowBrokenIdentity ? resolveRepositoryAuthorityForRecoveryV1(options.cwd) : resolveRepositoryAuthorityV1(options.cwd);
	let inspection = inspectLegacyReviewAuthorityV1(options.cwd, { allowBrokenIdentity: options.allowBrokenIdentity });
	if (options.resume) {
		const prior = readState(authority.store_root).body;
		if (options.repositoryId !== prior.repository_id || options.commonDirHash !== prior.common_directory_hash || options.inventoryHash !== prior.authorized_inventory_hash || options.confirmation !== `DESTROY REVIEW AUTHORITY ${prior.repository_id} AT ${prior.common_directory_hash} INVENTORY ${prior.authorized_inventory_hash}`) throw new ReviewResetError("Reset resume confirmation does not match the recorded destructive authorization");
	} else assertExact(inspection, options);
	const lock = new ReviewMutationLockV1(join(authority.store_root, "control"), authority.repository_id, authority.authority_id, options.mutationLockPlatform);
	const owner = lock.acquire();
	try {
		inspection = inspectLegacyReviewAuthorityV1(options.cwd, { allowBrokenIdentity: options.allowBrokenIdentity });
		const recoveringBrokenIdentity = Boolean(options.allowBrokenIdentity && inspection.identity_broken);
		if (inspection.outcome === "clean" && !options.resume && !recoveringBrokenIdentity) throw new ReviewResetError("Destructive reset requires detected legacy or mixed authority");
		if (!options.resume) assertExact(inspection, options);
		let state: ResetState;
		if (options.resume) state = readState(authority.store_root);
		else {
			if (existsSync(statePath(authority.store_root))) throw new ReviewResetError("A reset state already exists; use explicit resume");
			const resetId = randomBytes(32).toString("hex");
			state = writeState(authority.store_root, { schema: "gentle-ai.review-reset-state/v1", reset_id: resetId, repository_id: authority.repository_id, common_directory_hash: inspection.common_directory_hash, authorized_inventory_hash: inspection.legacy_inventory_hash, authorization_hash: domainHashV1("reset-authorization", options.confirmation), sequence: 0, phase: "marked", quarantine_relative_path: join("reset-quarantine", resetId), moved_roots: [], deleted_roots: [], identity_recovery: recoveringBrokenIdentity });
		}
		const quarantine = join(authority.store_root, "control", state.body.quarantine_relative_path);
		mkdirSync(quarantine, { recursive: true, mode: 0o700 });
		const phases: ResetPhase[] = ["marked", "quarantining", "deleting", "initializing", "verifying", "complete"];
		const atLeast = (phase: ResetPhase) => phases.indexOf(state.body.phase) >= phases.indexOf(phase);
		if (state.body.phase === "marked") state = next(authority.store_root, state, "quarantining", {}, options.faultAfterPhase);
		const roots = ["lineages", "locks", "legacy-evidence", "migration", "migration-operations", "graph-v1", "compact-v2", ...(state.body.identity_recovery ? [IDENTITY_FILENAME] : [])];
		if (!atLeast("deleting")) for (const root of roots) {
			const source = join(authority.store_root, root); const destination = join(quarantine, root);
			if (existsSync(source) && !state.body.moved_roots.includes(root)) {
				anchoredDestructiveOperationV1({ anchor: authority.common_directory, operation: "quarantine-move", primaryPath: source, paths: [source, destination], hook: options.raceWindowHook, action: () => renameSync(source, destination) });
				state = next(authority.store_root, state, "quarantining", { moved_roots: [...state.body.moved_roots, root] }, options.faultAfterPhase);
			}
		}
		if (!atLeast("deleting")) state = next(authority.store_root, state, "deleting", {}, options.faultAfterPhase);
		if (!atLeast("initializing")) {
			for (const root of state.body.moved_roots) if (!state.body.deleted_roots.includes(root)) {
				const quarantined = join(quarantine, root);
				anchoredDestructiveOperationV1({ anchor: authority.common_directory, operation: "quarantine-delete", primaryPath: quarantined, paths: [quarantined], hook: options.raceWindowHook, action: () => rmSync(quarantined, { recursive: true, force: true }) });
				state = next(authority.store_root, state, "deleting", { deleted_roots: [...state.body.deleted_roots, root] }, options.faultAfterPhase);
			}
			anchoredDestructiveOperationV1({ anchor: authority.common_directory, operation: "quarantine-delete", primaryPath: quarantine, paths: [quarantine], hook: options.raceWindowHook, action: () => rmSync(quarantine, { recursive: true, force: true }) });
			// Re-pin a fresh IDENTITY from the live root set that was already
			// computed (and frozen into `authority.repository_identity`) by
			// `resolveRepositoryAuthorityForRecoveryV1` above, now that the stale
			// pin has been quarantined away. Idempotent across resumes: the
			// atomic install in `writePinnedRepositoryIdentityV1` (RESL2-002)
			// makes a repeated call with the same identity a no-op read-back.
			if (state.body.identity_recovery) writePinnedRepositoryIdentityV1(authority.store_root, authority.repository_identity);
			const epoch = randomBytes(32).toString("hex");
			const incarnation = domainHashV1("authority-incarnation", { repository_id: authority.repository_id, store_epoch: epoch, initialization_kind: "destructive-reset", initialized_by_reset_id: state.body.reset_id, reset_authorization_hash: state.body.authorization_hash });
			state = next(authority.store_root, state, "initializing", { store_epoch: epoch, authority_incarnation_id: incarnation }, options.faultAfterPhase);
		}
		if (!state.body.store_epoch || !state.body.authority_incarnation_id) throw new ReviewResetError("Reset initialization identity is missing");
		const graph = new ReviewGraphObjectStoreV1(join(authority.store_root, "graph-v1"), authority.repository_id, authority.authority_id);
		let store: ReviewStoreDescriptorV1;
		try { store = graph.readStoreDescriptor(); } catch { store = graph.initializeDestructiveReset({ store_epoch: state.body.store_epoch, authority_incarnation_id: state.body.authority_incarnation_id, reset_id: state.body.reset_id, reset_authorization_hash: state.body.authorization_hash }); }
		if (store.store_epoch !== state.body.store_epoch || store.authority_incarnation_id !== state.body.authority_incarnation_id) throw new ReviewResetError("Reset STORE identity does not match durable reset state");
		if (state.body.phase === "initializing") { const current = readCurrentWithGenesisRepair(graph); state = next(authority.store_root, state, "verifying", { empty_root_set_id: current.root_set_id }, options.faultAfterPhase); }
		const current = readCurrentWithGenesisRepair(graph);
		if (current.body.lineages.length !== 0 || inspectLegacyReviewAuthorityV1(options.cwd).entries.length !== 0) throw new ReviewResetError("Reset verification found residual authority");
		state = next(authority.store_root, state, "complete", {}, options.faultAfterPhase);
		return { reset_id: state.body.reset_id, store };
	} catch (error) { throw error; } finally { lock.release(owner); }
}
