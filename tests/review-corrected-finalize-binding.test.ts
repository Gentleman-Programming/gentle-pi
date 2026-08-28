import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";
import type { NativeReviewCli } from "../lib/native-review-cli.ts";
import { decodeReviewLastEventClosureV1, type ReviewStatusV3 } from "../lib/review-integration-v2.ts";

const CAPTURED_FIXTURES = join(process.cwd(), "tests", "fixtures", "devbinary");

test("captured correction-required result closes through the last event", () => {
	const fixture = JSON.parse(readFileSync(join(CAPTURED_FIXTURES, "last-event-capture-result-correction-required.captured.json"), "utf8"));
	const closure = decodeReviewLastEventClosureV1(fixture);
	assert.equal(closure.operation, "review/capture-result");
	assert.equal(closure.state, "correction_required");
	assert.match(closure.storeRevision, /^sha256:[a-f0-9]{64}$/);
});

test("current capture fails closed when fresh STATUS no longer offers the corrected candidate binding", async () => {
	const lineageId = "corrected-candidate";
	const sha = `sha256:${"a".repeat(64)}`;
	const binding = {
		name: "provider_targeted_validator",
		schema: "https://gentle-ai.dev/schema/review/targeted-validator/v1",
		captureOperation: "review.capture-validation",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "target", value: sha, token: `--target=${sha}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
	};
	let captureCalls = 0;
	const native = {
		targetStatus: async () => ({
			contract: "gentle-ai.review-integration/v2",
			applicability: "current_target",
			authority: { version: "compact-v2", lineageId, state: "correction_required", generation: 1, revision: sha },
			receipt: { status: "expected_missing" },
			action: "stop",
			replayability: "not_replayable",
			targetIdentity: sha,
			projection: { schema: "gentle-ai.review-candidate-projection/v1", kind: "current-changes", projection: "workspace", baseTree: "b".repeat(40), initialReviewTree: "b".repeat(40), currentCandidateTree: "c".repeat(40), pathsDigest: sha, paths: ["corrected.ts"], intendedUntracked: [], intendedUntrackedProof: sha, initialSnapshotIdentity: sha, currentSnapshotIdentity: sha },
			repair: { schema: "gentle-ai.review-authority-repair-assessment/v1", status: "unsupported", counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 }, supportedOperations: [], authorizationSchema: "gentle-ai.review-repair-authorization/v1" },
			candidates: [],
			nextTransition: { kind: "stop", reasonCode: "corrected_candidate_unavailable" },
			raw: { schema: "gentle-ai.review-integration.status/v5" },
		} as unknown as ReviewStatusV3),
		captureProviderRole: async () => { captureCalls += 1; throw new Error("must not capture"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(binding) }, process.cwd(), native);
	assert.equal(result.outcome, "capture-binding-rejected");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(captureCalls, 0);
});
