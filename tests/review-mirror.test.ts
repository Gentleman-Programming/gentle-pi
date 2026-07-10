import assert from "node:assert/strict";
import test from "node:test";
import { ReviewMirrorStore, type VerifiedGraphObject } from "../lib/review-mirror.ts";
import { createReviewEventV1 } from "../lib/review-graph-schema.ts";
import { canonicalJsonV1 } from "../lib/review-canonical.ts";

test("mirror caches only verified immutable objects and exposes no authority surface", () => {
	const mirror = new ReviewMirrorStore();
	const event = createReviewEventV1({ lineage_id: "mirror-lineage", sequence: 0, predecessor_event_id: null, kind: "lineage-created", payload: {}, reduced_state_hash: "a".repeat(64) });
	const object = mirror.putVerifiedObject(new TextEncoder().encode(canonicalJsonV1(event)));
	assert.equal(object.eventId, event.event_id);
	assert.deepEqual(mirror.inspectCompleteness([event.event_id]), { declaredRoots: [event.event_id], complete: true, missingObjectIds: [] });
	assert.equal(mirror.getVerifiedObject(event.event_id)?.eventId, event.event_id);
	assert.equal("createAuthoritativeReceipt" in mirror, false);
	assert.equal("publishRootSet" in mirror, false);
	assert.equal("validateGate" in mirror, false);
	assert.throws(() => mirror.putVerifiedObject(new TextEncoder().encode({ ...event, event_id: "b".repeat(64) })), /identity/i);
	const forged = { ...object } as VerifiedGraphObject;
	assert.equal("authorityId" in forged, false);
});
