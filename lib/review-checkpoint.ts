import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { canonicalJsonV1, domainHashV1, parseCanonicalJsonV1 } from "./review-canonical.ts";

const DIGEST = /^[0-9a-f]{64}$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class ReviewCheckpointError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReviewCheckpointError";
	}
}

export interface ReviewCheckpointInputV1 {
	operation_id: string;
	kind: "transaction" | "import" | "export" | "migration";
	input_identity: string;
	repository_id: string;
	authority_id: string;
	authority_root_set_id: string | null;
	reducer_version: string;
	phase: string;
	completed_object_ids: string[];
	checkpoint_sequence: number;
}

export interface ReviewCheckpointV1 extends ReviewCheckpointInputV1 {
	schema: "gentle-ai.review-checkpoint/v1";
	checkpoint_hash: string;
}

function assertInput(input: ReviewCheckpointInputV1): void {
	if (!OPERATION_ID.test(input.operation_id)) throw new ReviewCheckpointError("Checkpoint operation ID is invalid");
	if (!['transaction', 'import', 'export', 'migration'].includes(input.kind)) throw new ReviewCheckpointError("Checkpoint kind is invalid");
	for (const [name, value] of Object.entries({
		input_identity: input.input_identity,
		repository_id: input.repository_id,
		authority_id: input.authority_id,
	})) {
		if (!DIGEST.test(value)) throw new ReviewCheckpointError(`Checkpoint ${name} is invalid`);
	}
	if (input.authority_root_set_id !== null && !DIGEST.test(input.authority_root_set_id)) throw new ReviewCheckpointError("Checkpoint authority root set is invalid");
	if (typeof input.reducer_version !== "string" || input.reducer_version.length === 0) throw new ReviewCheckpointError("Checkpoint reducer version is required");
	if (typeof input.phase !== "string" || input.phase.length === 0) throw new ReviewCheckpointError("Checkpoint phase is required");
	if (!Number.isSafeInteger(input.checkpoint_sequence) || input.checkpoint_sequence < 0) throw new ReviewCheckpointError("Checkpoint sequence is invalid");
	if (!Array.isArray(input.completed_object_ids) || input.completed_object_ids.some((id) => !DIGEST.test(id))) throw new ReviewCheckpointError("Checkpoint object IDs are invalid");
	if (new Set(input.completed_object_ids).size !== input.completed_object_ids.length || canonicalJsonV1(input.completed_object_ids) !== canonicalJsonV1([...input.completed_object_ids].toSorted())) throw new ReviewCheckpointError("Checkpoint object IDs must be sorted and unique");
}

function checkpoint(input: ReviewCheckpointInputV1): ReviewCheckpointV1 {
	assertInput(input);
	const body = { ...input, schema: "gentle-ai.review-checkpoint/v1" as const };
	return { ...body, checkpoint_hash: domainHashV1("checkpoint", body) };
}

function verify(value: unknown): ReviewCheckpointV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ReviewCheckpointError("Checkpoint is malformed");
	const candidate = value as ReviewCheckpointV1;
	if (candidate.schema !== "gentle-ai.review-checkpoint/v1") throw new ReviewCheckpointError("Checkpoint schema is unsupported");
	const { schema: _schema, checkpoint_hash, ...input } = candidate;
	const expected = checkpoint(input);
	if (checkpoint_hash !== expected.checkpoint_hash || canonicalJsonV1(candidate) !== canonicalJsonV1(expected)) throw new ReviewCheckpointError("Checkpoint integrity failed");
	return expected;
}

function bindingsMatch(left: ReviewCheckpointV1, right: ReviewCheckpointInputV1): boolean {
	return left.operation_id === right.operation_id && left.kind === right.kind && left.input_identity === right.input_identity && left.repository_id === right.repository_id && left.authority_id === right.authority_id && left.authority_root_set_id === right.authority_root_set_id && left.reducer_version === right.reducer_version;
}

export class ReviewCheckpointStoreV1 {
	readonly root: string;

	constructor(root: string) {
		this.root = root;
		mkdirSync(root, { recursive: true, mode: 0o700 });
	}

	read(operationId: string, expected: ReviewCheckpointInputV1): ReviewCheckpointV1 {
		if (operationId !== expected.operation_id) throw new ReviewCheckpointError("Checkpoint operation identity mismatch");
		let stored: ReviewCheckpointV1;
		try {
			stored = verify(parseCanonicalJsonV1(readFileSync(this.path(operationId))));
		} catch (error) {
			throw error instanceof ReviewCheckpointError ? error : new ReviewCheckpointError(`Checkpoint is missing or malformed: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!bindingsMatch(stored, expected)) throw new ReviewCheckpointError("Checkpoint cannot be reused with different authority or reducer inputs");
		return stored;
	}

	write(input: ReviewCheckpointInputV1): ReviewCheckpointV1 {
		const next = checkpoint(input);
		let previous: ReviewCheckpointV1 | undefined;
		try { previous = this.read(input.operation_id, input); } catch (error) {
			if (error instanceof ReviewCheckpointError && !/missing or malformed/.test(error.message)) throw error;
		}
		if (previous && next.checkpoint_sequence !== previous.checkpoint_sequence + 1) throw new ReviewCheckpointError("Checkpoint sequence must advance exactly once");
		if (!previous && next.checkpoint_sequence !== 0) throw new ReviewCheckpointError("Initial checkpoint sequence must be zero");
		const destination = this.path(input.operation_id);
		const temporary = `${destination}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
		try {
			writeFileSync(temporary, canonicalJsonV1(next), { encoding: "utf8", mode: 0o600, flag: "wx" });
			this.fsyncFile(temporary);
			renameSync(temporary, destination);
			this.fsyncDirectory(this.root);
		} finally { try { unlinkSync(temporary); } catch {} }
		return next;
	}

	private path(operationId: string): string {
		if (!OPERATION_ID.test(operationId)) throw new ReviewCheckpointError("Checkpoint operation ID is invalid");
		return join(this.root, `${operationId}.json`);
	}

	private fsyncFile(path: string): void { const descriptor = openSync(path, "r+"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
	private fsyncDirectory(path: string): void { if (!statSync(path).isDirectory()) throw new ReviewCheckpointError("Checkpoint root is not a directory"); if (process.platform === "win32") return; const descriptor = openSync(path, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
}
