import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
	CandidateViewRegistry,
	CandidateViewError,
	type CandidateGitExecutor,
	createCandidateView,
	decodeCandidateContextManifest,
	deriveChangedPathManifest,
	digestChangedPathManifest,
	injectReviewCandidateView,
	readCandidateContextManifestPage,
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

function compactCandidateContextManifest(task: string): { encoded: string; sha256: string } {
	const match = /Frozen changed scope manifest \(gzip\+base64url\): `([A-Za-z0-9_-]+)`\.\nFrozen changed scope manifest SHA-256: `([0-9a-f]{64})`\./.exec(task);
	assert.ok(match, "expected a compact candidate context manifest");
	return { encoded: match[1]!, sha256: match[2]! };
}

test("candidate view Git commands classify bounded timeouts and block materialization before worktree execution", (t) => {
	const calls: Array<{ arguments: readonly string[]; timeout: number | undefined; maxBuffer: number | undefined }> = [];
	const executor: CandidateGitExecutor = (_file, arguments_, options) => { calls.push({ arguments: arguments_, timeout: options.timeout, maxBuffer: options.maxBuffer }); throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true }); };
	let failure: unknown;
	try {
		new CandidateViewRegistry(executor).create({ contributorRoot: repository(t) });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError);
	assert.equal(failure.reason, "candidate-view-timeout");
	assert.deepEqual((failure as CandidateViewError & { diagnostics?: unknown }).diagnostics, {
		phase: "candidate-view",
		category: "timeout",
		git_subcommand: "rev-parse",
		timeout_ms: 10_000,
		max_buffer_bytes: 64 * 1024 * 1024,
		message: "candidate-view Git command rev-parse timed out after 10000ms; inspect the candidate state before any new START",
	});
	assert.deepEqual(calls, [{ arguments: ["rev-parse", "--git-common-dir"], timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }]);
	assert.equal(calls.some((call) => call.arguments[0] === "worktree"), false);
});

test("candidate-view Git timeouts use a bounded strict-decimal override with safe fallback", (t) => {
	const withTimeout = <T>(value: string | undefined, callback: () => T): T => {
		const previous = process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS;
		try {
			if (value === undefined) delete process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS;
			else process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS = value;
			return callback();
		} finally {
			if (previous === undefined) delete process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS;
			else process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS = previous;
		}
	};
	for (const [name, value, expected] of [
		["default", undefined, 10_000],
		["valid override", "45000", 45_000],
		...(["", "0", "0010", "-1", "1.5", "not-a-number", "120001", "Infinity"] as const).map((value) => [`invalid override ${JSON.stringify(value)}`, value, 10_000] as const),
	] as const) {
		const timeouts: Array<number | undefined> = [];
		let failure: unknown;
		withTimeout(value, () => {
			try {
				new CandidateViewRegistry((_file, _arguments, options) => {
					timeouts.push(options.timeout);
					throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
				}).create({ contributorRoot: repository(t) });
			} catch (error) {
				failure = error;
			}
		});
		assert.ok(failure instanceof CandidateViewError, name);
		assert.equal(timeouts[0], expected, name);
		assert.equal((failure as CandidateViewError & { diagnostics?: { timeout_ms?: unknown } }).diagnostics?.timeout_ms, expected, name);
	}
});

test("explicit base resolution preserves structured for-each-ref output-limit diagnostics", (t) => {
	const contributorRoot = repository(t);
	const executor: CandidateGitExecutor = (file, arguments_, options) => {
		if (arguments_[0] === "for-each-ref") throw Object.assign(new Error("sensitive base-reference output"), { code: "ENOBUFS", killed: true, stderr: Buffer.from("sensitive base-reference output") });
		return execFileSync(file, arguments_, options);
	};
	let failure: unknown;
	try {
		new CandidateViewRegistry(executor).create({ contributorRoot, baseRef: "refs/heads/main", committedOnly: true });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError);
	assert.equal(failure.reason, "candidate-view-output-limit");
	assert.deepEqual(failure.diagnostics, {
		phase: "candidate-view",
		category: "output-limit",
		git_subcommand: "for-each-ref",
		timeout_ms: 10_000,
		max_buffer_bytes: 64 * 1024 * 1024,
		message: "candidate-view Git command for-each-ref exceeded the 67108864-byte output limit; inspect the candidate state before any new START",
	});
	assert.doesNotMatch(failure.message, /sensitive base-reference output/);
});

test("every synchronous candidate-view Git command receives the explicit 64 MiB output limit", (t) => {
	const calls: Array<{ arguments: readonly string[]; maxBuffer: number | undefined }> = [];
	const executor: CandidateGitExecutor = (file, arguments_, options) => {
		calls.push({ arguments: arguments_, maxBuffer: options.maxBuffer });
		return execFileSync(file, arguments_, options);
	};
	const view = new CandidateViewRegistry(executor).create({ contributorRoot: repository(t) });
	try {
		assert.ok(calls.length > 1);
		assert.ok(calls.every((call) => call.maxBuffer === 64 * 1024 * 1024), JSON.stringify(calls));
	} finally {
		view.cleanup();
	}
});

