import {
	REVIEW_MODE,
	REVIEW_PROJECTION,
	SNAPSHOT_CLEANUP_ACTION,
	SNAPSHOT_CLEANUP_TRIGGER,
	type SnapshotV1,
	type ReviewMode,
} from "../lib/review-snapshot.ts";
import {
	REVIEW_EVENT,
	REVIEW_LENS,
	REVIEW_ROUTE,
	TRIVIALITY,
	type ReviewLens,
	type ReviewRoute,
} from "../lib/review-triggers.ts";

export interface TestSnapshotOptions {
	mode?: ReviewMode;
	baseTree: string;
	completeTree: string;
	initialTree?: string;
	route?: ReviewRoute;
	lenses?: readonly ReviewLens[];
	policyHash?: string;
}

export function testSnapshot(options: TestSnapshotOptions): SnapshotV1 {
	const route = options.route ?? REVIEW_ROUTE.TRIVIAL;
	const lenses = options.lenses ?? [];
	const initialTree = options.initialTree ?? options.completeTree;
	const selected = lenses[0];
	return {
		schema: "gentle-ai.review-snapshot/v1",
		mode: options.mode ?? REVIEW_MODE.ORDINARY,
		repository_root: "/test/repository",
		base_tree: options.baseTree,
		complete_snapshot_tree: options.completeTree,
		review_projection:
			initialTree === options.completeTree
				? { kind: REVIEW_PROJECTION.COMPLETE }
				: { kind: REVIEW_PROJECTION.INTENDED_COMMIT, tree: initialTree },
		initial_review_tree: initialTree,
		diff_evidence: {
			event: REVIEW_EVENT.ORDINARY_START,
			changedLines: route === REVIEW_ROUTE.FULL_4R ? 401 : route === REVIEW_ROUTE.TRIVIAL ? 1 : 10,
			triviality:
				route === REVIEW_ROUTE.TRIVIAL
					? TRIVIALITY.PROVEN
					: TRIVIALITY.NON_TRIVIAL,
			evidenceComplete: true,
			executableChanged: route !== REVIEW_ROUTE.TRIVIAL,
			configurationChanged: false,
			hotPathChanged: false,
			riskSignal: selected === REVIEW_LENS.RISK,
			resilienceSignal: selected === REVIEW_LENS.RESILIENCE,
			reliabilitySignal: selected === REVIEW_LENS.RELIABILITY,
		},
		route,
		lenses: [...lenses],
		policy_hash: options.policyHash ?? "a".repeat(64),
		object_store: {
			snapshot_directory: "/test/repository/.git/gentle-ai/reviews/snapshots/test",
			object_directory: "/test/repository/.git/gentle-ai/reviews/snapshots/test/objects",
			alternate_object_directory: "/test/repository/.git/objects",
			metadata_path: "/test/repository/.git/gentle-ai/reviews/snapshots/test/snapshot.json",
			sensitivity: "workspace-content",
			cleanup_trigger: SNAPSHOT_CLEANUP_TRIGGER.LINEAGE_TERMINAL,
			cleanup_action: SNAPSHOT_CLEANUP_ACTION.DELETE_ISOLATED_STORE,
		},
	};
}
