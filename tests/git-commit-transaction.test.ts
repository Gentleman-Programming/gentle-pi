import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	COMMIT_TRANSACTION_STATE,
	assertNoUnresolvedCommitTransaction,
	inspectCommitTransaction,
	prepareCommitTransactionInvocation,
	reconcileCommitTransaction,
	runGitCommitTransaction,
} from "../lib/git-commit-transaction.ts";
import type { NativeReviewCli, NativeValidateResult } from "../lib/native-review-cli.ts";

function git(cwd: string, ...arguments_: string[]): string {
	return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-commit-transaction-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.name", "Commit Transaction Test");
	git(cwd, "config", "user.email", "commit-transaction@example.invalid");
	writeFileSync(join(cwd, "tracked.txt"), "base\n");
	git(cwd, "add", "tracked.txt");
	git(cwd, "commit", "-m", "base");
	return cwd;
}

function installHook(cwd: string, name: string, body: string): void {
	const hooks = git(cwd, "rev-parse", "--path-format=absolute", "--git-path", "hooks");
	mkdirSync(hooks, { recursive: true });
	const path = join(hooks, name);
	writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`);
	chmodSync(path, 0o700);
}

function stage(cwd: string, content = "candidate\n"): string {
	writeFileSync(join(cwd, "tracked.txt"), content);
	git(cwd, "add", "tracked.txt");
	return git(cwd, "write-tree");
}

function invocation(cwd: string, lineageId: string, arguments_: readonly string[] = ["-m", "candidate"]) {
	const intendedTree = git(cwd, "write-tree");
	const command = `git commit ${arguments_.map((value) => JSON.stringify(value)).join(" ")}`;
	return prepareCommitTransactionInvocation({
		command,
		cwd,
		arguments: arguments_,
		authorization: {
			lineageId,
			storeRevision: "sha256:" + "a".repeat(64),
			fingerprint: "sha256:" + "b".repeat(64),
			intendedTree,
		},
	});
}

function native(cwd: string, lineageId: string, result: NativeValidateResult["result"] = "allow"): NativeReviewCli {
	return {
		async validate(request) {
			const tree = git(cwd, "write-tree");
			return {
				allowed: result === "allow",
				result,
				action: result === "allow" ? "continue" : result === "scope-changed" ? "create-new-lineage" : "explicit-maintainer-action",
				reason: result === "allow" ? "receipt allows exact tree" : "post-hook tree differs from receipt",
				gateContext: {
					lineageId,
					storeRevision: "sha256:" + "c".repeat(64),
					raw: { gate: request.gate, lineage_id: lineageId, candidate_tree: tree },
				},
			};
		},
	} as NativeReviewCli;
}

test("a non-mutating pre-commit hook runs once and HEAD proves the native-authorized tree", async (t) => {
	const cwd = repository(t);
	stage(cwd);
	const count = join(cwd, ".git", "hook-count");
	installHook(cwd, "pre-commit", `printf '1\\n' >> ${JSON.stringify(count)}`);
	const before = git(cwd, "rev-parse", "HEAD");
	const result = await runGitCommitTransaction(invocation(cwd, "non-mutating"), { nativeReviewCli: native(cwd, "non-mutating") });
	assert.notEqual(result.head, before);
	assert.equal(result.tree, git(cwd, "rev-parse", "HEAD^{tree}"));
	assert.equal(readFileSync(count, "utf8"), "1\n");
	assert.deepEqual(inspectCommitTransaction(cwd), { status: "clean" });
});

test("a mutating hook creates no commit until the post-hook tree is reviewed, then exact retry skips the hook", async (t) => {
	const cwd = repository(t);
	stage(cwd, "unformatted\n");
	const count = join(cwd, ".git", "hook-count");
	installHook(cwd, "pre-commit", `printf 'formatted\\n' > tracked.txt\ngit add tracked.txt\nprintf '1\\n' >> ${JSON.stringify(count)}`);
	const before = git(cwd, "rev-parse", "HEAD");
	await assert.rejects(
		runGitCommitTransaction(invocation(cwd, "before-format"), { nativeReviewCli: native(cwd, "before-format", "scope-changed") }),
		/post-hook tree/,
	);
	assert.equal(git(cwd, "rev-parse", "HEAD"), before);
	assert.equal(inspectCommitTransaction(cwd).record?.state, COMMIT_TRANSACTION_STATE.AWAITING_REVIEW);
	assert.throws(() => assertNoUnresolvedCommitTransaction(cwd), /publication is blocked/);
	const result = await runGitCommitTransaction(invocation(cwd, "after-format"), { nativeReviewCli: native(cwd, "after-format") });
	assert.equal(result.tree, git(cwd, "rev-parse", "HEAD^{tree}"));
	assert.equal(readFileSync(count, "utf8"), "1\n");
});

test("a failing pre-commit hook creates no commit and leaves explicit recovery state", async (t) => {
	const cwd = repository(t);
	stage(cwd);
	installHook(cwd, "pre-commit", "exit 23");
	const before = git(cwd, "rev-parse", "HEAD");
	await assert.rejects(runGitCommitTransaction(invocation(cwd, "hook-failure"), { nativeReviewCli: native(cwd, "hook-failure") }), /hook failed/);
	assert.equal(git(cwd, "rev-parse", "HEAD"), before);
	assert.equal(inspectCommitTransaction(cwd).record?.state, COMMIT_TRANSACTION_STATE.HOOK_FAILED);
});

test("message hooks cannot change the index after native authorization", async (t) => {
	const cwd = repository(t);
	stage(cwd);
	installHook(cwd, "prepare-commit-msg", "printf 'late mutation\\n' > tracked.txt\ngit add tracked.txt");
	const before = git(cwd, "rev-parse", "HEAD");
	await assert.rejects(runGitCommitTransaction(invocation(cwd, "late-mutation"), { nativeReviewCli: native(cwd, "late-mutation") }), /Git commit failed/);
	assert.equal(git(cwd, "rev-parse", "HEAD"), before);
	assert.equal(inspectCommitTransaction(cwd).record?.state, COMMIT_TRANSACTION_STATE.COMMIT_FAILED);
});

test("amend and post-commit crash reconciliation preserve the exact authorized tree", async (t) => {
	const cwd = repository(t);
	const authorizedTree = stage(cwd, "amended\n");
	const amended = await runGitCommitTransaction(invocation(cwd, "amend", ["--amend", "--no-edit"]), { nativeReviewCli: native(cwd, "amend") });
	assert.equal(amended.tree, authorizedTree);
	stage(cwd, "after-crash\n");
	await assert.rejects(
		runGitCommitTransaction(invocation(cwd, "crash"), { nativeReviewCli: native(cwd, "crash"), failpoint: "after-commit-before-proof" }),
		/test interruption/,
	);
	assert.equal(inspectCommitTransaction(cwd).record?.state, COMMIT_TRANSACTION_STATE.COMMIT_RUNNING);
	assert.deepEqual(reconcileCommitTransaction(cwd), { status: "clean" });
	assert.deepEqual(inspectCommitTransaction(cwd), { status: "clean" });
});
