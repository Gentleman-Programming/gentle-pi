import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJsonV1, domainHashV1, parseCanonicalJsonV1 } from "./review-canonical.ts";
import { ReviewCheckpointStoreV1 } from "./review-checkpoint.ts";
import { type ReviewEventEnvelopeV1, validateReviewEventV1 } from "./review-graph-schema.ts";
import { ReviewMutationLockV1, type ReviewLockPlatformAdapterV1 } from "./review-lock.ts";
import { ReviewGraphObjectStoreV1, type ReviewRootSetBodyV1 } from "./review-object-store.ts";
import { resolveRepositoryAuthorityV1 } from "./review-repository.ts";
import { assertNoLegacyReviewAuthorityV1 } from "./review-legacy-detector.ts";
import { validateReviewGraphReplayV1 } from "./review-transaction.ts";

const HEADER = "GENTLE-REVIEW-BUNDLE 1\n";
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_OBJECTS = 10_000;
const MAX_BYTES = 64 * 1024 * 1024;

export class ReviewBundleError extends Error {
	constructor(message: string) { super(message); this.name = "ReviewBundleError"; }
}

export interface ReviewBundleRootV1 {
	lineage_id: string;
	head_event_id: string;
	sequence: number;
	reduced_state_hash: string;
}

interface ReviewBundleManifestBodyV1 {
	schema: "gentle-ai.review-bundle/v1";
	repository_identity: unknown;
	repository_id: string;
	authority_id: string;
	store_epoch?: string;
	authority_incarnation_id?: string;
	initialized_by_reset_id?: string | null;
	source_root_set_id: string;
	reducer_version: string;
	roots: ReviewBundleRootV1[];
	object_ids: string[];
	object_count: number;
	total_object_bytes: number;
}

interface ReviewBundleManifestV1 { body: ReviewBundleManifestBodyV1; bundle_id: string; }
export interface ReviewBundleExportOptionsV1 { outputPath: string; operationId: string; lineageIds?: readonly string[]; }
export interface ReviewBundleExportResultV1 { bundle_id: string; root_set_id: string; roots: readonly ReviewBundleRootV1[]; }
export interface ReviewBundleImportOptionsV1 {
	inputPath: string;
	operationId: string;
	/**
	 * RISK2-001 (openspec/changes/bounded-review-graph-parity/reviews/post-apply-4r-round2-ledger.md):
	 * repository_identity match alone cannot prove a bundle's lineage content was ever produced by
	 * a legitimate export from THIS repository's own history — anyone who knows the (often public)
	 * root commit can fabricate a structurally valid bundle claiming the same identity. There is no
	 * cross-repo trust primitive yet (tracked in openspec/changes/cross-repo-bundle-trust), so
	 * adopting a lineage this store has never itself established is an experimental,
	 * operator-attested trust decision. Defaults to false/absent (denied). Re-importing or
	 * extending a lineage already known to this store's own authority never needs this flag.
	 */
	acknowledgeUntrustedBundleSource?: boolean;
}
export interface ReviewBundleImporterOptionsV1 {
	mutationLockPlatform?: ReviewLockPlatformAdapterV1;
	beforeMutationLock?: () => void;
}
export interface ReviewBundleImportResultV1 { bundle_id: string; root_set_id: string; imported: boolean; }

function assertDigest(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !DIGEST.test(value)) throw new ReviewBundleError(`${label} is invalid`);
}

function frame(bytes: Uint8Array): Uint8Array {
	return Buffer.concat([Buffer.from(`${bytes.byteLength}\n`), Buffer.from(bytes)]);
}

