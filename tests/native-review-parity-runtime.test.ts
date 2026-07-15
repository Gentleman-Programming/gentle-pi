import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveGentleAiBinary } from "../lib/gentle-ai-binary.ts";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binary = resolveGentleAiBinary(packageRoot, process.platform);
const OFFICIAL_BINARY_SHA256 = "d2cf080ebb92f73ef30aaf36eb7ca6eeb750592d670a71ca5a045f121edf9071";
const REVIEWED_PATHS = ["tracked.txt", "initially-untracked.txt"] as const;
// Golden captured by the clean external-artifact differential fixture for v2.1.3.
// This is released runtime output, not a locally reconstructed authority digest.
const CLEAN_DIFFERENTIAL_PUBLISHED_PATHS_DIGEST = "sha256:5d91d7650fcbd1165e9cd88c144bf28d82913e3537abd7b4fdc8ad0adb9eab9c";
const REVIEWED_MODES = ["100644", "100644"];

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface ReviewStart {
	lineage_id: string;
	selected_lenses: string[];
}

interface ReviewGateContext {
	candidate_tree: string;
	paths_digest: string;
	denial?: ReviewDenial;
}

interface ReviewDenial {
	stage: string;
	code: string;
}

interface ReviewGateResult {
	result: string;
	allowed: boolean;
	context: ReviewGateContext;
}

