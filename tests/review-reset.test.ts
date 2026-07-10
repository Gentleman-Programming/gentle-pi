import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectLegacyReviewAuthorityV1 } from "../lib/review-legacy-detector.ts";
import { destructiveResetReviewAuthorityV1 } from "../lib/review-reset.ts";
import { resolveRepositoryAuthorityV1 } from "../lib/review-repository.ts";
import { REVIEW_MODE, ReviewTransactionStore, createReviewState } from "../lib/review-transaction.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
import { qualifiedReviewLockPlatform, testSnapshot } from "./review-test-fixtures.ts";

function repository(): string {
	const root = mkdtempSync(join(tmpdir(), "review-reset-"));
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
	writeFileSync(join(root, "README.md"), "test\n");
	execFileSync("git", ["-C", root, "add", "README.md"]);
	execFileSync("git", ["-C", root, "commit", "-qm", "initial"]);
	return root;
}

function currentBranch(root: string): string {
	return execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
}

function addOrphanRoot(root: string, branch: string, file: string): void {
	const original = currentBranch(root);
	execFileSync("git", ["-C", root, "checkout", "-q", "--orphan", branch]);
	writeFileSync(join(root, file), `${file}\n`);
	execFileSync("git", ["-C", root, "add", file]);
	execFileSync("git", ["-C", root, "commit", "-qm", `orphan root on ${branch}`]);
	execFileSync("git", ["-C", root, "checkout", "-q", original]);
}

function createLineage(cwd: string, lineageId = "recovery-lineage"): void {
	const store = ReviewTransactionStore.forRepository(cwd, { mutationLockPlatform: qualifiedReviewLockPlatform() });
	store.create(createReviewState({
		lineageId,
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({ baseTree: "1".repeat(40), completeTree: "2".repeat(40), route: REVIEW_ROUTE.STANDARD, lenses: [REVIEW_LENS.RELIABILITY] }),
		evidenceHash: "a".repeat(64),
		budget: { review_batches: 1, review_actors: 1, refuter_batches: 1, fix_batches: 1, validator_runs: 1, final_verifications: 1, judgment_rounds: 0, judge_runs: 0 },
	}), "start");
}

function legacy(root: string): void {
	mkdirSync(join(root, ".git", "gentle-ai", "reviews", "lineages", "legacy", "revisions"), { recursive: true });
	writeFileSync(join(root, ".git", "gentle-ai", "reviews", "lineages", "legacy", "HEAD"), "legacy authority");
	mkdirSync(join(root, ".git", "gentle-ai", "reviews", "locks"), { recursive: true });
}

