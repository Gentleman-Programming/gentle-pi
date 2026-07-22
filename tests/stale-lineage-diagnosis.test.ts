import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";
import type { ReviewStatusV1 } from "../lib/review-integration-v1.ts";

const { explainStaleLineageDuringValidate } = __testing;

const sha = `sha256:${"a".repeat(64)}`;

function makeStatus(overrides: Partial<ReviewStatusV1>): ReviewStatusV1 {
	return {
		schema: "gentle-ai.review-integration.status/v1",
		applicability: "ambiguous",
		action: "select_lineage",
		replayability: "status_required",
		candidates: ["lineage-a", "lineage-b"],
		current_target: {
			base_tree: "b".repeat(40),
			current_candidate_tree: "c".repeat(40),
			paths_digest: sha,
			paths: ["app.ts"],
			current_snapshot_identity: sha,
			projection: "staged",
		},
		authority: null,
		receipt: { status: "not_applicable" },
		raw: {},
		...overrides,
	} as ReviewStatusV1;
}

test("explainStaleLineageDuringValidate marks lineage as stale and surfaces applicability", () => {
	const status = makeStatus({ applicability: "ambiguous", action: "select_lineage", replayability: "status_required" });
	const diagnosis = explainStaleLineageDuringValidate(status, "lineage-stale", "/worktrees/wt");
	assert.equal(diagnosis.stale_lineage, true);
	assert.match(diagnosis.summary, /lineage lineage-stale/);
	assert.match(diagnosis.summary, /ambiguous/);
	assert.equal(diagnosis.next_action, "start-fresh-lineage");
	assert.match(diagnosis.command_suggestion, /workspace-overlay=true/);
	assert.match(diagnosis.bypass_hint, /subprocess.run/);
	assert.equal(diagnosis.bypass_path, "/worktrees/wt");
});

test("explainStaleLineageDuringValidate suggests start-fresh-lineage for unrelated applicability", () => {
	const status = makeStatus({ applicability: "unrelated", action: "start", replayability: "not_replayable" });
	const diagnosis = explainStaleLineageDuringValidate(status, "lineage-x", "/worktrees/wt");
	assert.equal(diagnosis.next_action, "start-fresh-lineage");
	assert.match(diagnosis.command_suggestion, /operation=start/);
});

test("explainStaleLineageDuringValidate suggests recover-or-reset for corrupted applicability", () => {
	const status = makeStatus({ applicability: "corrupted", action: "repair_authority", replayability: "manual_action_required" });
	const diagnosis = explainStaleLineageDuringValidate(status, "lineage-y", "/worktrees/wt");
	assert.equal(diagnosis.next_action, "recover-or-reset");
	assert.match(diagnosis.command_suggestion, /operation=recover/);
});

test("explainStaleLineageDuringValidate handles missing requestedLineageId", () => {
	const status = makeStatus({ applicability: "unrelated", action: "start", replayability: "not_replayable" });
	const diagnosis = explainStaleLineageDuringValidate(status, undefined, "/worktrees/wt");
	assert.match(diagnosis.summary, /unspecified/);
	assert.equal(diagnosis.next_action, "start-fresh-lineage");
});

test("explainStaleLineageDuringValidate always surfaces a bypass hint", () => {
	const status = makeStatus({ applicability: "ambiguous", action: "select_lineage", replayability: "status_required" });
	const diagnosis = explainStaleLineageDuringValidate(status, "lineage-z", "/worktrees/wt");
	assert.ok(diagnosis.bypass_hint);
	assert.ok(diagnosis.bypass_hint.length > 50, "bypass_hint should be substantive");
	assert.match(diagnosis.bypass_hint, /subprocess/);
});
