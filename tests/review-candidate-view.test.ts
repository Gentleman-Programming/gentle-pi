import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	CandidateViewRegistry,
	CandidateViewError,
	type CandidateGitExecutor,
	createCandidateView,
	injectReviewCandidateView,
} from "../lib/review-candidate-view.ts";

function git(cwd: string, ...arguments_: string[]): string {
	return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-candidate-view-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	git(cwd, "init", "-b", "main");
	writeFileSync(join(cwd, "tracked.txt"), "base\n");
	git(cwd, "add", "tracked.txt");
	git(cwd, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "base");
	return cwd;
}

test("candidate view Git commands have a finite timeout and block materialization before worktree execution", (t) => {
	const calls: Array<{ arguments: readonly string[]; timeout: number | undefined }> = [];
	const executor: CandidateGitExecutor = (_file, arguments_, options) => { calls.push({ arguments: arguments_, timeout: options.timeout }); throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true }); };
	assert.throws(() => new CandidateViewRegistry(executor).create({ contributorRoot: repository(t) }), (error: unknown) => error instanceof CandidateViewError && /timed out/.test(error.message));
	assert.deepEqual(calls, [{ arguments: ["rev-parse", "--git-common-dir"], timeout: 10_000 }]);
	assert.equal(calls.some((call) => call.arguments[0] === "worktree"), false);
});

test("committed-only candidate views scope an explicit base to committed changes and exclude dirty worktree files", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	writeFileSync(join(contributorRoot, "committed-after-base.txt"), "committed after base\n");
	git(contributorRoot, "add", "committed-after-base.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "committed after base");
	writeFileSync(join(contributorRoot, "tracked.txt"), "dirty after base\n");
	writeFileSync(join(contributorRoot, "untracked.txt"), "untracked after base\n");
	const view = new CandidateViewRegistry().create({ contributorRoot, baseRef: baseCommit, committedOnly: true });
	try {
		assert.deepEqual(view.paths, ["committed-after-base.txt"]);
		assert.equal(view.committedOnly, true);
		assert.equal(view.baseCommit, baseCommit);
		assert.equal(view.baseTree, git(contributorRoot, "rev-parse", `${baseCommit}^{tree}`));
		assert.equal(readFileSync(join(view.root, "tracked.txt"), "utf8"), "base\n");
		assert.equal(lstatSync(join(view.root, "untracked.txt"), { throwIfNoEntry: false }), undefined);
	} finally {
		view.cleanup();
	}
});