test("candidate view classifies both Node synchronous-process output-limit errors ahead of killed state without exposing process output", (t) => {
	const attemptedOutputBytes = 64 * 1024 * 1024 + 1;
	for (const code of ["ENOBUFS", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"]) {
		let failure: unknown;
		try {
			new CandidateViewRegistry((_file, _arguments, options) => {
				assert.ok((options.maxBuffer ?? 0) < attemptedOutputBytes, code);
				throw Object.assign(new Error("sensitive stderr and candidate bytes"), { code, killed: true, stderr: Buffer.from("sensitive stderr and candidate bytes") });
			}).create({ contributorRoot: repository(t) });
		} catch (error) {
			failure = error;
		}
		assert.ok(failure instanceof CandidateViewError, code);
		assert.equal(failure.reason, "candidate-view-output-limit", code);
		assert.deepEqual((failure as CandidateViewError & { diagnostics?: unknown }).diagnostics, {
			phase: "candidate-view",
			category: "output-limit",
			git_subcommand: "rev-parse",
			timeout_ms: 10_000,
			max_buffer_bytes: 64 * 1024 * 1024,
			message: "candidate-view Git command rev-parse exceeded the 67108864-byte output limit; inspect the candidate state before any new START",
		}, code);
		assert.doesNotMatch(failure.message, /sensitive stderr|candidate bytes/, code);
	}
});

test("candidate Git accepts deterministic output above 1 MiB up to its explicit bound", () => {
	const row = `:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} M\0tracked.txt\0`;
	const copies = Math.ceil((1024 * 1024 + 1) / Buffer.byteLength(row));
	const output = Buffer.from(row.repeat(copies));
	assert.ok(output.length > 1024 * 1024);
	assert.ok(output.length < 64 * 1024 * 1024);
	const calls: Array<{ maxBuffer: number | undefined }> = [];
	const manifest = deriveChangedPathManifest("/candidate", "a".repeat(40), "b".repeat(40), (_file, arguments_, options) => {
		assert.deepEqual(arguments_.slice(0, 2), ["diff", "--raw"]);
		calls.push({ maxBuffer: options.maxBuffer });
		return output;
	});
	assert.equal(manifest.length, copies);
	assert.ok(manifest.every((entry) => entry.path === "tracked.txt" && entry.status === "M"));
	assert.deepEqual(calls, [{ maxBuffer: 64 * 1024 * 1024 }]);
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

// An unborn repository has a symbolic HEAD pointing at a branch with no
// commits yet; its review base is Git's repository-native empty tree, not a
// missing or malformed commit. `mktree` with empty input derives that empty
// tree object-format-aware (sha1 or sha256) without hardcoding the SHA-1 id.
function emptyTreeOf(cwd: string): string {
	return execFileSync("git", ["-C", cwd, "mktree"], { encoding: "utf8", input: "" }).trim();
}

function unbornRepository(t: test.TestContext, stage = true): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-candidate-view-unborn-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.name", "Candidate Test");
	git(cwd, "config", "user.email", "candidate@example.invalid");
	if (stage) {
		writeFileSync(join(cwd, "staged.txt"), "first staged\n");
		git(cwd, "add", "staged.txt");
	}
	return cwd;
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

test("candidate view preserves staged additions with explicit intended-untracked selection in its private index", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "tracked selection\n");
	writeFileSync(join(contributorRoot, "staged-addition.txt"), "staged addition\n");
	git(contributorRoot, "add", "staged-addition.txt");
	git(contributorRoot, "update-index", "--split-index");
	writeFileSync(join(contributorRoot, "selected.txt"), "selected\n");
	writeFileSync(join(contributorRoot, "excluded.txt"), "excluded\n");
	const indexBefore = readFileSync(join(contributorRoot, ".git", "index"));
	const all = createCandidateView({ contributorRoot });
	const excluded = createCandidateView({ contributorRoot, intendedUntracked: [] });
	const selected = createCandidateView({ contributorRoot, intendedUntracked: ["selected.txt"] });
	try {
		assert.deepEqual(all.paths, ["excluded.txt", "selected.txt", "staged-addition.txt", "tracked.txt"]);
		assert.deepEqual(excluded.paths, ["staged-addition.txt", "tracked.txt"]);
		assert.deepEqual(selected.paths, ["selected.txt", "staged-addition.txt", "tracked.txt"]);
		assert.equal(readFileSync(join(selected.root, "staged-addition.txt"), "utf8"), "staged addition\n");
		assert.equal(lstatSync(join(selected.root, "excluded.txt"), { throwIfNoEntry: false }), undefined);
		assert.deepEqual(readFileSync(join(contributorRoot, ".git", "index")), indexBefore);
	} finally {
		all.cleanup();
		excluded.cleanup();
		selected.cleanup();
	}
});

test("candidate view skips a shared index that disappears during stat or copy", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "tracked selection\n");
	writeFileSync(join(contributorRoot, "staged-addition.txt"), "staged addition\n");
	git(contributorRoot, "add", "staged-addition.txt");
	git(contributorRoot, "update-index", "--split-index");
	const sharedIndexName = readdirSync(join(contributorRoot, ".git")).find((name) => /^sharedindex\.[0-9a-f]+$/.test(name));
	assert.ok(sharedIndexName, "split index must create a shared index fixture");
	const sharedIndexPath = join(contributorRoot, ".git", sharedIndexName);
	for (const phase of ["stat", "copy"] as const) {
		const originalLstatSync = fs.lstatSync;
		const originalCopyFileSync = fs.copyFileSync;
		fs.lstatSync = ((path: string | Buffer, options?: Parameters<typeof lstatSync>[1]) => {
			if (phase === "stat" && path === sharedIndexPath) throw Object.assign(new Error("shared index disappeared"), { code: "ENOENT" });
			return originalLstatSync(path, options);
		}) as typeof fs.lstatSync;
		fs.copyFileSync = ((source: string | Buffer, destination: string | Buffer) => {
			if (phase === "copy" && source === sharedIndexPath) throw Object.assign(new Error("shared index disappeared"), { code: "ENOENT" });
			return originalCopyFileSync(source, destination);
		}) as typeof fs.copyFileSync;
		syncBuiltinESMExports();
		let view: ReturnType<typeof createCandidateView> | undefined;
		try {
			view = createCandidateView({ contributorRoot, intendedUntracked: [] });
			assert.equal(view.paths.includes("staged-addition.txt"), true, phase);
		} finally {
			fs.lstatSync = originalLstatSync;
			fs.copyFileSync = originalCopyFileSync;
			syncBuiltinESMExports();
			view?.cleanup();
		}
	}
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

test("candidate registry isolates replay, projection, current, and cleanup state by target root plus lineage", (t) => {
	const rootA = repository(t);
	const rootB = repository(t);
	writeFileSync(join(rootA, "tracked.txt"), "candidate A\n");
	writeFileSync(join(rootB, "tracked.txt"), "candidate B\n");
	const registry = new CandidateViewRegistry();
	t.after(() => registry.cleanupAll());
	const viewA = registry.createOrReuse({ contributorRoot: rootA, replayKey: "same-replay" });
	const viewB = registry.createOrReuse({ contributorRoot: rootB, replayKey: "same-replay" });
	assert.notEqual(viewA.token, viewB.token);
	registry.bindCurrent({ token: viewA.token, lineageId: "same-lineage", selectedLenses: ["review-reliability"] });
	registry.bindCurrent({ token: viewB.token, lineageId: "same-lineage", selectedLenses: ["review-reliability"] });
	assert.equal(registry.resolveForLens("same-lineage", "review-reliability", rootA).root, viewA.root);
	assert.equal(registry.resolveForLens("same-lineage", "review-reliability", rootB).root, viewB.root);
	assert.equal(registry.resolveForFinalize("same-lineage", rootA).root, viewA.root);
	assert.equal(registry.resolveForFinalize("same-lineage", rootB).root, viewB.root);
	writeFileSync(join(rootA, "tracked.txt"), "corrected A\n");
	writeFileSync(join(rootB, "tracked.txt"), "corrected B\n");
	const correctedA = registry.createCorrected("same-lineage", rootA, "same-correction-replay");
	const correctedB = registry.createCorrected("same-lineage", rootB, "same-correction-replay");
	assert.notEqual(correctedA.token, correctedB.token);
	registry.promoteCorrected("same-lineage", correctedA.token, rootA);
	registry.promoteCorrected("same-lineage", correctedB.token, rootB);
	assert.equal(registry.resolveForFinalize("same-lineage", rootA).root, correctedA.root);
	assert.equal(registry.resolveForFinalize("same-lineage", rootB).root, correctedB.root);
	assert.throws(() => registry.resolveForLens("same-lineage", "review-reliability"), /workspaceRoot/);
	assert.throws(() => registry.resolveWorkspaceRoot("same-lineage"), /workspaceRoot/);
	registry.cleanupTerminal("same-lineage", "approved", rootB);
	assert.equal(registry.resolveWorkspaceRoot("same-lineage"), realpathSync(rootA));
	assert.equal(registry.resolveForFinalize("same-lineage", rootA).root, correctedA.root);
	registry.cleanupTerminal("same-lineage", "approved", rootA);
});

test("candidate registry rejects a lineage target whose authorized symlink was replaced", (t) => {
	const root = repository(t);
	const replacement = repository(t);
	const alias = join(tmpdir(), `gentle-pi-candidate-alias-${process.pid}-${Date.now()}`);
	t.after(() => rmSync(alias, { recursive: true, force: true }));
	symlinkSync(root, alias, "dir");
	const registry = new CandidateViewRegistry();
	t.after(() => registry.cleanupAll());
	const view = registry.create({ contributorRoot: root });
	registry.bindCurrent({ token: view.token, lineageId: "symlink-lineage", selectedLenses: ["review-reliability"] });
	assert.doesNotThrow(() => registry.assertWorkspaceRoot("symlink-lineage", alias));
	rmSync(alias, { recursive: true, force: true });
	symlinkSync(replacement, alias, "dir");
	assert.throws(() => registry.assertWorkspaceRoot("symlink-lineage", alias), /workspaceRoot|bound to/);
	registry.cleanupTerminal("symlink-lineage", "approved", root);
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

test("candidate cleanup removes a readonly root when Git reports success without deleting it", (t) => {
	const registry = new CandidateViewRegistry((file, arguments_, options) =>
		arguments_[0] === "worktree" && arguments_[1] === "remove" ? "" : execFileSync(file, arguments_, options));
	const view = registry.create({ contributorRoot: repository(t) });
	assert.equal(lstatSync(view.root).mode & 0o222, 0);
	view.cleanup();
	view.cleanup();
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

test("candidate view compacts an oversized non-ASCII scope losslessly and deterministically", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "deleted.txt"), "delete me\n");
	git(contributorRoot, "add", "deleted.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "deletion base");
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	const unicodePaths = Array.from({ length: 18 }, (_, index) => `changed-${String(index).padStart(2, "0")}-${"界".repeat(70)}.txt`);
	for (const path of unicodePaths) writeFileSync(join(contributorRoot, path), "candidate\n");
	const gitlinkCommit = "0123456789abcdef0123456789abcdef01234567";
	git(contributorRoot, "add", ...unicodePaths);
	git(contributorRoot, "update-index", "--add", "--cacheinfo", `160000,${gitlinkCommit},vendor/dependency`);
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "large scope");
	rmSync(join(contributorRoot, "deleted.txt"));
	git(contributorRoot, "add", "-u", "--", "deleted.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "delete scope path");
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot, baseRef: baseCommit, committedOnly: true });
	try {
		registry.bind({ token: view.token, lineageId: "oversized-scope", selectedLenses: ["review-risk"] });
		const first = { agent: "review-risk", task: "review", mode: "task" };
		const second = { agent: "review-risk", task: "review", mode: "task" };
		injectReviewCandidateView(first, registry);
		injectReviewCandidateView(second, registry);
		const compact = compactCandidateContextManifest(first.task);
		assert.deepEqual(compact, compactCandidateContextManifest(second.task));
		const decoded = decodeCandidateContextManifest(compact.encoded, compact.sha256);
		assert.deepEqual(decoded.manifest, {
			version: 1,
			scopeByMode: { "100644": unicodePaths, "160000": ["vendor/dependency"], deleted: ["deleted.txt"] },
			gitlinks: { "vendor/dependency": gitlinkCommit },
		});
		assert.equal(decoded.sha256, createHash("sha256").update(decoded.bytes).digest("hex"));
		assert.ok(JSON.stringify(decoded.manifest).length < 4_096, "UTF-16 code units alone must not decide the dispatch bound");
		assert.ok(decoded.bytes.length > 4_096, "the manifest must retain its full non-ASCII UTF-8 byte sequence");
		const actorEntries: Array<{ path: string; mode: string; gitlinkObjectId?: string }> = [];
		let cursor: number | undefined = 0;
		while (cursor !== undefined) {
			const page = readCandidateContextManifestPage(compact.encoded, compact.sha256, cursor);
			actorEntries.push(...page.entries);
			assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 16 * 1024);
			cursor = page.nextCursor;
		}
		assert.deepEqual(actorEntries, [
			...unicodePaths.map((path) => ({ path, mode: "100644" })),
			{ path: "vendor/dependency", mode: "160000", gitlinkObjectId: gitlinkCommit },
			{ path: "deleted.txt", mode: "deleted" },
		]);
		assert.ok(Buffer.byteLength(first.task, "utf8") <= Buffer.byteLength("review", "utf8") + 4_096);
		assert.doesNotMatch(first.task, /Frozen changed scope by mode:/);
		assert.match(first.task, /Call `gentle_review_scope`/);
		assert.throws(() => decodeCandidateContextManifest(compact.encoded, `${compact.sha256.slice(0, -1)}0`), /integrity/);
		assert.throws(() => readCandidateContextManifestPage(compact.encoded, compact.sha256, actorEntries.length + 1), /cursor/);
		const nonCanonicalBytes = Buffer.from(JSON.stringify({ gitlinks: decoded.manifest.gitlinks, scopeByMode: decoded.manifest.scopeByMode, version: 1 }), "utf8");
		assert.throws(
			() => decodeCandidateContextManifest(gzipSync(nonCanonicalBytes, { mtime: 0 }).toString("base64url"), createHash("sha256").update(nonCanonicalBytes).digest("hex")),
			/canonical/,
		);
	} finally {
		registry.cleanup(view.token);
	}
});