test("legacy and mixed review stores fail closed until the exact destructive reset challenge is supplied", () => {
	const cwd = repository();
	try {
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		assert.equal(inspection.outcome, "blocked-legacy");
		assert.throws(() => ReviewTransactionStore.forRepository(cwd), /legacy|reset/i);
		assert.throws(() => destructiveResetReviewAuthorityV1({ cwd, confirmation: "yes", mutationLockPlatform: qualifiedReviewLockPlatform() }), /confirmation/i);
		const result = destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, mutationLockPlatform: qualifiedReviewLockPlatform() });
		assert.equal(result.store.initialization_kind, "destructive-reset");
		assert.equal(existsSync(join(cwd, ".git", "gentle-ai", "reviews", "lineages")), false);
		assert.equal(ReviewTransactionStore.forRepository(cwd, { mutationLockPlatform: qualifiedReviewLockPlatform() }).readCurrentAuthority().body.lineages.length, 0);
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("reset state is durable and incomplete state blocks authority until explicit resume", () => {
	const cwd = repository();
	try {
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		assert.throws(() => destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, mutationLockPlatform: qualifiedReviewLockPlatform(), faultAfterPhase: "quarantining" }), /injected/i);
		assert.throws(() => ReviewTransactionStore.forRepository(cwd), /reset/i);
		const state = destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, resume: true, mutationLockPlatform: qualifiedReviewLockPlatform() });
		assert.equal(state.store.initialization_kind, "destructive-reset");
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("reset resume accepts the clean post-quarantine state and preserves its initialized incarnation", () => {
	const cwd = repository();
	try {
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		assert.throws(() => destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, mutationLockPlatform: qualifiedReviewLockPlatform(), faultAfterPhase: "verifying" }), /injected/i);
		const state = JSON.parse(readFileSync(join(cwd, ".git", "gentle-ai", "reviews", "control", "reset-state.json"), "utf8")) as { body: { store_epoch: string } };
		const resumed = destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, resume: true, mutationLockPlatform: qualifiedReviewLockPlatform() });
		assert.equal(resumed.store.store_epoch, state.body.store_epoch);
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("repository resolution rejects inherited Git routing overrides before touching review storage", () => {
	const cwd = repository();
	try {
		const original = process.env.GIT_DIR;
		process.env.GIT_DIR = "";
		assert.throws(() => inspectLegacyReviewAuthorityV1(cwd), /REVIEW_GIT_ENV_UNSAFE/);
		if (original === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = original;
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("reset persists its incarnation before STORE publication and resumes the exact identity", () => {
	const cwd = repository();
	try {
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		assert.throws(() => destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, mutationLockPlatform: qualifiedReviewLockPlatform(), faultAfterPhase: "initializing" }), /injected/i);
		const state = JSON.parse(readFileSync(join(cwd, ".git", "gentle-ai", "reviews", "control", "reset-state.json"), "utf8")) as { body: { store_epoch?: string; authority_incarnation_id?: string } };
		assert.match(state.body.store_epoch ?? "", /^[0-9a-f]{64}$/);
		assert.match(state.body.authority_incarnation_id ?? "", /^[0-9a-f]{64}$/);
		const resumed = destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, resume: true, mutationLockPlatform: qualifiedReviewLockPlatform() });
		assert.equal(resumed.store.store_epoch, state.body.store_epoch);
		assert.equal(resumed.store.authority_incarnation_id, state.body.authority_incarnation_id);
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});


function storeRoot(cwd: string): string {
	return join(cwd, ".git", "gentle-ai", "reviews");
}

function quarantinePath(cwd: string): string {
	const state = JSON.parse(
		readFileSync(join(storeRoot(cwd), "control", "reset-state.json"), "utf8"),
	) as { body: { quarantine_relative_path: string } };
	return join(storeRoot(cwd), "control", state.body.quarantine_relative_path);
}

test("reset resume forward-recovers a genesis quorum-loss crash in the graph-v1 store instead of throwing uncaught", () => {
	const cwd = repository();
	try {
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		const first = destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, mutationLockPlatform: qualifiedReviewLockPlatform() });
		assert.equal(first.store.initialization_kind, "destructive-reset");
		const graphRoot = join(storeRoot(cwd), "graph-v1");
		// Simulate a crash that left only CURRENT.0 durably published.
		unlinkSync(join(graphRoot, "CURRENT.1"));
		unlinkSync(join(graphRoot, "CURRENT.2"));
		assert.throws(
			() => ReviewTransactionStore.forRepository(cwd, { mutationLockPlatform: qualifiedReviewLockPlatform() }).readCurrentAuthority(),
			/quorum/i,
		);
		const resumed = destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, resume: true, mutationLockPlatform: qualifiedReviewLockPlatform() });
		assert.equal(resumed.store.store_epoch, first.store.store_epoch);
		assert.equal(
			ReviewTransactionStore.forRepository(cwd, { mutationLockPlatform: qualifiedReviewLockPlatform() }).readCurrentAuthority().body.lineages.length,
			0,
		);
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("quarantine move rejects a legacy root replaced by a symlink inside the race window", () => {
	const cwd = repository();
	const outside = mkdtempSync(join(tmpdir(), "review-reset-race-outside-"));
	try {
		writeFileSync(join(outside, "sentinel.txt"), "outside authority\n");
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		let injected = false;
		assert.throws(
			() =>
				destructiveResetReviewAuthorityV1({
					cwd,
					...inspection.reset_request,
					mutationLockPlatform: qualifiedReviewLockPlatform(),
					raceWindowHook: (event) => {
						if (injected || event.operation !== "quarantine-move" || !event.path.endsWith("lineages")) return;
						injected = true;
						rmSync(event.path, { recursive: true, force: true });
						symlinkSync(outside, event.path);
					},
				}),
			/REVIEW_RESET_RACE_UNSAFE/,
		);
		assert.equal(injected, true);
		assert.equal(readFileSync(join(outside, "sentinel.txt"), "utf8"), "outside authority\n");
		assert.throws(() => ReviewTransactionStore.forRepository(cwd), /reset/i);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("quarantine move rejects a destination parent substituted by a symlink inside the race window", () => {
	const cwd = repository();
	const outside = mkdtempSync(join(tmpdir(), "review-reset-race-destination-"));
	try {
		writeFileSync(join(outside, "sentinel.txt"), "outside destination\n");
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		let injected = false;
		assert.throws(
			() =>
				destructiveResetReviewAuthorityV1({
					cwd,
					...inspection.reset_request,
					mutationLockPlatform: qualifiedReviewLockPlatform(),
					raceWindowHook: (event) => {
						if (injected || event.operation !== "quarantine-move") return;
						injected = true;
						const quarantine = quarantinePath(cwd);
						renameSync(quarantine, `${quarantine}.moved`);
						symlinkSync(outside, quarantine);
					},
				}),
			/REVIEW_RESET_RACE_UNSAFE/,
		);
		assert.equal(injected, true);
		assert.equal(existsSync(join(outside, "lineages")), false);
		assert.equal(readFileSync(join(outside, "sentinel.txt"), "utf8"), "outside destination\n");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("quarantine delete rejects a quarantine parent substituted by a symlink inside the race window", () => {
	const cwd = repository();
	const outside = mkdtempSync(join(tmpdir(), "review-reset-race-delete-"));
	try {
		mkdirSync(join(outside, "lineages"), { recursive: true });
		writeFileSync(join(outside, "lineages", "sentinel.txt"), "outside delete target\n");
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		let injected = false;
		assert.throws(
			() =>
				destructiveResetReviewAuthorityV1({
					cwd,
					...inspection.reset_request,
					mutationLockPlatform: qualifiedReviewLockPlatform(),
					raceWindowHook: (event) => {
						if (injected || event.operation !== "quarantine-delete") return;
						injected = true;
						const quarantine = quarantinePath(cwd);
						renameSync(quarantine, `${quarantine}.moved`);
						symlinkSync(outside, quarantine);
					},
				}),
			/REVIEW_RESET_RACE_UNSAFE/,
		);
		assert.equal(injected, true);
		assert.equal(
			readFileSync(join(outside, "lineages", "sentinel.txt"), "utf8"),
			"outside delete target\n",
		);
		assert.throws(() => ReviewTransactionStore.forRepository(cwd), /reset/i);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("race-rejected reset stays fail-closed and completes only through explicit forward resume", () => {
	const cwd = repository();
	const outside = mkdtempSync(join(tmpdir(), "review-reset-race-resume-"));
	try {
		legacy(cwd);
		const inspection = inspectLegacyReviewAuthorityV1(cwd);
		let injected = false;
		assert.throws(
			() =>
				destructiveResetReviewAuthorityV1({
					cwd,
					...inspection.reset_request,
					mutationLockPlatform: qualifiedReviewLockPlatform(),
					raceWindowHook: (event) => {
						if (injected || event.operation !== "quarantine-move" || !event.path.endsWith("lineages")) return;
						injected = true;
						rmSync(event.path, { recursive: true, force: true });
						symlinkSync(outside, event.path);
					},
				}),
			/REVIEW_RESET_RACE_UNSAFE/,
		);
		assert.throws(() => ReviewTransactionStore.forRepository(cwd), /reset/i);
		unlinkSync(join(storeRoot(cwd), "lineages"));
		const resumed = destructiveResetReviewAuthorityV1({
			cwd,
			...inspection.reset_request,
			resume: true,
			mutationLockPlatform: qualifiedReviewLockPlatform(),
		});
		assert.equal(resumed.store.initialization_kind, "destructive-reset");
		assert.equal(
			ReviewTransactionStore.forRepository(cwd, { mutationLockPlatform: qualifiedReviewLockPlatform() })
				.readCurrentAuthority().body.lineages.length,
			0,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("repository authority rejects a symlinked managed store before reset can mutate it", () => {
	const cwd = repository();
	const outside = mkdtempSync(join(tmpdir(), "review-reset-outside-"));
	try {
		mkdirSync(join(cwd, ".git", "gentle-ai"), { recursive: true });
		rmSync(join(cwd, ".git", "gentle-ai"), { recursive: true, force: true });
		symlinkSync(outside, join(cwd, ".git", "gentle-ai"));
		assert.throws(() => inspectLegacyReviewAuthorityV1(cwd), /symlink|reparse|store path/i);
	} finally { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("explicit allowBrokenIdentity recovery re-pins a store whose pinned root commit was removed by history rewrite, while ordinary access and a plain reset both stay fail-closed", () => {
	const cwd = repository();
	try {
		addOrphanRoot(cwd, "second-root", "second.txt");
		createLineage(cwd);
		const before = resolveRepositoryAuthorityV1(cwd);
		assert.equal(before.repository_identity.root_commit_ids.length, 2);

		execFileSync("git", ["-C", cwd, "branch", "-D", "second-root"]);

		// (a) ordinary access stays fail-closed once the pin is broken.
		assert.throws(() => resolveRepositoryAuthorityV1(cwd), /pinned|authority/i);
		assert.throws(() => ReviewTransactionStore.forRepository(cwd, { mutationLockPlatform: qualifiedReviewLockPlatform() }), /pinned|authority/i);

		// A default (non-recovery) destructive reset must also stay fail-closed:
		// there is no legacy/mixed authority here, only a broken pin, and the
		// default path must not be able to bypass identity validation.
		assert.throws(
			() => destructiveResetReviewAuthorityV1({ cwd, repositoryId: "x", commonDirHash: "y", inventoryHash: "z", confirmation: "w", mutationLockPlatform: qualifiedReviewLockPlatform() }),
			/pinned|authority/i,
		);

		// (b) the explicit recovery path detects the break, quarantines, and
		// re-pins from the current live root set.
		const inspection = inspectLegacyReviewAuthorityV1(cwd, { allowBrokenIdentity: true });
		assert.equal(inspection.identity_broken, true);
		const result = destructiveResetReviewAuthorityV1({ cwd, ...inspection.reset_request, allowBrokenIdentity: true, mutationLockPlatform: qualifiedReviewLockPlatform() });
		assert.equal(result.store.initialization_kind, "destructive-reset");

		const after = resolveRepositoryAuthorityV1(cwd);
		assert.equal(after.repository_identity.root_commit_ids.length, 1);
		assert.equal(inspectLegacyReviewAuthorityV1(cwd).identity_broken, false);

		// the store is usable afterward
		const store = ReviewTransactionStore.forRepository(cwd, { mutationLockPlatform: qualifiedReviewLockPlatform() });
		assert.equal(store.readCurrentAuthority().body.lineages.length, 0);
		createLineage(cwd, "post-recovery-lineage");
		assert.equal(store.read("post-recovery-lineage").lineage_id, "post-recovery-lineage");
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});