test("explicit base refs reject ambiguous DWIM names even when they resolve identically, while full refs stay valid", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	git(contributorRoot, "branch", "same-commit", baseCommit);
	git(contributorRoot, "tag", "same-commit", baseCommit);
	git(contributorRoot, "update-ref", "refs/remotes/origin/main", baseCommit);
	assert.throws(
		() => new CandidateViewRegistry().create({ contributorRoot, baseRef: "same-commit" }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "base-ref-ambiguous",
	);
	for (const [baseRef, expectedCommit] of [
		["refs/heads/same-commit", baseCommit],
		["refs/tags/same-commit", baseCommit],
		["origin/main", baseCommit],
		[baseCommit, baseCommit],
	] as const) {
		const view = new CandidateViewRegistry().create({ contributorRoot, baseRef });
		try {
			assert.equal(view.baseCommit, expectedCommit);
		} finally {
			view.cleanup();
		}
	}
	commitFileAfterBase(contributorRoot);
	const tipCommit = git(contributorRoot, "rev-parse", "HEAD");
	git(contributorRoot, "branch", "different-commit", baseCommit);
	git(contributorRoot, "tag", "different-commit", baseCommit);
	git(contributorRoot, "branch", "-f", "different-commit", tipCommit);
	assert.throws(
		() => new CandidateViewRegistry().create({ contributorRoot, baseRef: "different-commit" }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "base-ref-ambiguous",
	);
	for (const [baseRef, expectedCommit] of [
		["refs/heads/different-commit", tipCommit],
		["refs/tags/different-commit", baseCommit],
	] as const) {
		const view = new CandidateViewRegistry().create({ contributorRoot, baseRef });
		try {
			assert.equal(view.baseCommit, expectedCommit);
		} finally {
			view.cleanup();
		}
	}
});

test("candidate view defaults its frozen base identity to HEAD", (t) => {
	const contributorRoot = repository(t);
	commitFileAfterBase(contributorRoot);
	writeFileSync(join(contributorRoot, "tracked.txt"), "dirty after HEAD\n");
	const view = new CandidateViewRegistry().create({ contributorRoot });
	try {
		assert.equal(view.baseCommit, git(contributorRoot, "rev-parse", "HEAD"));
		assert.equal(view.baseTree, git(contributorRoot, "rev-parse", "HEAD^{tree}"));
		assert.deepEqual(view.paths, ["tracked.txt"]);
	} finally {
		view.cleanup();
	}
});

test("candidate view rejects invalid or moving base refs and restores the frozen base tree after reload", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	commitFileAfterBase(contributorRoot);
	writeFileSync(join(contributorRoot, "tracked.txt"), "dirty after base\n");
	assert.throws(
		() => new CandidateViewRegistry().create({ contributorRoot, baseRef: "refs/heads/missing-base" }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "base-ref-unresolvable",
	);
	git(contributorRoot, "branch", "moving-base", baseCommit);
	let baseResolutions = 0;
	const movingExecutor: CandidateGitExecutor = (file, arguments_, options) => {
		if (arguments_.at(-1) === "moving-base^{commit}" && ++baseResolutions === 2) git(contributorRoot, "branch", "-f", "moving-base", "HEAD");
		return execFileSync(file, arguments_, options);
	};
	assert.throws(
		() => new CandidateViewRegistry(movingExecutor).create({ contributorRoot, baseRef: "moving-base" }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "base-ref-moved",
	);
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot, baseRef: baseCommit, committedOnly: true });
	const state = {
		lineageId: "restored-explicit-base",
		contributorRoot,
		baseCommit: frozen.baseCommit,
		baseTree: frozen.baseTree,
		candidateTree: frozen.candidateTree,
		committedOnly: true,
		paths: frozen.paths,
		modes: frozen.modes,
		deletedPaths: frozen.deletedPaths,
		selectedLenses: ["review-reliability"],
	};
	const restored = new CandidateViewRegistry();
	try {
		restored.restoreCurrentFromAuthoritativeReviewingStates(contributorRoot, [state]);
		const view = restored.resolveCurrentForLens("review-reliability");
		assert.equal(view.baseCommit, baseCommit);
		assert.equal(view.baseTree, git(contributorRoot, "rev-parse", `${baseCommit}^{tree}`));
		assert.equal(view.committedOnly, true);
		assert.deepEqual(view.paths, ["committed-after-base.txt"]);
	} finally {
		source.cleanup(frozen.token);
		const restoredView = restored.resolveCurrentForLens("review-reliability");
		restored.cleanup(restoredView.token);
	}
});

function commitFileAfterBase(cwd: string): void {
	writeFileSync(join(cwd, "committed-after-base.txt"), "committed after base\n");
	git(cwd, "add", "committed-after-base.txt");
	git(cwd, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "committed after base");
}

test("candidate view materializes exact tracked and initially-untracked content while contributor diverges", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "frozen tracked\n");
	writeFileSync(join(contributorRoot, "new.txt"), "frozen new\n");
	const view = createCandidateView({ contributorRoot });
	t.after(() => view.cleanup());
	assert.equal(readFileSync(join(view.root, "tracked.txt"), "utf8"), "frozen tracked\n");
	assert.equal(readFileSync(join(view.root, "new.txt"), "utf8"), "frozen new\n");
	assert.deepEqual(view.paths, ["new.txt", "tracked.txt"]);
	assert.deepEqual(view.modes, { "new.txt": "100644", "tracked.txt": "100644" });
	assert.equal(lstatSync(view.root).isSymbolicLink(), false);
	writeFileSync(join(contributorRoot, "tracked.txt"), "live divergence\n");
	assert.equal(readFileSync(join(view.root, "tracked.txt"), "utf8"), "frozen tracked\n");
	view.verify();
	view.cleanup();
});

