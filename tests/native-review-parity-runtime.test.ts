import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import { resolveGentleAiBinary } from "../lib/gentle-ai-binary.ts";
import { NativeReviewCliV214 } from "../lib/native-review-cli.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binary = resolveGentleAiBinary(packageRoot, process.platform);
const OFFICIAL_BINARY_SHA256 = "a7bbfcf58c4b6e933672338984ec011251595155198047f20c41a69242c6cf5d";
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

interface RegisteredController {
	execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<{ details?: unknown }>;
}

interface ReviewStart {
	lineage_id: string;
	selected_lenses: string[];
	action?: string;
	state?: string;
}

interface ReviewFinalize {
	lineage_id: string;
	state: string;
	store_revision: string;
	receipt_path: string;
}

interface ReviewAuthorityEntry {
	version: string;
	lineage_id: string;
	status: string;
	state: string;
	revision: string;
	problems: unknown[];
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

async function reviewStatus(repository: string): Promise<Record<string, unknown>> {
	return JSON.parse((await run(binary, ["review", "status", "--cwd", repository], repository)).stdout) as Record<string, unknown>;
}

function authorityInventory(status: Record<string, unknown>): ReviewAuthorityEntry[] {
	assert.ok(Array.isArray(status.entries), "review status must expose authority entries");
	return status.entries.map((entry) => {
		assert.ok(entry !== null && typeof entry === "object", "authority entry must be an object");
		const candidate = entry as Record<string, unknown>;
		for (const key of ["version", "lineage_id", "status", "state", "revision"] as const) {
			assert.equal(typeof candidate[key], "string", `authority entry ${key} must be stable text`);
		}
		assert.ok(Array.isArray(candidate.problems), "authority entry problems must be an array");
		return {
			version: candidate.version as string,
			lineage_id: candidate.lineage_id as string,
			status: candidate.status as string,
			state: candidate.state as string,
			revision: candidate.revision as string,
			problems: candidate.problems,
		};
	});
}

async function finalizeEmptyReview(repository: string, artifacts: string, started: ReviewStart, evidenceName: string): Promise<CommandResult> {
	const evidence = join(artifacts, evidenceName);
	await writeFile(evidence, `evidence for ${started.lineage_id}\n`);
	const resultFiles: string[] = [];
	for (const [index] of started.selected_lenses.entries()) {
		const result = join(artifacts, `${evidenceName}-lens-${index}.json`);
		await writeFile(result, JSON.stringify({ findings: [], evidence: ["reviewed frozen candidate"] }));
		resultFiles.push(result);
	}
	return run(binary, ["review", "finalize", "--cwd", repository, "--lineage", started.lineage_id, ...resultFiles.flatMap((result) => ["--result", result]), "--evidence", evidence], repository);
}

test("official v2.1.6 package runtime authorizes an unchanged linked-view candidate and denies a changed staging tree", async (t) => {
	assert.equal(createHash("sha256").update(await readFile(binary)).digest("hex"), OFFICIAL_BINARY_SHA256);
	assert.deepEqual(await run(binary, ["version"], packageRoot), { exitCode: 0, stdout: "gentle-ai 2.1.6\n", stderr: "" });

	const workspace = await mkdtemp(join(tmpdir(), "gentle-pi-v216-parity-"));
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

test("official v2.1.6 package runtime keeps frozen candidate lineages and receipts isolated across replay and replacement", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "gentle-pi-v215-lineage-"));
	const repository = join(workspace, "repository");
	const artifacts = join(workspace, "artifacts");
	t.after(async () => rm(workspace, { recursive: true, force: true }));

	await mkdir(repository);
	await mkdir(artifacts);
	await run("git", ["init", "--initial-branch=main"], repository);
	await run("git", ["config", "user.email", "test@example.invalid"], repository);
	await run("git", ["config", "user.name", "Gentle Pi test"], repository);
	await writeFile(join(repository, "tracked.txt"), "base\n");
	await run("git", ["add", "--", "tracked.txt"], repository);
	await run("git", ["commit", "-m", "base"], repository);

	await writeFile(join(repository, "tracked.txt"), "candidate one\n");
	const first = JSON.parse((await run(binary, ["review", "start", "--cwd", repository], repository)).stdout) as ReviewStart;
	const firstInventory = authorityInventory(await reviewStatus(repository));
	const firstReplay = JSON.parse((await run(binary, ["review", "start", "--cwd", repository], repository)).stdout) as ReviewStart;
	const firstReplayInventory = authorityInventory(await reviewStatus(repository));
	assert.equal(firstReplay.lineage_id, first.lineage_id, "replaying an exact START must reuse the frozen lineage");
	assert.deepEqual(firstReplayInventory, firstInventory, "replaying an exact START must not create durable authority");

	const firstFinalized = JSON.parse((await finalizeEmptyReview(repository, artifacts, first, "first-evidence.txt")).stdout) as ReviewFinalize;
	const firstFinalizedInventory = authorityInventory(await reviewStatus(repository));
	const firstFinalizeReplay = JSON.parse((await finalizeEmptyReview(repository, artifacts, first, "first-evidence.txt")).stdout) as ReviewFinalize;
	const firstFinalizeReplayInventory = authorityInventory(await reviewStatus(repository));
	assert.equal(firstFinalized.lineage_id, first.lineage_id);
	assert.equal(firstFinalized.state, "approved");
	assert.match(firstFinalized.store_revision, /^sha256:[a-f0-9]{64}$/);
	assert.equal(firstFinalizeReplay.store_revision, firstFinalized.store_revision, "replaying an exact FINALIZE must reuse its receipt revision");
	assert.equal(firstFinalizeReplay.receipt_path, firstFinalized.receipt_path, "replaying an exact FINALIZE must reuse its receipt location");
	assert.deepEqual(firstFinalizeReplayInventory, firstFinalizedInventory, "replaying an exact FINALIZE must not create a durable receipt or authority");
	assert.deepEqual(firstFinalizedInventory, [{ version: "compact-v2", lineage_id: first.lineage_id, status: "approved", state: "approved", revision: firstFinalized.store_revision, problems: [] }]);

	await run("git", ["add", "--", "tracked.txt"], repository);
	const firstCandidateTree = (await run("git", ["write-tree"], repository)).stdout.trim();
	const firstAllowed = JSON.parse((await run(binary, ["review", "validate", "--gate", "pre-commit", "--cwd", repository, "--lineage", first.lineage_id], repository)).stdout) as ReviewGateResult;
	assert.equal(firstAllowed.result, "allow");
	assert.equal(firstAllowed.context.candidate_tree, firstCandidateTree);

	await writeFile(join(repository, "tracked.txt"), "candidate two\n");
	await run("git", ["add", "--", "tracked.txt"], repository);
	const secondCandidateTree = (await run("git", ["write-tree"], repository)).stdout.trim();
	assert.notEqual(secondCandidateTree, firstCandidateTree);
	const authorityBeforeCompetingStart = authorityInventory(await reviewStatus(repository));
	const competingStart = await run(binary, ["review", "start", "--cwd", repository, "--lineage", first.lineage_id], repository);
	const competingStartResult = JSON.parse(competingStart.stdout) as ReviewStart;
	const authorityAfterCompetingStart = authorityInventory(await reviewStatus(repository));
	assert.equal(competingStartResult.action, "blocked-scope-action", "a frozen lineage must return a structured scope-action block for a competing candidate");
	assert.equal(competingStartResult.lineage_id, first.lineage_id);
	assert.equal(competingStartResult.state, "approved");
	assert.deepEqual(authorityAfterCompetingStart, authorityBeforeCompetingStart, "a blocked scope action must not mutate approved authority");
	const second = JSON.parse((await run(binary, ["review", "start", "--cwd", repository], repository)).stdout) as ReviewStart;
	const secondInventory = authorityInventory(await reviewStatus(repository));
	assert.equal(second.action, "created");
	assert.equal(second.state, "reviewing");
	assert.notEqual(second.lineage_id, first.lineage_id, "a distinct candidate must establish a distinct lineage");
	const secondReplay = JSON.parse((await run(binary, ["review", "start", "--cwd", repository], repository)).stdout) as ReviewStart;
	const secondReplayInventory = authorityInventory(await reviewStatus(repository));
	assert.equal(secondReplay.lineage_id, second.lineage_id, "replaying the second START must reuse its lineage");
	assert.deepEqual(secondReplayInventory, secondInventory, "replaying the second START must not duplicate durable authority");
	await finalizeEmptyReview(repository, artifacts, second, "second-evidence.txt");

	const secondAllowed = JSON.parse((await run(binary, ["review", "validate", "--gate", "pre-commit", "--cwd", repository, "--lineage", second.lineage_id], repository)).stdout) as ReviewGateResult;
	assert.equal(secondAllowed.result, "allow");
	assert.equal(secondAllowed.context.candidate_tree, secondCandidateTree);
	await assertScopeChanged(repository, first.lineage_id);

	await writeFile(join(repository, "tracked.txt"), "candidate one\n");
	await run("git", ["add", "--", "tracked.txt"], repository);
	assert.equal((await run("git", ["write-tree"], repository)).stdout.trim(), firstCandidateTree);
	const firstRestored = JSON.parse((await run(binary, ["review", "validate", "--gate", "pre-commit", "--cwd", repository, "--lineage", first.lineage_id], repository)).stdout) as ReviewGateResult;
	assert.equal(firstRestored.result, "allow", "the old receipt must remain valid for its exact frozen candidate");

	await writeFile(join(repository, "tracked.txt"), "candidate two\n");
	await run("git", ["add", "--", "tracked.txt"], repository);
	assert.equal((await run("git", ["write-tree"], repository)).stdout.trim(), secondCandidateTree);
	t.diagnostic("pre-push, pre-pr, and release require remote/publication evidence; their network-aware gate contracts remain covered by dedicated gate integration tests rather than this hermetic binary E2E.");
});