test("candidate context manifest decoder accepts canonical numeric-looking gitlink paths", () => {
	const gitlinks = {
		"10": "0123456789abcdef0123456789abcdef01234567",
		"2": "89abcdef0123456789abcdef0123456789abcdef",
	};
	const bytes = Buffer.from(JSON.stringify({
		version: 1,
		scopeByMode: { "160000": ["10", "2"] },
		gitlinks,
	}), "utf8");
	const encoded = gzipSync(bytes, { mtime: 0 }).toString("base64url");
	assert.deepEqual(decodeCandidateContextManifest(encoded, createHash("sha256").update(bytes).digest("hex")).manifest, {
		version: 1,
		scopeByMode: { "160000": ["10", "2"] },
		gitlinks,
	});
});

test("candidate context manifest decoder rejects noncanonical nonnumeric gitlink ordering", () => {
	const gitlinks = {
		zeta: "0123456789abcdef0123456789abcdef01234567",
		alpha: "89abcdef0123456789abcdef0123456789abcdef",
	};
	const bytes = Buffer.from(JSON.stringify({
		version: 1,
		scopeByMode: { "160000": ["alpha", "zeta"] },
		gitlinks,
	}), "utf8");
	assert.throws(
		() => decodeCandidateContextManifest(gzipSync(bytes, { mtime: 0 }).toString("base64url"), createHash("sha256").update(bytes).digest("hex")),
		/canonical/,
	);
});