test("candidate view recursively protects nested content and worktree metadata, and rejects injected untracked entries", (t) => {
	const contributorRoot = repository(t);
	mkdirSync(join(contributorRoot, "nested", "deeper"), { recursive: true });
	writeFileSync(join(contributorRoot, "nested", "deeper", "candidate.txt"), "candidate\n");
	const view = createCandidateView({ contributorRoot });
	try {
		assert.equal(lstatSync(join(view.root, "nested")).mode & 0o222, 0);
		assert.equal(lstatSync(join(view.root, "nested", "deeper")).mode & 0o222, 0);
		assert.equal(lstatSync(join(view.root, ".git")).mode & 0o222, 0);
		chmodSync(view.root, 0o755);
		chmodSync(join(view.root, "nested"), 0o755);
		chmodSync(join(view.root, "nested", "deeper"), 0o755);
		writeFileSync(join(view.root, "nested", "deeper", "injected.txt"), "injected\n");
		chmodSync(join(view.root, "nested", "deeper"), 0o555);
		chmodSync(join(view.root, "nested"), 0o555);
		chmodSync(view.root, 0o555);
		assert.throws(() => view.verify(), /untracked/);
	} finally {
		view.cleanup();
	}
});

test("candidate view registry rejects unsafe, moved, writable, stale, and unselected lens contexts before dispatch", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	t.after(() => registry.cleanup(view.token));
	registry.bind({ token: view.token, lineageId: "lineage-1", selectedLenses: ["review-risk"] });
	assert.equal(registry.resolveForLens("lineage-1", "review-risk").root, view.root);
	for (const lens of ["review-resilience", "review-readability", "review-reliability"]) {
		assert.throws(() => registry.resolveForLens("lineage-1", lens), CandidateViewError);
	}
	chmodSync(view.root, 0o755);
	assert.throws(() => registry.resolveForLens("lineage-1", "review-risk"), CandidateViewError);
	chmodSync(view.root, 0o755);
	chmodSync(join(view.root, "tracked.txt"), 0o644);
	writeFileSync(join(view.root, "tracked.txt"), "corrupt\n");
	chmodSync(view.root, 0o555);
	chmodSync(join(view.root, "tracked.txt"), 0o444);
	assert.throws(() => registry.resolveForLens("lineage-1", "review-risk"), CandidateViewError);
	registry.cleanup(view.token);
});

test("review subagent dispatch rejects missing candidate views and uses the explicitly current overlapping lens", (t) => {
	const missing = new CandidateViewRegistry();
	assert.throws(
		() => injectReviewCandidateView({ agent: "review-risk", task: "review", mode: "task" }, missing),
		CandidateViewError,
	);
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const registry = new CandidateViewRegistry();
	const first = registry.create({ contributorRoot });
	registry.bind({ token: first.token, lineageId: "first", selectedLenses: ["review-risk"] });
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate two\n");
	const second = registry.create({ contributorRoot });
	registry.bindCurrent({ token: second.token, lineageId: "second", selectedLenses: ["review-risk"] });
	const dispatch = { agent: "review-risk", task: "review", mode: "task" };
	assert.doesNotThrow(() => injectReviewCandidateView(dispatch, registry));
	assert.match(dispatch.task, new RegExp(`Frozen candidate tree: \`${second.candidateTree}\``));
	registry.cleanup(first.token);
	registry.cleanup(second.token);
});

test("candidate view rejects control-character paths before prompt construction", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "unsafe\npath.txt"), "candidate\n");
	assert.throws(() => createCandidateView({ contributorRoot }), CandidateViewError);
});

test("candidate view cleanup is confined and idempotent", (t) => {
	const contributorRoot = repository(t);
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	const outside = join(contributorRoot, "outside.txt");
	writeFileSync(outside, "preserve\n");
	registry.cleanup(view.token);
	registry.cleanup(view.token);
	assert.equal(readFileSync(outside, "utf8"), "preserve\n");
	assert.equal(lstatSync(view.root, { throwIfNoEntry: false }), undefined);
});

