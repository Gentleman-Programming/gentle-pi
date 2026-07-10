import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	ReviewCheckpointError,
	ReviewCheckpointStoreV1,
	type ReviewCheckpointInputV1,
} from "../lib/review-checkpoint.ts";

const input: ReviewCheckpointInputV1 = {
	operation_id: "resume-ordinary-1",
	kind: "transaction",
	input_identity: "a".repeat(64),
	repository_id: "b".repeat(64),
	authority_id: "c".repeat(64),
	authority_root_set_id: "d".repeat(64),
	reducer_version: "review-state-v1",
	phase: "prepared",
	completed_object_ids: [],
	checkpoint_sequence: 0,
};

test("identity-bound checkpoints are durable, monotonic, and reject mismatched resume inputs", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-review-checkpoint-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const checkpoints = new ReviewCheckpointStoreV1(root);

	const prepared = checkpoints.write(input);
	assert.equal(prepared.checkpoint_sequence, 0);
	assert.deepEqual(checkpoints.read(input.operation_id, input), prepared);

	const completed = checkpoints.write({
		...input,
		phase: "completed",
		checkpoint_sequence: 1,
		completed_object_ids: ["e".repeat(64)],
	});
	assert.equal(completed.phase, "completed");
	assert.equal(completed.checkpoint_sequence, 1);
	assert.throws(
		() => checkpoints.read(input.operation_id, { ...input, reducer_version: "other-reducer" }),
		ReviewCheckpointError,
	);
	assert.throws(
		() => checkpoints.write({ ...input, checkpoint_sequence: 0, phase: "replayed" }),
		/sequence/i,
	);
});

test("checkpoint integrity rejects tampering after a process restart", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-review-checkpoint-tamper-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const store = new ReviewCheckpointStoreV1(root);
	store.write(input);
	const file = join(root, `${input.operation_id}.json`);
	const content = readFileSync(file, "utf8");
	writeFileSync(file, content.replace("prepared", "tampered"));
	assert.throws(() => new ReviewCheckpointStoreV1(root).read(input.operation_id, input), ReviewCheckpointError);
});