function parseFrames(bytes: Uint8Array): Uint8Array[] {
	if (!Buffer.from(bytes).subarray(0, HEADER.length).equals(Buffer.from(HEADER))) throw new ReviewBundleError("Bundle header is unsupported");
	let offset = HEADER.length;
	const frames: Uint8Array[] = [];
	while (offset < bytes.byteLength) {
		const newline = Buffer.from(bytes).indexOf(0x0a, offset);
		if (newline < 0) throw new ReviewBundleError("Bundle frame length is truncated");
		const lengthText = Buffer.from(bytes).subarray(offset, newline).toString("ascii");
		if (!/^(0|[1-9][0-9]*)$/.test(lengthText)) throw new ReviewBundleError("Bundle frame length is invalid");
		const length = Number(lengthText);
		if (!Number.isSafeInteger(length) || length > MAX_BYTES || newline + 1 + length > bytes.byteLength) throw new ReviewBundleError("Bundle frame is truncated or oversized");
		offset = newline + 1;
		frames.push(bytes.slice(offset, offset + length));
		offset += length;
	}
	if (frames.length < 1) throw new ReviewBundleError("Bundle manifest is missing");
	return frames;
}

function incarnationFromManifest(body: ReviewBundleManifestBodyV1): { store_epoch: string; authority_incarnation_id: string; initialized_by_reset_id: string | null } | undefined {
	const fields = [body.store_epoch, body.authority_incarnation_id, body.initialized_by_reset_id];
	if (fields.every((value) => value === undefined)) return undefined;
	if (body.store_epoch === undefined || body.authority_incarnation_id === undefined || body.initialized_by_reset_id === undefined) throw new ReviewBundleError("Bundle incarnation fields must be present together");
	assertDigest(body.store_epoch, "Bundle store epoch");
	assertDigest(body.authority_incarnation_id, "Bundle authority incarnation");
	if (body.initialized_by_reset_id !== null) assertDigest(body.initialized_by_reset_id, "Bundle reset ID");
	return { store_epoch: body.store_epoch, authority_incarnation_id: body.authority_incarnation_id, initialized_by_reset_id: body.initialized_by_reset_id };
}

function validateManifest(value: unknown): ReviewBundleManifestV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ReviewBundleError("Bundle manifest is malformed");
	const manifest = value as ReviewBundleManifestV1;
	const body = manifest.body;
	if (!body || body.schema !== "gentle-ai.review-bundle/v1" || !Array.isArray(body.roots) || !Array.isArray(body.object_ids) || body.reducer_version !== "review-state-v1") throw new ReviewBundleError("Bundle manifest is unsupported");
	assertDigest(body.repository_id, "Bundle repository ID"); assertDigest(body.authority_id, "Bundle authority ID"); assertDigest(body.source_root_set_id, "Bundle root set ID"); assertDigest(manifest.bundle_id, "Bundle ID");
	if (body.object_count !== body.object_ids.length || body.object_count > MAX_OBJECTS || !Number.isSafeInteger(body.total_object_bytes) || body.total_object_bytes < 0) throw new ReviewBundleError("Bundle object counts are invalid");
	if (new Set(body.object_ids).size !== body.object_ids.length || canonicalJsonV1(body.object_ids) !== canonicalJsonV1([...body.object_ids].toSorted()) || body.object_ids.some((id) => !DIGEST.test(id))) throw new ReviewBundleError("Bundle object IDs must be sorted and unique");
	if (new Set(body.roots.map((root) => root.lineage_id)).size !== body.roots.length || canonicalJsonV1(body.roots.map((root) => root.lineage_id)) !== canonicalJsonV1(body.roots.map((root) => root.lineage_id).toSorted())) throw new ReviewBundleError("Bundle roots must be sorted and unique");
	if (canonicalJsonV1(manifest) !== canonicalJsonV1({ body, bundle_id: domainHashV1("bundle", body) })) throw new ReviewBundleError("Bundle manifest integrity failed");
	incarnationFromManifest(body);
	return manifest;
}