test("corrected views stay within frozen scope and replace projections only when promoted", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewed\n");
	const registry = new CandidateViewRegistry();
	const initial = registry.create({ contributorRoot }); registry.bind({ token: initial.token, lineageId: "correction", selectedLenses: ["review-risk"] });
	writeFileSync(join(contributorRoot, "tracked.txt"), "corrected\n");
	const corrected = registry.createCorrected("correction", contributorRoot);
	assert.notEqual(corrected.candidateTree, initial.candidateTree);
	assert.equal(registry.resolveProjection("correction", contributorRoot).candidateTree, initial.candidateTree);
	registry.promoteCorrected("correction", corrected.token);
	assert.equal(registry.resolveProjection("correction", contributorRoot).candidateTree, corrected.candidateTree);
	writeFileSync(join(contributorRoot, "escaped.txt"), "outside scope\n");
	assert.throws(() => registry.createCorrected("correction", contributorRoot), /escapes the frozen genesis paths/);
	registry.cleanupTerminal("correction", "approved");
});

test("projection-only correction promotion replaces the stale projection and rejects competing bindings", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewed\n");
	const source = new CandidateViewRegistry();
	const original = source.create({ contributorRoot });
	const restored = new CandidateViewRegistry();
	try {
		restored.restoreProjection("projection-only", contributorRoot, original.baseCommit, original.baseTree, original.candidateTree, original.paths);
		source.cleanup(original.token);
		writeFileSync(join(contributorRoot, "tracked.txt"), "corrected\n");
		const corrected = restored.createCorrected("projection-only", contributorRoot, "corrected-replay");
		const competing = restored.create({ contributorRoot });
		restored.bindCurrent({ token: competing.token, lineageId: "competing", selectedLenses: ["review-reliability"] });
		assert.throws(() => restored.promoteCorrected("projection-only", corrected.token), /conflicts|ambiguous/);
		restored.cleanup(competing.token);
		assert.throws(() => restored.promoteCorrected("wrong-lineage", corrected.token), /missing|ambiguous/);
		assert.throws(() => restored.createCorrected("projection-only", repository(t), "wrong-root"), /different contributor root/);
		restored.promoteCorrected("projection-only", corrected.token);
		assert.equal(restored.resolveProjection("projection-only", contributorRoot).candidateTree, corrected.candidateTree);
		restored.cleanupTerminal("projection-only", "approved");
		assert.equal(restored.resolveProjection("projection-only", contributorRoot).candidateTree, corrected.candidateTree);
	} finally {
		source.cleanup(original.token);
		restored.cleanupTerminal("projection-only", "escalated");
	}
});

test("candidate view exposes a compact 45-path changed scope for a 293-entry candidate tree", (t) => {
	const contributorRoot = repository(t);
	for (let index = 0; index < 248; index += 1) {
		writeFileSync(join(contributorRoot, `unchanged-${String(index).padStart(3, "0")}.txt`), "base\n");
	}
	git(contributorRoot, "add", ".");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "many unchanged entries");
	writeFileSync(join(contributorRoot, "tracked.txt"), "changed\n");
	for (let index = 0; index < 44; index += 1) {
		writeFileSync(join(contributorRoot, `added-${String(index).padStart(3, "0")}.txt`), "candidate\n");
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	registry.bind({ token: view.token, lineageId: "compact-scope", selectedLenses: ["review-risk"] });
	assert.equal(view.paths.length, 45);
	assert.equal(Object.keys(view.modes).length, 45);
	assert.equal(view.paths.includes("unchanged-000.txt"), false);
	const dispatch = { agent: "review-risk", task: "review", mode: "task" };
	assert.doesNotThrow(() => injectReviewCandidateView(dispatch, registry));
	assert.ok(dispatch.task.length <= 4_096);
	registry.cleanup(view.token);
});

test("candidate view derives deletion, rename, executable, and symlink scope from the frozen Git trees", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "deleted.txt"), "delete me\n");
	writeFileSync(join(contributorRoot, "script.sh"), "#!/bin/sh\necho base\n");
	git(contributorRoot, "add", ".");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "scope base");
	renameSync(join(contributorRoot, "tracked.txt"), join(contributorRoot, "renamed.txt"));
	rmSync(join(contributorRoot, "deleted.txt"));
	chmodSync(join(contributorRoot, "script.sh"), 0o755);
	try {
		symlinkSync("script.sh", join(contributorRoot, "linked.sh"));
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	try {
		assert.deepEqual(view.paths, ["deleted.txt", "linked.sh", "renamed.txt", "script.sh"]);
		assert.deepEqual(view.deletedPaths, ["deleted.txt"]);
		assert.deepEqual(view.modes, { "linked.sh": "120000", "renamed.txt": "100644", "script.sh": "100755" });
		registry.bind({ token: view.token, lineageId: "scope-kinds", selectedLenses: ["review-risk"] });
		const dispatch = { agent: "review-risk", task: "review", mode: "task" };
		injectReviewCandidateView(dispatch, registry);
		assert.match(dispatch.task, /Frozen changed scope by mode: .*"deleted":\["deleted\.txt"\]/);
		assert.doesNotMatch(dispatch.task, /Frozen paths:|Frozen modes:/);
		view.verify();
	} finally {
		registry.cleanup(view.token);
	}
});

