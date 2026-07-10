import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
	REVIEW_EVENT,
	REVIEW_ROUTE,
	buildDiffEvidence,
	classifyReviewRoute,
	type DiffEvidence,
	type ReviewLens,
	type ReviewRoute,
} from "./review-triggers.ts";

export const REVIEW_MODE = {
	ORDINARY: "ordinary",
	JUDGMENT_DAY: "judgment-day",
} as const;

export type ReviewMode = (typeof REVIEW_MODE)[keyof typeof REVIEW_MODE];

export const REVIEW_PROJECTION = {
	COMPLETE: "complete",
	INTENDED_COMMIT: "intended-commit",
} as const;

export type ReviewProjectionKind =
	(typeof REVIEW_PROJECTION)[keyof typeof REVIEW_PROJECTION];

export const SNAPSHOT_CLEANUP_TRIGGER = {
	LINEAGE_TERMINAL: "lineage-terminal",
} as const;

export type SnapshotCleanupTrigger =
	(typeof SNAPSHOT_CLEANUP_TRIGGER)[keyof typeof SNAPSHOT_CLEANUP_TRIGGER];

export const SNAPSHOT_CLEANUP_ACTION = {
	DELETE_ISOLATED_STORE: "delete-isolated-object-store",
} as const;

export type SnapshotCleanupAction =
	(typeof SNAPSHOT_CLEANUP_ACTION)[keyof typeof SNAPSHOT_CLEANUP_ACTION];

export interface CompleteReviewProjectionV1 {
	kind: typeof REVIEW_PROJECTION.COMPLETE;
}

export interface IntendedCommitReviewProjectionV1 {
	kind: typeof REVIEW_PROJECTION.INTENDED_COMMIT;
	tree: string;
}

export type ReviewProjectionV1 =
	| CompleteReviewProjectionV1
	| IntendedCommitReviewProjectionV1;

export interface ReviewSnapshotObjectStoreV1 {
	snapshot_directory: string;
	object_directory: string;
	alternate_object_directory: string;
	metadata_path: string;
	sensitivity: "workspace-content";
	cleanup_trigger: SnapshotCleanupTrigger;
	cleanup_action: SnapshotCleanupAction;
}

export interface SnapshotV1 {
	schema: "gentle-ai.review-snapshot/v1";
	mode: ReviewMode;
	repository_root: string;
	base_tree: string;
	complete_snapshot_tree: string;
	review_projection: ReviewProjectionV1;
	initial_review_tree: string;
	diff_evidence: DiffEvidence;
	route: ReviewRoute;
	lenses: readonly ReviewLens[];
	policy_hash: string;
	object_store: ReviewSnapshotObjectStoreV1;
}

export interface CaptureReviewSnapshotOptions {
	cwd: string;
	mode: ReviewMode;
	projection: ReviewProjectionV1;
	policyHash: string;
}

interface GitEnvironment {
	indexFile?: string;
	objectDirectory?: string;
	alternateObjectDirectory?: string;
}

interface SnapshotIdentityV1 {
	schema: "gentle-ai.review-snapshot-identity/v1";
	mode: ReviewMode;
	repository_root: string;
	base_tree: string;
	complete_snapshot_tree: string;
	review_projection: ReviewProjectionV1;
	initial_review_tree: string;
	diff_evidence: DiffEvidence;
	route: ReviewRoute;
	lenses: readonly ReviewLens[];
	policy_hash: string;
}

const OBJECT_ID = /^[0-9a-f]{40,64}$/;

function runGit(
	cwd: string,
	args: readonly string[],
	environment: GitEnvironment = {},
): string {
	const env = { ...process.env };
	if (environment.indexFile) env.GIT_INDEX_FILE = environment.indexFile;
	if (environment.objectDirectory) {
		env.GIT_OBJECT_DIRECTORY = environment.objectDirectory;
	}
	if (environment.alternateObjectDirectory) {
		env.GIT_ALTERNATE_OBJECT_DIRECTORIES = environment.alternateObjectDirectory;
	}
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env,
	}).trim();
}

function repositoryRoot(cwd: string): string {
	return runGit(cwd, ["rev-parse", "--show-toplevel"]);
}

function repositoryObjectDirectory(root: string): string {
	const path = runGit(root, ["rev-parse", "--git-path", "objects"]);
	return isAbsolute(path) ? path : resolve(root, path);
}