function closure(store: ReviewGraphObjectStoreV1, roots: readonly ReviewBundleRootV1[]): Map<string, ReviewEventEnvelopeV1> {
	const events = new Map<string, ReviewEventEnvelopeV1>();
	for (const root of roots) {
		assertDigest(root.head_event_id, "Bundle root head"); assertDigest(root.reduced_state_hash, "Bundle root state hash");
		if (typeof root.lineage_id !== "string" || !Number.isSafeInteger(root.sequence) || root.sequence < 0) throw new ReviewBundleError("Bundle root is invalid");
		let id: string | null = root.head_event_id;
		let expected = root.sequence;
		const seen = new Set<string>();
		while (id !== null) {
			if (seen.has(id)) throw new ReviewBundleError("Bundle graph contains a cycle");
			seen.add(id);
			const event = store.readEvent(id);
			if (event.body.lineage_id !== root.lineage_id || event.body.sequence !== expected) throw new ReviewBundleError("Bundle graph closure is discontinuous");
			if (event.body.sequence === 0 && event.body.predecessor_event_id !== null) throw new ReviewBundleError("Bundle genesis is invalid");
			events.set(id, event); id = event.body.predecessor_event_id; expected -= 1;
		}
		if (expected !== -1) throw new ReviewBundleError("Bundle graph has no genesis");
	}
	return events;
}