test("candidate view verifies unchanged tree entries even when they are absent from changed scope", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "unchanged.txt"), "base\n");
	git(contributorRoot, "add", ".");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "unchanged base");
	writeFileSync(join(contributorRoot, "tracked.txt"), "changed\n");
	const view = createCandidateView({ contributorRoot });
	try {
		assert.deepEqual(view.paths, ["tracked.txt"]);
		chmodSync(view.root, 0o755);
		chmodSync(join(view.root, "unchanged.txt"), 0o644);
		writeFileSync(join(view.root, "unchanged.txt"), "tampered\n");
		chmodSync(join(view.root, "unchanged.txt"), 0o444);
		chmodSync(view.root, 0o555);
		assert.throws(() => view.verify(), CandidateViewError);
	} finally {
		view.cleanup();
	}
});

test("candidate view fails closed before dispatch when the changed scope itself exceeds 4096 bytes", (t) => {
	const contributorRoot = repository(t);
	for (let index = 0; index < 80; index += 1) {
		writeFileSync(join(contributorRoot, `changed-${String(index).padStart(3, "0")}-${"x".repeat(80)}.txt`), "candidate\n");
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	try {
		registry.bind({ token: view.token, lineageId: "oversized-scope", selectedLenses: ["review-risk"] });
		assert.throws(
			() => injectReviewCandidateView({ agent: "review-risk", task: "review", mode: "task" }, registry),
			/candidate view context exceeds the bounded dispatch contract/,
		);
	} finally {
		registry.cleanup(view.token);
	}
});

test("candidate view accepts internal relative symlink targets and rejects unsafe lexical targets", (t) => {
	const acceptedRoot = repository(t);
	const acceptedTarget = "../../.agents/skills/example";
	const acceptedLink = join(acceptedRoot, ".agent", "skills", "example");
	mkdirSync(join(acceptedRoot, ".agents", "skills", "example"), { recursive: true });
	mkdirSync(join(acceptedRoot, ".agent", "skills"), { recursive: true });
	writeFileSync(join(acceptedRoot, ".agents", "skills", "example", "SKILL.md"), "example\n");
	try {
		symlinkSync(acceptedTarget, acceptedLink);
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	const accepted = createCandidateView({ contributorRoot: acceptedRoot });
	try {
		assert.equal(lstatSync(acceptedLink).isSymbolicLink(), true);
		assert.equal(readFileSync(join(accepted.root, ".agent", "skills", "example", "SKILL.md"), "utf8"), "example\n");
		accepted.verify();
	} finally {
		accepted.cleanup();
	}

	for (const [name, target] of [
		["escape", "../escape"],
		["absolute", "/absolute-target"],
		["Windows drive absolute", "C:/absolute-target"],
		["lowercase Windows drive absolute", "c:/absolute-target"],
		["metadata", ".git"],
		["control", "unsafe\ntarget"],
		["backslash", "unsafe\\target"],
		["empty segment", "unsafe//target"],
	] as const) {
		const contributorRoot = repository(t);
		try {
			symlinkSync(target, join(contributorRoot, "candidate-link"));
		} catch {
			t.skip("platform does not support symlinks");
			return;
		}
		assert.throws(() => createCandidateView({ contributorRoot }), (error: unknown) => error instanceof CandidateViewError, name);
	}
});

test("candidate view detects symlink target-byte tampering after materialization", (t) => {
	const contributorRoot = repository(t);
	const link = join(contributorRoot, "candidate-link");
	try {
		symlinkSync("safe-target", link);
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	const view = createCandidateView({ contributorRoot });
	try {
		const frozenLink = join(view.root, "candidate-link");
		chmodSync(view.root, 0o755);
		rmSync(frozenLink);
		symlinkSync("other-target", frozenLink);
		chmodSync(view.root, 0o555);
		assert.throws(() => view.verify(), CandidateViewError);
	} finally {
		view.cleanup();
	}
});

test("candidate view retains a valid dangling symlink through bind and finalize resolution", (t) => {
	const contributorRoot = repository(t);
	try {
		symlinkSync("missing-target", join(contributorRoot, "dangling-link"));
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	try {
		registry.bind({ token: view.token, lineageId: "dangling-link", selectedLenses: ["review-reliability"] });
		const finalized = registry.resolveForFinalize("dangling-link");
		const link = join(finalized.root, "dangling-link");
		assert.equal(lstatSync(link).isSymbolicLink(), true);
		finalized.verify();
		chmodSync(finalized.root, 0o755);
		for (const target of ["other-target", "../escape"]) {
			rmSync(link);
			symlinkSync(target, link);
			assert.throws(() => finalized.verify(), CandidateViewError);
		}
		rmSync(link);
		assert.throws(() => finalized.verify(), CandidateViewError);
	} finally {
		registry.cleanup(view.token);
	}
});

test("candidate view represents an all-deletion candidate without requiring a candidate-tree entry", (t) => {
	const contributorRoot = repository(t);
	rmSync(join(contributorRoot, "tracked.txt"));
	const view = createCandidateView({ contributorRoot });
	try {
		assert.deepEqual(view.paths, ["tracked.txt"]);
		assert.deepEqual(view.deletedPaths, ["tracked.txt"]);
		assert.deepEqual(view.modes, {});
		view.verify();
	} finally {
		view.cleanup();
	}
});

test("current lineage binding selects its exact frozen tree despite overlapping historical 4R records", (t) => {
	const contributorRoot = repository(t);
	const registry = new CandidateViewRegistry();
	const lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
	const historical = [] as string[];
	for (let index = 0; index < 3; index += 1) {
		writeFileSync(join(contributorRoot, "tracked.txt"), `historical-${index}\n`);
		const view = registry.create({ contributorRoot });
		registry.bind({ token: view.token, lineageId: `historical-${index}`, selectedLenses: lenses });
		historical.push(view.token);
	}
	writeFileSync(join(contributorRoot, "tracked.txt"), "current\n");
	const current = registry.create({ contributorRoot });
	registry.bindCurrent({ token: current.token, lineageId: "current", selectedLenses: lenses });
	try {
		for (const lens of lenses) {
			assert.equal(registry.resolveCurrentForLens(lens).candidateTree, current.candidateTree);
		}
		const single = { agent: "review-risk", task: "review", mode: "task" };
		const parallel = { agents: [...lenses], task: "review", mode: "task" };
		injectReviewCandidateView(single, registry);
		injectReviewCandidateView(parallel, registry);
		assert.match(single.task, /Controller-owned review lineage: `current`/);
		assert.match(parallel.task, new RegExp(`Frozen candidate tree: \`${current.candidateTree}\``));
		assert.throws(() => registry.resolveCurrentForLens("review-unknown"), CandidateViewError);
	} finally {
		for (const token of [...historical, current.token]) registry.cleanup(token);
	}
});

test("candidate views freeze gitlinks as immutable metadata without materializing them", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	const gitlinkCommit = "0123456789abcdef0123456789abcdef01234567";
	git(contributorRoot, "update-index", "--add", "--cacheinfo", `160000,${gitlinkCommit},vendor/dependency`);
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "add gitlink");
	const view = new CandidateViewRegistry().create({ contributorRoot, baseRef: baseCommit, committedOnly: true });
	try {
		assert.deepEqual(view.paths, ["vendor/dependency"]);
		assert.deepEqual(view.modes, { "vendor/dependency": "160000" });
		assert.deepEqual(view.gitlinks, { "vendor/dependency": gitlinkCommit });
		assert.equal(lstatSync(join(view.root, "vendor", "dependency"), { throwIfNoEntry: false }), undefined);
		view.verify();
	} finally {
		view.cleanup();
	}
});

test("native projections reconstruct symlink, intended-untracked, and gitlink identity from Git objects", (t) => {
	const contributorRoot = repository(t);
	const baseTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	writeFileSync(join(contributorRoot, "new.txt"), "new\n");
	symlinkSync("new.txt", join(contributorRoot, "alias.txt"));
	git(contributorRoot, "add", "new.txt", "alias.txt");
	const gitlinkCommit = "89abcdef0123456789abcdef0123456789abcdef";
	git(contributorRoot, "update-index", "--add", "--cacheinfo", `160000,${gitlinkCommit},vendor/dependency`);
	const candidateTree = git(contributorRoot, "write-tree");
	const registry = new CandidateViewRegistry();
	registry.restoreProjectionFromNative("native-projection", contributorRoot, {
		baseTree,
		currentCandidateTree: candidateTree,
		paths: ["alias.txt", "new.txt", "vendor/dependency"],
		intendedUntracked: ["alias.txt", "new.txt"],
		projection: "workspace",
	});
	const projection = registry.resolveProjection("native-projection", contributorRoot);
	assert.deepEqual(projection.modes, { "alias.txt": "120000", "new.txt": "100644", "vendor/dependency": "160000" });
	assert.deepEqual(projection.gitlinks, { "vendor/dependency": gitlinkCommit });
});

test("native projections recover a committed range base from its frozen tree", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	const baseTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	writeFileSync(join(contributorRoot, "tracked.txt"), "committed candidate\n");
	git(contributorRoot, "add", "tracked.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "candidate");
	const candidateTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	const registry = new CandidateViewRegistry();
	registry.restoreProjectionFromNative("committed-projection", contributorRoot, {
		baseTree,
		currentCandidateTree: candidateTree,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
	});
	const projection = registry.resolveProjection("committed-projection", contributorRoot);
	assert.equal(projection.baseCommit, baseCommit);
	assert.equal(projection.committedOnly, true);
});

test("fresh registries restore only one exact authoritative reviewing candidate and reject zero or multiple matches", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewing\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const state = {
		lineageId: "reloaded-current",
		contributorRoot,
		baseCommit: frozen.baseCommit,
		baseTree: frozen.baseTree,
		candidateTree: frozen.candidateTree,
		paths: frozen.paths,
		modes: frozen.modes,
		deletedPaths: frozen.deletedPaths,
		selectedLenses: ["review-reliability"],
	};
	const restored = new CandidateViewRegistry();
	try {
		restored.restoreCurrentFromAuthoritativeReviewingStates(contributorRoot, [state]);
		const dispatch = { agent: "review-reliability", task: "review", mode: "task" };
		injectReviewCandidateView(dispatch, restored);
		assert.match(dispatch.task, /Controller-owned review lineage: `reloaded-current`/);
		assert.throws(() => restored.resolveCurrentForLens("review-risk"), (error: unknown) => error instanceof CandidateViewError && error.reason === "current-binding-lens-unselected");
		for (const candidates of [[], [state, { ...state, lineageId: "duplicate" }]]) {
			const rejected = new CandidateViewRegistry();
			let error: unknown;
			try {
				rejected.restoreCurrentFromAuthoritativeReviewingStates(contributorRoot, candidates);
			} catch (value) {
				error = value;
			}
			assert.ok(error instanceof CandidateViewError);
			assert.match(error.reason, /authoritative-current-match-(missing|ambiguous)/);
		}
	} finally {
		source.cleanup(frozen.token);
		const resolved = restored.resolveCurrentForLens("review-reliability");
		restored.cleanup(resolved.token);
	}
});

test("live candidate drift blocks dispatch before candidate text can be injected", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewed\n");
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	registry.bindCurrent({ token: view.token, lineageId: "drifted", selectedLenses: ["review-reliability"] });
	try {
		writeFileSync(join(contributorRoot, "tracked.txt"), "drifted\n");
		const input = { agent: "review-reliability", task: "review", mode: "task" };
		let error: unknown;
		try {
			injectReviewCandidateView(input, registry);
		} catch (value) {
			error = value;
		}
		assert.ok(error instanceof CandidateViewError);
		assert.equal(error.reason, "current-binding-live-candidate-drift");
		assert.equal(input.task, "review");
	} finally {
		registry.cleanup(view.token);
	}
});