test("candidate context manifest decoder rejects noncanonical gzip transport for verified bytes", () => {
	const bytes = Buffer.from(JSON.stringify({ version: 1, scopeByMode: { "100644": ["file.ts"] }, gitlinks: {} }), "utf8");
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const canonical = gzipSync(bytes, { mtime: 0 });
	const noncanonical = Buffer.from(canonical);
	noncanonical[4] = (noncanonical[4]! + 1) & 0xff;
	assert.throws(() => decodeCandidateContextManifest(noncanonical.toString("base64url"), sha256), /canonical/);
});

test("candidate view fails closed when an incompressible compact scope exceeds 4096 UTF-8 bytes", (t) => {
	const contributorRoot = repository(t);
	for (let index = 0; index < 80; index += 1) {
		const entropy = createHash("sha512").update(`candidate-scope-${index}`).digest("hex");
		writeFileSync(join(contributorRoot, `changed-${String(index).padStart(3, "0")}-${entropy}.txt`), "candidate\n");
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	try {
		registry.bind({ token: view.token, lineageId: "incompressible-scope", selectedLenses: ["review-risk"] });
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

test("native projection reconstruction retains its selected untracked subset", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "tracked selection\n");
	writeFileSync(join(contributorRoot, "selected.txt"), "selected\n");
	writeFileSync(join(contributorRoot, "excluded.txt"), "excluded\n");
	const source = new CandidateViewRegistry();
	const selected = source.create({ contributorRoot, intendedUntracked: ["selected.txt"] });
	const restored = new CandidateViewRegistry();
	try {
		const view = restored.restoreForFinalizeFromNative("selected-native", contributorRoot, {
			baseTree: selected.baseTree,
			currentCandidateTree: selected.candidateTree,
			paths: selected.paths,
			intendedUntracked: ["selected.txt"],
			projection: "workspace",
		});
		assert.deepEqual(view.paths, ["selected.txt", "tracked.txt"]);
		assert.equal(lstatSync(join(view.root, "excluded.txt"), { throwIfNoEntry: false }), undefined);
		view.cleanup();
	} finally {
		selected.cleanup();
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

test("native staged projections restore the exact current index over HEAD", (t) => {
	const contributorRoot = repository(t);
	const baseTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	writeFileSync(join(contributorRoot, "tracked.txt"), "staged candidate\n");
	git(contributorRoot, "add", "tracked.txt");
	const candidateTree = git(contributorRoot, "write-tree");
	const registry = new CandidateViewRegistry();

	registry.restoreProjectionFromNative("staged-index-projection", contributorRoot, {
		baseTree,
		currentCandidateTree: candidateTree,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "staged",
	});

	const projection = registry.resolveProjection("staged-index-projection", contributorRoot);
	assert.equal(projection.baseTree, baseTree);
	assert.equal(projection.candidateTree, candidateTree);
	assert.equal(projection.committedOnly, false);
});

test("native staged projections reject a workspace snapshot that differs from the current index", (t) => {
	const contributorRoot = repository(t);
	const baseTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	writeFileSync(join(contributorRoot, "tracked.txt"), "workspace candidate\n");
	const workspace = new CandidateViewRegistry().create({ contributorRoot });
	try {
		assert.throws(
			() => new CandidateViewRegistry().restoreProjectionFromNative("workspace-as-staged", contributorRoot, {
				baseTree,
				currentCandidateTree: workspace.candidateTree,
				paths: ["tracked.txt"],
				intendedUntracked: [],
				projection: "staged",
			}),
			(error: unknown) => error instanceof CandidateViewError && error.reason === "projection-kind-drift",
		);
	} finally {
		workspace.cleanup();
	}
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
		// A committed range: HEAD moved past base with no dirty overlay.
		projection: "staged",
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

interface CandidateViewRegistryInternals {
	records: Map<string, unknown>;
	bindRecord: (token: string, lineageId: string, selectedLenses: readonly unknown[]) => unknown;
}

function bindingFailureRegistry(t: test.TestContext): { registry: CandidateViewRegistry; materializedRoot: () => string | undefined; internals: CandidateViewRegistryInternals } {
	let root: string | undefined;
	const registry = new CandidateViewRegistry((file, arguments_, options) => {
		if (arguments_[0] === "worktree" && arguments_[1] === "add") root = arguments_[arguments_.indexOf("--no-checkout") + 1];
		return execFileSync(file, arguments_, options);
	});
	t.after(() => registry.cleanupAll());
	return { registry, materializedRoot: () => root, internals: registry as unknown as CandidateViewRegistryInternals };
}

test("failed authoritative restores remove the inserted registry record and readonly worktree", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewing\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const state = {
		lineageId: "restore-bind-failure",
		contributorRoot,
		baseCommit: frozen.baseCommit,
		baseTree: frozen.baseTree,
		candidateTree: frozen.candidateTree,
		paths: frozen.paths,
		modes: frozen.modes,
		deletedPaths: frozen.deletedPaths,
		selectedLenses: ["review-reliability"],
	};
	const { registry, materializedRoot, internals } = bindingFailureRegistry(t);
	const originalBindRecord = internals.bindRecord;
	internals.bindRecord = (token) => {
		assert.equal(internals.records.has(token), true, "the failure must occur after insertion");
		throw new CandidateViewError("test-only bind failure");
	};
	try {
		assert.throws(
			() => registry.restoreCurrentFromAuthoritativeReviewingStates(contributorRoot, [state]),
			CandidateViewError,
		);
	} finally {
		internals.bindRecord = originalBindRecord;
		source.cleanup(frozen.token);
	}
	assert.equal(internals.records.size, 0);
	assert.ok(materializedRoot(), "the restore must have created a candidate worktree");
	assert.equal(existsSync(materializedRoot()!), false);
});

test("failed finalize restores remove the inserted registry record and readonly worktree", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const { registry, materializedRoot, internals } = bindingFailureRegistry(t);
	const originalBindRecord = internals.bindRecord;
	internals.bindRecord = (token) => {
		assert.equal(internals.records.has(token), true, "the failure must occur after insertion");
		throw new CandidateViewError("test-only bind failure");
	};
	try {
		assert.throws(
			() => registry.restoreForFinalizeFromNative("finalize-bind-failure", contributorRoot, {
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
				intendedUntracked: [],
				projection: "workspace",
			}),
			CandidateViewError,
		);
	} finally {
		internals.bindRecord = originalBindRecord;
		source.cleanup(frozen.token);
	}
	assert.equal(internals.records.size, 0);
	assert.ok(materializedRoot(), "the restore must have created a candidate worktree");
	assert.equal(existsSync(materializedRoot()!), false);
});

function materializationFailureRegistry(t: test.TestContext, failureAt: number): { registry: CandidateViewRegistry; roots: () => readonly string[]; removalAttempts: (root: string) => number; internals: CandidateViewRegistryInternals } {
	const roots: string[] = [];
	const removalAttempts = new Map<string, number>();
	let materializations = 0;
	let failPending = true;
	const registry = new CandidateViewRegistry((file, arguments_, options) => {
		if (arguments_[0] === "worktree" && arguments_[1] === "add") {
			const root = arguments_[arguments_.indexOf("--no-checkout") + 1];
			assert.equal(typeof root, "string", "worktree add must name its candidate root");
			roots.push(root);
			materializations += 1;
		}
		if (arguments_[0] === "worktree" && arguments_[1] === "remove") {
			const root = arguments_[arguments_.indexOf("--force") + 1];
			assert.equal(typeof root, "string", "worktree remove must name its candidate root");
			removalAttempts.set(root, (removalAttempts.get(root) ?? 0) + 1);
		}
		if (failPending && materializations === failureAt && options.cwd === roots.at(-1) && arguments_[0] === "read-tree") {
			failPending = false;
			throw Object.assign(new Error("test-only materialization failure"), { status: 1 });
		}
		return execFileSync(file, arguments_, options);
	});
	t.after(() => registry.cleanupAll());
	return { registry, roots: () => roots, removalAttempts: (root) => removalAttempts.get(root) ?? 0, internals: registry as unknown as CandidateViewRegistryInternals };
}

test("finalize restore removes a registered projection when its first materialization fails and retries cleanly", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const lineageId = "finalize-materialization-failure";
	const descriptor = {
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
		intendedUntracked: [],
		projection: "workspace" as const,
	};
	const baselineWorktrees = git(contributorRoot, "worktree", "list", "--porcelain");
	const { registry, roots, internals } = materializationFailureRegistry(t, 1);
	try {
		assert.throws(() => registry.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor), CandidateViewError);
		assert.equal(registry.hasProjection(lineageId, contributorRoot), false);
		assert.equal(internals.records.size, 0);
		assert.equal(git(contributorRoot, "worktree", "list", "--porcelain"), baselineWorktrees);
		assert.equal(existsSync(roots()[0]!), false);

		const restored = registry.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor);
		assert.equal(registry.resolveForFinalize(lineageId, contributorRoot).token, restored.token);
		registry.cleanup(restored.token);
	} finally {
		source.cleanup(frozen.token);
	}
});

test("finalize restore does not re-remove its first fallback record when the empty-untracked retry materialization fails", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	writeFileSync(join(contributorRoot, "excluded.txt"), "excluded\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot, intendedUntracked: [] });
	const lineageId = "finalize-fallback-materialization-failure";
	const descriptor = {
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
		intendedUntracked: [],
		projection: "workspace" as const,
	};
	const baselineWorktrees = git(contributorRoot, "worktree", "list", "--porcelain");
	const { registry, roots, removalAttempts, internals } = materializationFailureRegistry(t, 2);
	try {
		assert.throws(() => registry.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor), CandidateViewError);
		assert.equal(removalAttempts(roots()[0]!), 1, "the first mismatched record must receive exactly one physical worktree removal");
		assert.equal(registry.hasProjection(lineageId, contributorRoot), false);
		assert.equal(internals.records.size, 0);
		assert.equal(git(contributorRoot, "worktree", "list", "--porcelain"), baselineWorktrees);
		assert.equal(existsSync(roots()[0]!), false);
		assert.equal(existsSync(roots()[1]!), false);

		const restored = registry.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor);
		assert.equal(registry.resolveForFinalize(lineageId, contributorRoot).token, restored.token);
		registry.cleanup(restored.token);
	} finally {
		source.cleanup(frozen.token);
	}
});