async function run(command: string, arguments_: readonly string[], cwd: string, allowFailure = false, environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
	try {
		const result = await execFileAsync(command, [...arguments_], { cwd, encoding: "utf8", shell: false, env: environment });
		return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		const result = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
		if (allowFailure && typeof result.code === "number") return { exitCode: result.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
		throw error;
	}
}

async function stagedEntries(repository: string): Promise<string[]> {
	const output = (await run("git", ["ls-files", "--stage"], repository)).stdout.trim();
	return output === "" ? [] : output.split("\n");
}

async function assertPublishedProjection(repository: string, candidateTree: string): Promise<void> {
	const stagedTree = (await run("git", ["write-tree"], repository)).stdout.trim();
	const entries = await stagedEntries(repository);
	const stagedPaths = entries.map((entry) => entry.split("\t", 2)[1]);
	const stagedModes = entries.map((entry) => entry.split(" ", 1)[0]);
	assert.equal(stagedTree, candidateTree, `staged tree must match frozen candidate; entries: ${entries.join(", ")}`);
	assert.deepEqual(stagedPaths, [...REVIEWED_PATHS].toSorted());
	assert.deepEqual(stagedModes, REVIEWED_MODES);
}

async function assertScopeChanged(repository: string, lineageId: string): Promise<void> {
	const deniedCommand = await run(binary, ["review", "validate", "--gate", "pre-commit", "--cwd", repository, "--lineage", lineageId], repository, true);
	const denied = JSON.parse(deniedCommand.stdout) as ReviewGateResult;
	assert.equal(deniedCommand.exitCode, 1);
	assert.equal(denied.result, "scope-changed");
	assert.equal(denied.allowed, false);
	assert.deepEqual(denied.context.denial, { stage: "receipt-binding", code: "candidate-or-paths-mismatch" });
}

async function restoreCandidate(repository: string, candidateTree: string): Promise<void> {
	await writeFile(join(repository, "tracked.txt"), "candidate\n");
	await rm(join(repository, "extra-reviewed-path.txt"), { force: true });
	await run("git", ["reset", "--", "extra-reviewed-path.txt"], repository);
	await run("git", ["add", "--", ...REVIEWED_PATHS], repository);
	await assertPublishedProjection(repository, candidateTree);
}

test("official v2.1.5 package runtime authorizes an unchanged linked-view candidate and denies a changed staging tree", async (t) => {
	assert.equal(createHash("sha256").update(await readFile(binary)).digest("hex"), OFFICIAL_BINARY_SHA256);
	assert.deepEqual(await run(binary, ["version"], packageRoot), { exitCode: 0, stdout: "gentle-ai 2.1.5\n", stderr: "" });

	const workspace = await mkdtemp(join(tmpdir(), "gentle-pi-v215-parity-"));
	const repository = join(workspace, "repository");
	const view = join(workspace, "candidate-view");
	const artifacts = join(workspace, "artifacts");
	const temporaryIndex = join(workspace, "controller.index");
	t.after(async () => rm(workspace, { recursive: true, force: true }));

	await mkdir(repository);
	await mkdir(artifacts);
	await run("git", ["init", "--initial-branch=main"], repository);
	await run("git", ["config", "user.email", "test@example.invalid"], repository);
	await run("git", ["config", "user.name", "Gentle Pi test"], repository);
	await writeFile(join(repository, "tracked.txt"), "base\n");
	await run("git", ["add", "--", "tracked.txt"], repository);
	await run("git", ["commit", "-m", "base"], repository);
	await writeFile(join(repository, "tracked.txt"), "candidate\n");
	await writeFile(join(repository, "initially-untracked.txt"), "included\n");

	const temporaryIndexEnvironment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
	await run("git", ["read-tree", "HEAD"], repository, false, temporaryIndexEnvironment);
	await run("git", ["add", "--", ...REVIEWED_PATHS], repository, false, temporaryIndexEnvironment);
	const candidateTree = (await run("git", ["write-tree"], repository, false, temporaryIndexEnvironment)).stdout.trim();
	await run("git", ["worktree", "add", "--detach", view, "HEAD"], repository);
	await run("git", ["read-tree", candidateTree], view);
	await run("git", ["checkout-index", "--all", "--force"], view);

	assert.equal((await readFile(join(view, "tracked.txt"), "utf8")), "candidate\n");
	assert.equal((await readFile(join(view, "initially-untracked.txt"), "utf8")), "included\n");
	const started = JSON.parse((await run(binary, ["review", "start", "--cwd", view], view)).stdout) as ReviewStart;

	const evidence = join(artifacts, "final-evidence.txt");
	await writeFile(evidence, "linked-view parity probe\n");
	const resultFiles: string[] = [];
	for (const [index] of started.selected_lenses.entries()) {
		const result = join(artifacts, `lens-${index}.json`);
		await writeFile(result, JSON.stringify({ findings: [], evidence: ["reviewed linked candidate view"] }));
		resultFiles.push(result);
	}
	await run(binary, ["review", "finalize", "--cwd", view, "--lineage", started.lineage_id, ...resultFiles.flatMap((result) => ["--result", result]), "--evidence", evidence], view);

	await run("git", ["add", "--", ...REVIEWED_PATHS], repository);
	await assertPublishedProjection(repository, candidateTree);
	const allowed = JSON.parse((await run(binary, ["review", "validate", "--gate", "pre-commit", "--cwd", repository, "--lineage", started.lineage_id], repository)).stdout) as ReviewGateResult;
	assert.equal(allowed.result, "allow");
	assert.equal(allowed.allowed, true);
	assert.equal(allowed.context.candidate_tree, candidateTree);
	assert.equal(allowed.context.paths_digest, CLEAN_DIFFERENTIAL_PUBLISHED_PATHS_DIGEST);
	t.diagnostic(JSON.stringify({ candidateTree, publishedPathsDigest: CLEAN_DIFFERENTIAL_PUBLISHED_PATHS_DIGEST, reviewedPaths: REVIEWED_PATHS, reviewedModes: REVIEWED_MODES, binary, startCwd: view, finalizeCwd: view, artifacts }));

	await writeFile(join(repository, "tracked.txt"), "changed-after-review\n");
	await run("git", ["add", "--", "tracked.txt"], repository);
	assert.notEqual((await run("git", ["write-tree"], repository)).stdout.trim(), candidateTree);
	await assertScopeChanged(repository, started.lineage_id);
	await restoreCandidate(repository, candidateTree);

	await writeFile(join(repository, "extra-reviewed-path.txt"), "not in the frozen candidate\n");
	await run("git", ["add", "extra-reviewed-path.txt"], repository);
	assert.notEqual((await run("git", ["write-tree"], repository)).stdout.trim(), candidateTree);
	assert.deepEqual((await stagedEntries(repository)).map((entry) => entry.split("\t", 2)[1]), [...REVIEWED_PATHS, "extra-reviewed-path.txt"].toSorted());
	await assertScopeChanged(repository, started.lineage_id);
	await restoreCandidate(repository, candidateTree);

	await chmod(join(repository, "tracked.txt"), 0o755);
	await run("git", ["add", "--", "tracked.txt"], repository);
	const modeDrifted = (await stagedEntries(repository)).some((entry) => entry === "100755" || entry.startsWith("100755 "));
	if (modeDrifted) {
		assert.notEqual((await run("git", ["write-tree"], repository)).stdout.trim(), candidateTree);
		await assertScopeChanged(repository, started.lineage_id);
	} else {
		t.diagnostic("skipped native mode-drift denial because this repository/platform does not stage executable-bit changes");
	}
	await chmod(join(repository, "tracked.txt"), 0o644);
	await restoreCandidate(repository, candidateTree);
});