function snapshotsRoot(root: string): string {
	const gitPath = runGit(root, [
		"rev-parse",
		"--git-path",
		"gentle-ai/reviews/snapshots",
	]);
	return isAbsolute(gitPath) ? gitPath : resolve(root, gitPath);
}

function resolveBaseTree(root: string): string {
	try {
		return runGit(root, ["rev-parse", "--verify", "HEAD^{tree}"]);
	} catch {
		return runGit(root, ["mktree"]);
	}
}

function resolveTree(root: string, value: string): string {
	if (!OBJECT_ID.test(value)) {
		throw new Error("Review projection tree must be a resolved Git object ID");
	}
	try {
		return runGit(root, ["rev-parse", "--verify", `${value}^{tree}`]);
	} catch {
		throw new Error("Review projection tree cannot be resolved");
	}
}

function parseNumstat(value: string): { changedPaths: string[]; changedLines: number } {
	const changedPaths: string[] = [];
	let changedLines = 0;
	for (const line of value.split(/\r?\n/)) {
		if (line.length === 0) continue;
		const [added, deleted, path] = line.split("\t");
		if (path === undefined) continue;
		changedPaths.push(path);
		if (added !== "-" && deleted !== "-") {
			const addedLines = Number.parseInt(added ?? "", 10);
			const deletedLines = Number.parseInt(deleted ?? "", 10);
			if (Number.isSafeInteger(addedLines) && Number.isSafeInteger(deletedLines)) {
				changedLines += addedLines + deletedLines;
			}
		}
	}
	return { changedPaths, changedLines };
}