test("dispatch restore removes a registered projection when materialization fails and records the hydration failure before retrying", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const lineageId = "dispatch-materialization-failure";
	const descriptor = {
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
		intendedUntracked: [],
		projection: "workspace" as const,
	};
	const baselineWorktrees = git(contributorRoot, "worktree", "list", "--porcelain");
	const { registry, roots, internals } = materializationFailureRegistry(t, 1);
	try {
		let failure: unknown;
		try {
			registry.restoreCurrentForDispatchFromNative(lineageId, contributorRoot, descriptor, ["review-reliability"]);
		} catch (error) {
			failure = error;
		}
		assert.ok(failure instanceof CandidateViewError);
		assert.equal(registry.hasProjection(lineageId, contributorRoot), false);
		assert.equal(registry.hasCurrentBinding(contributorRoot), false);
		assert.equal(internals.records.size, 0);
		assert.equal(git(contributorRoot, "worktree", "list", "--porcelain"), baselineWorktrees);
		assert.equal(existsSync(roots()[0]!), false);
		assert.deepEqual(registry.lastDispatchHydrationFailure(contributorRoot), {
			lineageId,
			reason: failure.reason,
			message: failure.message,
		});

		registry.restoreCurrentForDispatchFromNative(lineageId, contributorRoot, descriptor, ["review-reliability"]);
		const restored = registry.resolveCurrentForLens("review-reliability", contributorRoot);
		assert.equal(registry.lastDispatchHydrationFailure(contributorRoot), undefined);
		registry.cleanup(restored.token);
	} finally {
		source.cleanup(frozen.token);
	}
});