function fsyncFile(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function fsyncDirectory(path: string): void { if (!statSync(path).isDirectory()) throw new ReviewBundleError("Bundle destination parent is invalid"); const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function writeCheckpoint(checkpoints: ReviewCheckpointStoreV1, input: Parameters<ReviewCheckpointStoreV1["write"]>[0]): void {
	let sequence = 0;
	try { sequence = checkpoints.read(input.operation_id, input).checkpoint_sequence + 1; } catch (error) { if (!(error instanceof Error) || !/missing or malformed/.test(error.message)) throw error; }
	checkpoints.write({ ...input, checkpoint_sequence: sequence });
}

export class ReviewBundleExporter {
	readonly #authority;
	readonly #store: ReviewGraphObjectStoreV1;
	readonly #checkpoints: ReviewCheckpointStoreV1;
	constructor(cwd: string) {
		this.#authority = resolveRepositoryAuthorityV1(cwd);
		assertNoLegacyReviewAuthorityV1(cwd);
		this.#store = new ReviewGraphObjectStoreV1(join(this.#authority.store_root, "graph-v1"), this.#authority.repository_id, this.#authority.authority_id);
		this.#checkpoints = new ReviewCheckpointStoreV1(join(this.#authority.store_root, "graph-v1", "operations", "exports"));
	}
	export(options: ReviewBundleExportOptionsV1): ReviewBundleExportResultV1 {
		const current = this.#store.readCurrent();
		const wanted = options.lineageIds === undefined ? undefined : new Set(options.lineageIds);
		const roots = (current.body.lineages as Array<Record<string, unknown>>)
			.filter((entry) => entry.mode === "graph" && (wanted === undefined || wanted.has(String(entry.lineage_id))))
			.map((entry) => ({
				lineage_id: String(entry.lineage_id),
				head_event_id: String(entry.head_event_id),
				sequence: Number(entry.sequence),
				reduced_state_hash: String(entry.reduced_state_hash),
			}))
			.toSorted((a, b) => a.lineage_id.localeCompare(b.lineage_id));
		if (roots.length === 0) throw new ReviewBundleError("Bundle export requires at least one authoritative graph root");
		if (roots.some((root) => existsSync(join(this.#authority.store_root, "compact-v2", root.lineage_id, "review-state.json")))) throw new ReviewBundleError("Graph bundle export refuses graph-v1 and compact-v2 lineage ambiguity");
		const objects = closure(this.#store, roots);
		const objectIds = [...objects.keys()].toSorted();
		const objectBytes = objectIds.map((id) => new TextEncoder().encode(canonicalJsonV1(objects.get(id)!)));
		const descriptor = existsSync(join(this.#store.root, "STORE")) ? this.#store.readStoreDescriptor() : undefined;
		const body: ReviewBundleManifestBodyV1 = { schema: "gentle-ai.review-bundle/v1", repository_identity: this.#authority.repository_identity, repository_id: this.#authority.repository_id, authority_id: this.#authority.authority_id, ...(descriptor === undefined ? {} : { store_epoch: descriptor.store_epoch, authority_incarnation_id: descriptor.authority_incarnation_id, initialized_by_reset_id: descriptor.initialized_by_reset_id }), source_root_set_id: current.root_set_id, reducer_version: "review-state-v1", roots, object_ids: objectIds, object_count: objectIds.length, total_object_bytes: objectBytes.reduce((total, bytes) => total + bytes.byteLength, 0) };
		const manifest: ReviewBundleManifestV1 = { body, bundle_id: domainHashV1("bundle", body) };
		const bytes = Buffer.concat([Buffer.from(HEADER), frame(new TextEncoder().encode(canonicalJsonV1(manifest))), ...objectBytes.map(frame)]);
		const output = resolve(options.outputPath); const parent = dirname(output); const temporary = join(parent, `.${basename(output)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
		if (existsSync(output)) { if (!Buffer.from(readFileSync(output)).equals(bytes)) throw new ReviewBundleError("Bundle destination already exists with different bytes"); } else {
			writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 }); fsyncFile(temporary);
			try { linkSync(temporary, output); fsyncDirectory(parent); } catch (error) { if (!existsSync(output) || !Buffer.from(readFileSync(output)).equals(bytes)) throw new ReviewBundleError(`Bundle destination publication failed: ${error instanceof Error ? error.message : String(error)}`); } finally { try { unlinkSync(temporary); } catch {} }
		}
		writeCheckpoint(this.#checkpoints, { operation_id: options.operationId, kind: "export", input_identity: manifest.bundle_id, repository_id: this.#authority.repository_id, authority_id: this.#authority.authority_id, authority_root_set_id: current.root_set_id, reducer_version: "review-state-v1", phase: "published", completed_object_ids: objectIds, checkpoint_sequence: 0 });
		return { bundle_id: manifest.bundle_id, root_set_id: current.root_set_id, roots };
	}
}

export class ReviewBundleImporter {
	readonly #authority;
	readonly #store: ReviewGraphObjectStoreV1;
	readonly #checkpoints: ReviewCheckpointStoreV1;
	readonly #lock: ReviewMutationLockV1;
	readonly #beforeMutationLock?: () => void;
	constructor(cwd: string, options: ReviewBundleImporterOptionsV1 = {}) {
		this.#authority = resolveRepositoryAuthorityV1(cwd);
		assertNoLegacyReviewAuthorityV1(cwd);
		const root = join(this.#authority.store_root, "graph-v1");
		this.#store = new ReviewGraphObjectStoreV1(root, this.#authority.repository_id, this.#authority.authority_id);
		this.#checkpoints = new ReviewCheckpointStoreV1(join(root, "operations", "imports"));
		this.#lock = new ReviewMutationLockV1(join(this.#authority.store_root, "control"), this.#authority.repository_id, this.#authority.authority_id, options.mutationLockPlatform);
		this.#beforeMutationLock = options.beforeMutationLock;
	}
	import(options: ReviewBundleImportOptionsV1): ReviewBundleImportResultV1 {
		const input = readFileSync(options.inputPath); if (input.byteLength > MAX_BYTES) throw new ReviewBundleError("Bundle is oversized");
		const frames = parseFrames(input); const manifest = validateManifest(parseCanonicalJsonV1(frames[0]!));
		if (canonicalJsonV1(manifest.body.repository_identity) !== canonicalJsonV1(this.#authority.repository_identity) || manifest.body.repository_id !== this.#authority.repository_id || manifest.body.authority_id !== this.#authority.authority_id) throw new ReviewBundleError("Bundle repository authority does not match this repository");
		if (manifest.body.roots.some((root) => existsSync(join(this.#authority.store_root, "compact-v2", root.lineage_id, "review-state.json")))) throw new ReviewBundleError("Graph bundle import refuses to collide with compact-v2 authority");
		const descriptor = existsSync(join(this.#store.root, "STORE")) ? this.#store.readStoreDescriptor() : undefined;
		const incarnation = incarnationFromManifest(manifest.body);
		if (descriptor && (!incarnation || incarnation.store_epoch !== descriptor.store_epoch || incarnation.authority_incarnation_id !== descriptor.authority_incarnation_id || incarnation.initialized_by_reset_id !== descriptor.initialized_by_reset_id)) throw new ReviewBundleError("REVIEW_BUNDLE_EPOCH_MISMATCH");
		if (frames.length !== manifest.body.object_count + 1) throw new ReviewBundleError("Bundle object frame count is invalid");
		const staged = new Map<string, ReviewEventEnvelopeV1>();
		for (let index = 0; index < manifest.body.object_ids.length; index += 1) { const event = parseCanonicalJsonV1(frames[index + 1]!) as ReviewEventEnvelopeV1; validateReviewEventV1(event); if (event.event_id !== manifest.body.object_ids[index]) throw new ReviewBundleError("Bundle object ordering or identity is invalid"); staged.set(event.event_id, event); }
		const closureIds = new Set<string>();
		for (const root of manifest.body.roots) { let id: string | null = root.head_event_id; let expected = root.sequence; const seen = new Set<string>(); let head: ReviewEventEnvelopeV1 | undefined; while (id !== null) { if (seen.has(id)) throw new ReviewBundleError("Bundle graph contains a cycle"); seen.add(id); const event = staged.get(id); if (!event || event.body.lineage_id !== root.lineage_id || event.body.sequence !== expected) throw new ReviewBundleError("Bundle closure is missing or invalid"); if (head === undefined) head = event; closureIds.add(id); id = event.body.predecessor_event_id; expected -= 1; } if (expected !== -1 || head?.body.reduced_state_hash !== root.reduced_state_hash) throw new ReviewBundleError("Bundle root reduced state does not match its complete closure"); }
		if (canonicalJsonV1([...closureIds].toSorted()) !== canonicalJsonV1(manifest.body.object_ids)) throw new ReviewBundleError("Bundle closure has missing or extra objects");
		for (const event of staged.values()) {
			if (incarnation && (event.body.store_epoch !== incarnation.store_epoch || event.body.authority_incarnation_id !== incarnation.authority_incarnation_id || event.body.initialized_by_reset_id !== incarnation.initialized_by_reset_id)) throw new ReviewBundleError("Bundle event incarnation does not match its manifest");
			if (!incarnation && (event.body.store_epoch !== undefined || event.body.authority_incarnation_id !== undefined || event.body.initialized_by_reset_id !== undefined)) throw new ReviewBundleError("Bundle event incarnation is missing from its manifest");
		}
		for (const root of manifest.body.roots as unknown[]) {
			if (typeof root === "object" && root !== null && "migration_provenance" in root) throw new ReviewBundleError("Legacy migration provenance is retired and cannot be imported");
		}
		for (const root of manifest.body.roots) {
			const chain: ReviewEventEnvelopeV1[] = [];
			for (let eventId: string | null = root.head_event_id; eventId !== null; eventId = staged.get(eventId)?.body.predecessor_event_id ?? null) {
				const event = staged.get(eventId);
				if (!event) throw new ReviewBundleError("Bundle replay closure is missing");
				chain.push(event);
			}
			try {
				const reduced = validateReviewGraphReplayV1(chain.reverse());
				if (reduced.lineage_id !== root.lineage_id || reduced.revision !== root.sequence || canonicalJsonV1(reduced) !== canonicalJsonV1((chain.at(-1)!.body.payload as { state: unknown }).state)) throw new ReviewBundleError("Bundle replay does not match its declared root");
			} catch (error) {
				if (error instanceof ReviewBundleError) throw error;
				throw new ReviewBundleError(`Bundle reducer replay is invalid: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		writeCheckpoint(this.#checkpoints, { operation_id: options.operationId, kind: "import", input_identity: manifest.bundle_id, repository_id: this.#authority.repository_id, authority_id: this.#authority.authority_id, authority_root_set_id: null, reducer_version: "review-state-v1", phase: "graph-validated", completed_object_ids: manifest.body.object_ids, checkpoint_sequence: 0 });
		this.#beforeMutationLock?.();
		const owner = this.#lock.acquire();
		try {
			// A genesis (generation-0) CURRENT quorum can be lost to a crash
			// between writing its 3 pointer slots. Attempt forward repair
			// before treating the store as empty — otherwise a recoverable
			// crash would be silently misclassified as a fresh store and a
			// competing generation-0 root set would be published, discarding
			// the existing (recoverable) lineages.
			let current: ReturnType<ReviewGraphObjectStoreV1["readCurrent"]> | undefined;
			try { current = this.#store.readCurrent(); } catch {
				try { this.#store.repairCurrentPointers(); current = this.#store.readCurrent(); } catch { current = undefined; }
			}
			const existing = new Map((current?.body.lineages as Array<Record<string, unknown>> | undefined ?? []).map((entry) => [String(entry.lineage_id), entry]));
			let changed = false;
			// RISK2-001 trust gate (openspec/changes/bounded-review-graph-parity/reviews/post-apply-4r-round2-ledger.md):
			// repository_identity/root_commit_ids match (checked above) proves the bundle's claimed
			// identity equals this repository's own, but that is NOT proof the bundle's lineage content
			// was ever legitimately produced — a foreign party who merely knows the (often public) root
			// commit can forge a structurally valid bundle with the same identity. common_directory (the
			// binding the transaction gate at review-transaction.ts uses) cannot discriminate here either,
			// since it legitimately differs across clones of the same repository. Until a real cross-repo
			// trust primitive exists (deferred to openspec/changes/cross-repo-bundle-trust), silently
			// adopting a lineage this store has never itself established is unsafe. Only extending or
			// re-importing a lineage this store's own authority already recognizes is unconditionally
			// trusted; anything new requires the caller's explicit, experimental,
			// operator-attested acknowledgeUntrustedBundleSource opt-in.
			for (const root of manifest.body.roots) {
				const prior = existing.get(root.lineage_id);
				if (prior && prior.head_event_id !== root.head_event_id) throw new ReviewBundleError("Bundle lineage conflicts with existing authority");
				if (!prior) {
					if (!options.acknowledgeUntrustedBundleSource) throw new ReviewBundleError("REVIEW_BUNDLE_UNTRUSTED_SOURCE: bundle introduces a lineage this repository has not already established as its own authority; pass acknowledgeUntrustedBundleSource to accept this as an experimental, operator-attested cross-repo trust decision pending a real trust primitive (see RISK2-001)");
					existing.set(root.lineage_id, { ...root, mode: "graph" });
					changed = true;
				}
			}
			if (!changed) return { bundle_id: manifest.bundle_id, root_set_id: current!.root_set_id, imported: false };
			if (manifest.body.roots.some((root) => existsSync(join(this.#authority.store_root, "compact-v2", root.lineage_id, "review-state.json")))) throw new ReviewBundleError("Graph bundle import refuses to collide with compact-v2 authority");
			for (const event of staged.values()) this.#store.installEvent(event);
			const lineages = [...existing.values()].toSorted((a, b) => String(a.lineage_id).localeCompare(String(b.lineage_id)));
			const root = this.#store.installRootSet({ schema: "gentle-ai.review-root-set/v1", repository_id: this.#authority.repository_id, authority_id: this.#authority.authority_id, ...(descriptor === undefined ? {} : { store_epoch: descriptor.store_epoch, authority_incarnation_id: descriptor.authority_incarnation_id, initialized_by_reset_id: descriptor.initialized_by_reset_id }), generation: current ? current.body.generation + 1 : 0, predecessor_root_set_id: current ? current.root_set_id : null, lineages } satisfies ReviewRootSetBodyV1);
			this.#store.publishRootSet(root);
			return { bundle_id: manifest.bundle_id, root_set_id: root.root_set_id, imported: true };
		} finally { this.#lock.release(owner); }
	}
}