test("registered gentle_review START materializes a safe internal skill symlink before invoking native authority", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "gentle-pi-v215-symlink-candidate-"));
	const repository = join(workspace, "repository");
	t.after(async () => rm(workspace, { recursive: true, force: true }));

	await mkdir(join(repository, ".agents", "skills", "example"), { recursive: true });
	await mkdir(join(repository, ".agent", "skills"), { recursive: true });
	await writeFile(join(repository, "tracked.txt"), "base\n");
	await writeFile(join(repository, ".agents", "skills", "example", "SKILL.md"), "---\nname: example\n---\n");
	const link = join(repository, ".agent", "skills", "example");
	const linkTarget = "../../.agents/skills/example";
	await symlink(linkTarget, link);
	const lexicalTarget = resolve(dirname(link), linkTarget);
	const lexicalRelative = relative(repository, lexicalTarget);
	assert.ok(lexicalRelative !== "" && !lexicalRelative.startsWith("..") && !isAbsolute(lexicalRelative), "the internal symlink target must resolve lexically inside the repository");

	await run("git", ["init", "--initial-branch=main"], repository);
	await run("git", ["config", "user.email", "test@example.invalid"], repository);
	await run("git", ["config", "user.name", "Gentle Pi test"], repository);
	await run("git", ["add", "--", "tracked.txt", ".agents", ".agent"], repository);
	await run("git", ["commit", "-m", "base with internal skill symlink"], repository);
	await writeFile(join(repository, "tracked.txt"), "candidate\n");

	const candidateViews = new CandidateViewRegistry();
	let nativeStartReached = false;
	const native = new NativeReviewCliV214(async (request) => {
		if (request.arguments[0] === "review" && request.arguments[1] === "start") nativeStartReached = true;
		const command = await run(binary, request.arguments, request.cwd, true);
		return { ...command, signal: null, timedOut: false, outputLimitExceeded: false };
	});
	const tools = new Map<string, RegisteredController>();
	createGentleAiExtension({ nativeReviewCli: native, candidateViews } as Parameters<typeof createGentleAiExtension>[0])({
		on() {},
		registerTool(definition: RegisteredController & { name: string }) { tools.set(definition.name, definition); },
		registerCommand() {},
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	assert.ok(controller);

	let returned: { details?: unknown } | undefined;
	let thrown: unknown;
	try {
		returned = await controller.execute("issue-146-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, { cwd: repository, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionContext);
	} catch (caught) {
		thrown = caught;
	}
	const error = thrown instanceof Error ? { name: thrown.name, message: thrown.message } : thrown === undefined ? undefined : String(thrown);
	t.diagnostic(JSON.stringify({ returned: returned?.details, error, nativeStartReached }));
	assert.equal(thrown, undefined, "safe internal symlink materialization must not throw before START");
	assert.equal(nativeStartReached, true, "safe internal symlink materialization must reach native START");
	const result = (returned?.details as { result?: Record<string, unknown> } | undefined)?.result;
	assert.equal(typeof result?.lineage_id, "string", "safe internal symlink materialization must return native review authority");
	assert.equal(result?.state, "reviewing");
	candidateViews.cleanup(candidateViews.resolveForLens(result!.lineage_id as string, "review-reliability").token);
});