test("candidate root resolution drift is exposed as a typed candidate-view error", () => {
	const missingRoot = join(tmpdir(), `gentle-pi-missing-root-${process.pid}-${Date.now()}`);
	assert.throws(
		() => new CandidateViewRegistry().hasCurrentBinding(missingRoot),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "contributor-root-unresolvable",
	);
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

// --- Phase 3: field-wise changed-path manifest binding -----------------------
//
// The sorted-path-set check these tests replace could not see a mode-only or a
// type change: a file turning executable between START and dispatch produced an
// identical path set, so the candidate Pi materialized could diverge from the
// provider's frozen one and the comparison still passed. `--name-status` never
// carried old_mode, which is why the manifest needs its own derivation.

function treeOf(cwd: string): string {
	git(cwd, "add", "-A");
	return git(cwd, "write-tree");
}

function baseTreeOf(cwd: string): string {
	return git(cwd, "rev-parse", "HEAD^{tree}");
}

test("deriveChangedPathManifest reports old and new mode, and flags a mode-only change", (t) => {
	const cwd = repository(t);
	chmodSync(join(cwd, "tracked.txt"), 0o755);
	const candidate = treeOf(cwd);

	const manifest = deriveChangedPathManifest(cwd, baseTreeOf(cwd), candidate);

	assert.deepEqual(manifest, [{
		path: "tracked.txt",
		status: "M",
		oldMode: "100644",
		newMode: "100755",
		deleted: false,
		typeChanged: false,
		modeOnly: true,
	}]);
});

test("deriveChangedPathManifest distinguishes content change from mode-only", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const manifest = deriveChangedPathManifest(cwd, baseTreeOf(cwd), treeOf(cwd));

	assert.equal(manifest.length, 1);
	assert.equal(manifest[0]?.modeOnly, false);
	assert.equal(manifest[0]?.oldMode, "100644");
	assert.equal(manifest[0]?.newMode, "100644");
});

test("deriveChangedPathManifest marks an added path and a deleted path", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "added.txt"), "new\n");
	rmSync(join(cwd, "tracked.txt"));
	const manifest = deriveChangedPathManifest(cwd, baseTreeOf(cwd), treeOf(cwd));

	const byPath = new Map(manifest.map((entry) => [entry.path, entry]));
	assert.equal(byPath.get("added.txt")?.status, "A");
	assert.equal(byPath.get("added.txt")?.deleted, false);
	assert.equal(byPath.get("tracked.txt")?.status, "D");
	assert.equal(byPath.get("tracked.txt")?.deleted, true);
});

test("a mode-only divergence is rejected even though the sorted path set matches", (t) => {
	const cwd = repository(t);
	chmodSync(join(cwd, "tracked.txt"), 0o755);
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	// The provider froze the path as non-executable; Git now reports 100755.
	// The old check compared only sorted paths and would accept this.
	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-mode-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest: [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-mode-drift",
	);
});

test("a manifest whose path set differs from Git content is rejected as path-set drift", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-path-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt", "ghost.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest: [
				{ path: "ghost.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false },
				{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false },
			],
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-path-set-drift",
	);
});

test("a manifest whose status disagrees with Git is rejected as status drift", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-status-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest: [{ path: "tracked.txt", status: "A", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-status-drift",
	);
});

test("intended-untracked outside the manifest path set is rejected as a subset violation", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	// intended_untracked is provider-only knowledge no Git command reproduces,
	// so it is checked structurally as a subset rather than compared field-wise.
	// That is a deliberate, documented deviation from the spec's field list.
	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-untracked-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: ["not-in-manifest.txt"],
			projection: "workspace",
			manifest: [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
		}),
		(error: unknown) => error instanceof CandidateViewError,
	);
});

test("a manifest that disagrees with the descriptor's own paths is rejected as input divergence", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-input-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest: [{ path: "other.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
	);
});

test("a manifest matching Git field-wise restores the projection", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	assert.doesNotThrow(() => new CandidateViewRegistry().restoreProjectionFromNative("review-manifest-ok", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
		manifest: [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
	}));
});

test("a descriptor without a manifest keeps the legacy path-set behavior", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	// Phase 3 is additive: the manifest is optional, and its absence must not
	// change how existing callers behave.
	assert.doesNotThrow(() => new CandidateViewRegistry().restoreProjectionFromNative("review-no-manifest", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
	}));
});

// --- 3.1 completion: manifest-subject-drift ---------------------------------
//
// The v2 artifact-subject schema (contracts/review-integration/v2/schemas/
// artifact-subject.schema.json) requires `changed_path_manifest_sha256` on
// every subject. That is the provider's own claim about what the manifest it
// handed the dispatch digests to. A manifest that does not digest to that
// claim is a self-consistency failure Pi can catch without touching Git at
// all: the descriptor disagrees with itself before any content comparison.

test("a manifest whose digest disagrees with the subject's claim is rejected as subject drift", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);
	const manifest = [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }];

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-subject-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest,
			// A subject claim that cannot possibly match any real digest.
			manifestSha256: `sha256:${"0".repeat(64)}`,
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-subject-drift",
	);
});

test("a manifest digest matching the subject's claim restores the projection", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);
	const manifest = [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }];

	assert.doesNotThrow(() => new CandidateViewRegistry().restoreProjectionFromNative("review-subject-ok", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
		manifest,
		manifestSha256: digestChangedPathManifest(manifest),
	}));
});

test("a descriptor without a subject digest keeps validating the manifest without a subject-drift check", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);
	const manifest = [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }];

	// `manifestSha256` is additive, mirroring `manifest` itself: its absence
	// must not change existing manifest-bound behavior.
	assert.doesNotThrow(() => new CandidateViewRegistry().restoreProjectionFromNative("review-no-subject-digest", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
		manifest,
	}));
});