function snapshotId(identity: SnapshotIdentityV1): string {
	return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function assertExistingSnapshotMatches(
	metadataPath: string,
	identity: SnapshotIdentityV1,
): SnapshotV1 {
	const existing = JSON.parse(readFileSync(metadataPath, "utf8")) as SnapshotV1;
	const existingIdentity: SnapshotIdentityV1 = {
		schema: "gentle-ai.review-snapshot-identity/v1",
		mode: existing.mode,
		repository_root: existing.repository_root,
		base_tree: existing.base_tree,
		complete_snapshot_tree: existing.complete_snapshot_tree,
		review_projection: existing.review_projection,
		initial_review_tree: existing.initial_review_tree,
		diff_evidence: existing.diff_evidence,
		route: existing.route,
		lenses: existing.lenses,
		policy_hash: existing.policy_hash,
	};
	if (snapshotId(existingIdentity) !== snapshotId(identity)) {
		throw new Error("Existing review snapshot metadata does not match its identity");
	}
	return existing;
}

export function captureReviewSnapshot(
	options: CaptureReviewSnapshotOptions,
): SnapshotV1 {
	if (options.mode !== REVIEW_MODE.ORDINARY && options.mode !== REVIEW_MODE.JUDGMENT_DAY) {
		throw new Error("Unsupported review mode");
	}
	if (!/^[0-9a-f]{64}$/.test(options.policyHash)) {
		throw new Error("Review policy hash must be a SHA-256 digest");
	}
	const root = repositoryRoot(options.cwd);
	const baseTree = resolveBaseTree(root);
	const alternateObjectDirectory = repositoryObjectDirectory(root);
	const rootSnapshotsDirectory = snapshotsRoot(root);
	mkdirSync(rootSnapshotsDirectory, { recursive: true, mode: 0o700 });
	chmodSync(rootSnapshotsDirectory, 0o700);
	const stagingDirectory = mkdtempSync(join(rootSnapshotsDirectory, ".capture-"));
	chmodSync(stagingDirectory, 0o700);
	const temporaryIndex = join(stagingDirectory, "index");
	const temporaryObjectDirectory = join(stagingDirectory, "objects");
	mkdirSync(temporaryObjectDirectory, { mode: 0o700 });
	const gitEnvironment: GitEnvironment = {
		indexFile: temporaryIndex,
		objectDirectory: temporaryObjectDirectory,
		alternateObjectDirectory,
	};
	try {
		runGit(root, ["read-tree", baseTree], gitEnvironment);
		runGit(root, ["add", "-A", "--", "."], gitEnvironment);
		const completeSnapshotTree = runGit(root, ["write-tree"], gitEnvironment);
		let projection: ReviewProjectionV1;
		let initialReviewTree: string;
		if (options.projection.kind === REVIEW_PROJECTION.COMPLETE) {
			projection = { kind: REVIEW_PROJECTION.COMPLETE };
			initialReviewTree = completeSnapshotTree;
		} else if (options.projection.kind === REVIEW_PROJECTION.INTENDED_COMMIT) {
			initialReviewTree = resolveTree(root, options.projection.tree);
			projection = {
				kind: REVIEW_PROJECTION.INTENDED_COMMIT,
				tree: initialReviewTree,
			};
		} else {
			throw new Error("Unsupported review projection");
		}
		const diff = parseNumstat(
			runGit(
				root,
				["diff", "--numstat", "--no-renames", baseTree, completeSnapshotTree],
				gitEnvironment,
			),
		);
		const diffEvidence = buildDiffEvidence(REVIEW_EVENT.ORDINARY_START, diff);
		const plan =
			options.mode === REVIEW_MODE.ORDINARY
				? classifyReviewRoute(diffEvidence)
				: {
						route: REVIEW_ROUTE.TRIVIAL,
						lenses: [] as const,
					};
		const identity: SnapshotIdentityV1 = {
			schema: "gentle-ai.review-snapshot-identity/v1",
			mode: options.mode,
			repository_root: root,
			base_tree: baseTree,
			complete_snapshot_tree: completeSnapshotTree,
			review_projection: projection,
			initial_review_tree: initialReviewTree,
			diff_evidence: diffEvidence,
			route: plan.route,
			lenses: [...plan.lenses],
			policy_hash: options.policyHash,
		};
		const id = snapshotId(identity);
		const finalDirectory = join(rootSnapshotsDirectory, id);
		const finalObjectDirectory = join(finalDirectory, "objects");
		const metadataPath = join(finalDirectory, "snapshot.json");
		const snapshot: SnapshotV1 = {
			schema: "gentle-ai.review-snapshot/v1",
			mode: options.mode,
			repository_root: root,
			base_tree: baseTree,
			complete_snapshot_tree: completeSnapshotTree,
			review_projection: projection,
			initial_review_tree: initialReviewTree,
			diff_evidence: diffEvidence,
			route: plan.route,
			lenses: Object.freeze([...plan.lenses]),
			policy_hash: options.policyHash,
			object_store: {
				snapshot_directory: finalDirectory,
				object_directory: finalObjectDirectory,
				alternate_object_directory: alternateObjectDirectory,
				metadata_path: metadataPath,
				sensitivity: "workspace-content",
				cleanup_trigger: SNAPSHOT_CLEANUP_TRIGGER.LINEAGE_TERMINAL,
				cleanup_action: SNAPSHOT_CLEANUP_ACTION.DELETE_ISOLATED_STORE,
			},
		};
		writeFileSync(join(stagingDirectory, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, {
			mode: 0o600,
		});
		chmodSync(join(stagingDirectory, "snapshot.json"), 0o600);
		rmSync(temporaryIndex, { force: true });
		if (existsSync(finalDirectory)) {
			rmSync(stagingDirectory, { recursive: true, force: true });
			return assertExistingSnapshotMatches(metadataPath, identity);
		}
		renameSync(stagingDirectory, finalDirectory);
		return snapshot;
	} catch (error) {
		rmSync(stagingDirectory, { recursive: true, force: true });
		throw error;
	}
}

export function cleanupReviewSnapshot(snapshot: SnapshotV1): void {
	const expectedRoot = resolve(snapshotsRoot(snapshot.repository_root));
	const directory = resolve(snapshot.object_store.snapshot_directory);
	if (!directory.startsWith(`${expectedRoot}${sep}`)) {
		throw new Error("Review snapshot cleanup path is outside the repository snapshot store");
	}
	if (
		snapshot.object_store.cleanup_trigger !==
			SNAPSHOT_CLEANUP_TRIGGER.LINEAGE_TERMINAL ||
		snapshot.object_store.cleanup_action !==
			SNAPSHOT_CLEANUP_ACTION.DELETE_ISOLATED_STORE
	) {
		throw new Error("Review snapshot has an unsupported cleanup policy");
	}
	rmSync(directory, { recursive: true, force: true });
}
