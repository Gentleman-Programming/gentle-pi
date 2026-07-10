import assert from "node:assert/strict";
import test from "node:test";
import { createReviewEventV1 } from "../lib/review-graph-schema.ts";
import { ReviewGraphIntegrityError, reduceReviewGraphV1 } from "../lib/review-graph-reducer.ts";

const stateHash = "a".repeat(64);

function event(sequence: number, predecessor_event_id: string | null, lineage_id = "lineage-a") {
	return createReviewEventV1({ lineage_id, sequence, predecessor_event_id, kind: sequence === 0 ? "lineage-created" : "operation-completed", payload: { sequence }, reduced_state_hash: stateHash });
}

test("graph reducer rejects missing predecessors and wrong-lineage chains", () => {
	const root = event(0, null);
	const missing = event(1, "b".repeat(64));
	assert.throws(() => reduceReviewGraphV1(missing.event_id, new Map([[missing.event_id, missing]]), () => ({ state: {}, state_hash: stateHash })), /missing predecessor/i);
	const wrongLineage = event(1, root.event_id, "lineage-b");
	assert.throws(() => reduceReviewGraphV1(wrongLineage.event_id, new Map([[root.event_id, root], [wrongLineage.event_id, wrongLineage]]), () => ({ state: {}, state_hash: stateHash })), /lineage/i);
});

test("graph reducer deterministically reduces a complete chain and checks state hashes", () => {
	const root = event(0, null);
	const head = event(1, root.event_id);
	const reduced = reduceReviewGraphV1(head.event_id, new Map([[root.event_id, root], [head.event_id, head]]), (previous, current) => ({ state: [...(previous ?? []), current.body.sequence], state_hash: stateHash }));
	assert.deepEqual(reduced.state, [0, 1]);
	assert.equal(reduced.sequence, 1);
	assert.throws(() => reduceReviewGraphV1(head.event_id, new Map([[root.event_id, root], [head.event_id, head]]), () => ({ state: {}, state_hash: "b".repeat(64) })), /state hash/i);
});