// --- 3.4 threat matrix: Git repository selection ----------------------------
//
// A manifest binding must never widen the existing root-scoping guarantee:
// a projection frozen against one contributor root stays rejected when
// resolved against a different one, exactly as it was before manifests
// existed.

test("a manifest-bound projection is rejected when resolved against a different contributor root", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);
	const manifest = [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }];
	const registry = new CandidateViewRegistry();
	registry.restoreProjectionFromNative("review-root-scope", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
		manifest,
	});

	const otherRoot = repository(t);
	assert.throws(
		() => registry.resolveProjection("review-root-scope", otherRoot),
		(error: unknown) => error instanceof CandidateViewError && /different contributor root/.test(error.message),
	);
	// The root guard still resolves correctly against the true root.
	assert.equal(registry.resolveProjection("review-root-scope", cwd).candidateTree, candidate);
});

// --- 3.5 threat matrix: Commit state ----------------------------------------
//
// `projection` on the descriptor claims "staged" (a committed range) or
// "workspace" (dirty-inclusive). `restoreProjectionFromNative` independently
// derives `committedOnly` from the descriptor's own base/candidate
// relationship to HEAD; the claimed label must agree with that derivation, or
// the request is rejected rather than silently trusting — or silently
// overriding — a mislabeled projection kind.

test("a projection labeled workspace but derived as a genuinely committed range is rejected as a projection-kind mismatch", (t) => {
	const cwd = repository(t);
	const baseTree = baseTreeOf(cwd);
	writeFileSync(join(cwd, "tracked.txt"), "committed candidate\n");
	git(cwd, "add", "tracked.txt");
	git(cwd, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "candidate");
	const candidateTree = git(cwd, "rev-parse", "HEAD^{tree}");

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-projection-kind-drift", cwd, {
			baseTree,
			currentCandidateTree: candidateTree,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			// Git facts derive committedOnly=true (HEAD moved past base with no
			// dirty overlay), but the descriptor mislabels it as a workspace
			// snapshot.
			projection: "workspace",
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "projection-kind-drift",
	);
});

test("candidate view treats an unborn staged repository base as Git's empty tree without needing HEAD^{commit}", (t) => {
	const contributorRoot = unbornRepository(t);
	const view = createCandidateView({ contributorRoot });
	try {
		const emptyTree = emptyTreeOf(contributorRoot);
		assert.equal(view.baseTree, emptyTree);
		assert.equal(view.baseCommit, "HEAD");
		assert.equal(view.committedOnly, false);
		assert.notEqual(view.candidateTree, emptyTree);
		assert.deepEqual(view.paths, ["staged.txt"]);
		assert.deepEqual(view.deletedPaths, []);
	} finally {
		view.cleanup();
	}
});

test("candidate view of an unborn repository with no content yields an empty candidate scope instead of a misleading base-ref failure", (t) => {
	const contributorRoot = unbornRepository(t, false);
	const view = createCandidateView({ contributorRoot });
	try {
		const emptyTree = emptyTreeOf(contributorRoot);
		assert.equal(view.baseTree, emptyTree);
		assert.equal(view.candidateTree, emptyTree);
		assert.equal(view.baseCommit, "HEAD");
		assert.deepEqual(view.paths, []);
		assert.deepEqual(view.deletedPaths, []);
	} finally {
		view.cleanup();
	}
});

test("candidate view materializes an unborn staged repository without mutating the contributor index or creating a phantom commit", (t) => {
	const contributorRoot = unbornRepository(t);
	const indexBefore = readFileSync(join(contributorRoot, ".git", "index"));
	const view = createCandidateView({ contributorRoot });
	try {
		// No phantom commit: HEAD stays unborn and no refs exist.
		assert.throws(() => git(contributorRoot, "rev-parse", "--verify", "HEAD"), /fatal/i);
		assert.equal(git(contributorRoot, "rev-list", "--all").length, 0);
		// Contributor's real index is untouched; materialization uses a private index file.
		assert.deepEqual(readFileSync(join(contributorRoot, ".git", "index")), indexBefore);
		// The materialized candidate carries the staged content, isolated from the contributor tree.
		assert.equal(readFileSync(join(view.root, "staged.txt"), "utf8"), "first staged\n");
		assert.deepEqual(view.paths, ["staged.txt"]);
	} finally {
		view.cleanup();
	}
	// Cleanup removed the orphan worktree; no worktree lingers and no commit appeared.
	assert.equal(git(contributorRoot, "worktree", "list").split("\n").filter((line) => line.includes("gentle-ai-candidate")).length, 0);
	assert.equal(git(contributorRoot, "rev-list", "--all").length, 0);
});

test("candidate view fails closed for a detached HEAD pointing at a missing commit, not an unborn empty tree", (t) => {
	const contributorRoot = unbornRepository(t);
	// Detach HEAD to a non-existent object id. This is a corrupt/missing-object
	// existing HEAD state, not a valid unborn symbolic HEAD, so it must fail
	// closed rather than producing an empty-tree unborn candidate.
	writeFileSync(join(contributorRoot, ".git", "HEAD"), "0".repeat(40));
	let failure: unknown;
	try {
		createCandidateView({ contributorRoot });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError, "a detached missing HEAD must fail closed");
	assert.notEqual((failure as CandidateViewError).reason, undefined);
	assert.ok((failure as CandidateViewError).reason !== "base-ref-moved");
});

test("candidate view fails closed when symbolic HEAD target ref exists but points to a missing object, not unborn", (t) => {
	const contributorRoot = repository(t);
	// Break the main ref: it exists (show-ref --exists returns 0) but points to
	// a missing object. This is a broken symbolic HEAD, not a valid unborn repo.
	writeFileSync(join(contributorRoot, ".git", "refs", "heads", "main"), `${"0".repeat(40)}\n`);
	let failure: unknown;
	try {
		createCandidateView({ contributorRoot });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError, "a broken symbolic HEAD must fail closed, not unborn");
});

test("candidate view probe does not convert a ref-existence probe timeout into an unborn empty-tree base", (t) => {
	const contributorRoot = unbornRepository(t);
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "rev-parse" && args.includes("--quiet")) throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true });
		return execFileSync(file, args, options);
	};
	let failure: unknown;
	try {
		new CandidateViewRegistry(executor).create({ contributorRoot });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError, "ref-existence probe timeout must fail closed");
	assert.equal((failure as CandidateViewError).reason, "candidate-view-timeout");
});

test("candidate view fails closed when the unborn ref probe exits with an unexpected status instead of treating it as unborn", (t) => {
	const contributorRoot = unbornRepository(t);
	// Only status 1 means "ref absent" (valid unborn). Any other nonzero status
	// (128, etc.) signals corruption or an I/O failure and must fail closed,
	// never masquerade as an unborn empty-tree base.
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "rev-parse" && args.includes("--quiet")) throw Object.assign(new Error("fatal: probe failed"), { status: 128 });
		return execFileSync(file, args, options);
	};
	let failure: unknown;
	try {
		new CandidateViewRegistry(executor).create({ contributorRoot });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError, "an unexpected unborn probe status must fail closed, not unborn");
	assert.equal((failure as CandidateViewError).reason, "candidate-view-git-failure");
});

test("candidate view treats an unborn sha256 repository base as the repository-native sha256 empty tree", (t) => {
	const contributorRoot = mkdtempSync(join(tmpdir(), "gentle-pi-candidate-view-unborn-sha256-"));
	t.after(() => rmSync(contributorRoot, { recursive: true, force: true }));
	try {
		git(contributorRoot, "init", "--object-format=sha256", "-b", "main");
	} catch {
		t.skip("installed git does not support `git init --object-format=sha256`");
		return;
	}
	git(contributorRoot, "config", "user.name", "Candidate Test");
	git(contributorRoot, "config", "user.email", "candidate@example.invalid");
	writeFileSync(join(contributorRoot, "staged.txt"), "first staged\n");
	git(contributorRoot, "add", "staged.txt");
	const view = createCandidateView({ contributorRoot });
	try {
		const emptyTree = emptyTreeOf(contributorRoot);
		assert.equal(emptyTree.length, 64, "a sha256 repository must derive a 64-hex empty tree, not the hardcoded SHA-1 id");
		assert.equal(view.baseTree, emptyTree);
		assert.equal(view.baseCommit, "HEAD");
		assert.equal(view.committedOnly, false);
		assert.notEqual(view.candidateTree, emptyTree);
		assert.deepEqual(view.paths, ["staged.txt"]);
		assert.deepEqual(view.deletedPaths, []);
	} finally {
		view.cleanup();
	}
});

test("candidate view unborn worktree falls back when --orphan is unsupported, preserving isolation, no phantom commit, and contributor immutability", (t) => {
	const contributorRoot = unbornRepository(t);
	const indexBefore = readFileSync(join(contributorRoot, ".git", "index"));
	// Intercept --orphan with status 129 (Git < 2.42 unknown option).
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add" && args.includes("--orphan")) throw Object.assign(new Error("unknown option"), { status: 129 });
		return execFileSync(file, args, options);
	};
	const view = new CandidateViewRegistry(executor).create({ contributorRoot });
	try {
		assert.equal(readFileSync(join(view.root, "staged.txt"), "utf8"), "first staged\n");
		assert.deepEqual(view.paths, ["staged.txt"]);
		assert.equal(view.baseTree, emptyTreeOf(contributorRoot));
		// No phantom commit; contributor index untouched.
		assert.throws(() => git(contributorRoot, "rev-parse", "--verify", "HEAD"), /fatal/i);
		assert.equal(git(contributorRoot, "rev-list", "--all").length, 0);
		assert.deepEqual(readFileSync(join(contributorRoot, ".git", "index")), indexBefore);
	} finally {
		view.cleanup();
	}
	assert.equal(git(contributorRoot, "worktree", "list").split("\n").filter((line) => line.includes("gentle-ai-candidate")).length, 0);
	assert.equal(git(contributorRoot, "rev-list", "--all").length, 0);
});

test("candidate view unborn worktree propagates a non-usage --orphan failure instead of falling back", (t) => {
	const contributorRoot = unbornRepository(t);
	// A non-129 status must not trigger the fallback.
	const calls: string[][] = [];
	const executor: CandidateGitExecutor = (file, args, options) => {
		calls.push([...args]);
		if (args[0] === "worktree" && args[1] === "add" && args.includes("--orphan")) throw Object.assign(new Error("genuine failure"), { status: 128 });
		return execFileSync(file, args, options);
	};
	let failure: unknown;
	try { new CandidateViewRegistry(executor).create({ contributorRoot }); } catch (error) { failure = error; }
	assert.ok(failure instanceof CandidateViewError, "a non-usage --orphan failure must propagate");
	assert.equal((failure as CandidateViewError).reason, "candidate-view-git-failure");
	assert.ok(!calls.some((args) => args[0] === "commit-tree"), "the fallback must not create a temporary commit");
	assert.ok(!calls.some((args) => args[0] === "worktree" && args.includes("--detach")), "the fallback must not add a detached worktree");
});

test("candidate view cleans up a partially registered unborn fallback worktree when a later step fails", (t) => {
	const contributorRoot = unbornRepository(t);
	// Force the --orphan path to take the pre-2.42 fallback, then fail the
	// symbolic-ref rewrite that follows `worktree add --no-checkout --detach`.
	// The worktree is already registered with Git at that point; the cleanup
	// boundary must remove both the registered worktree and its directory.
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add" && args.includes("--orphan")) throw Object.assign(new Error("unknown option"), { status: 129 });
		if (args[0] === "symbolic-ref") throw Object.assign(new Error("symbolic-ref failed"), { status: 1 });
		return execFileSync(file, args, options);
	};
	let failure: unknown;
	try { new CandidateViewRegistry(executor).create({ contributorRoot }); } catch (error) { failure = error; }
	assert.ok(failure instanceof CandidateViewError, "the symbolic-ref failure must propagate");
	assert.equal((failure as CandidateViewError).reason, "candidate-view-git-failure");
	// No registered/admin worktree remains.
	assert.equal(git(contributorRoot, "worktree", "list").split("\n").filter((line) => line.includes("gentle-ai-candidate")).length, 0);
	// No candidate directory remains under the candidate-view parent.
	const parent = join(realpathSync(git(contributorRoot, "rev-parse", "--path-format=absolute", "--git-common-dir")), "gentle-ai", "candidate-views");
	const leftover = existsSync(parent) ? readdirSync(parent).filter((entry) => lstatSync(join(parent, entry)).isDirectory()) : [];
	assert.deepEqual(leftover, [], "no candidate directory remains after a partial unborn fallback failure");
});
