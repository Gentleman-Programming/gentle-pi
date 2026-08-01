import assert from "node:assert/strict";
import test from "node:test";
import {
	DISPATCHED_TAG_PATTERN,
	GENTLE_AI_BUMP_BASE_BRANCH,
	GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX,
	buildPullRequestArguments,
	buildPullRequestBody,
	deriveBumpHeadBranch,
	parseArguments,
	runGentleAiPinBump,
	validateDispatchedTag,
} from "../scripts/bump-gentle-ai-pin.mjs";

// ---------------------------------------------------------------------------
// threat-matrix "PR commands" (design.md, added row) -- task 8.1.
//
// The dispatch payload IS the tag (maintainer decision: the provider sends
// nothing else). Every one of these tests proves the tag is validated
// against ^v\d+\.\d+\.\d+$ BEFORE it is used for anything -- branch naming,
// git commands, or gh pr create arguments.
// ---------------------------------------------------------------------------

test("validateDispatchedTag accepts a well-formed vX.Y.Z tag and returns it unchanged", () => {
	assert.equal(validateDispatchedTag("v2.2.4"), "v2.2.4");
	assert.equal(validateDispatchedTag("v10.0.100"), "v10.0.100");
});

test("DISPATCHED_TAG_PATTERN is exactly ^v\\d+\\.\\d+\\.\\d+$", () => {
	assert.equal(DISPATCHED_TAG_PATTERN.source, "^v\\d+\\.\\d+\\.\\d+$");
});

// --- a dispatched tag carrying shell metacharacters is rejected ------------

const SHELL_METACHARACTER_TAGS = [
	"v1.2.3; rm -rf /",
	"v1.2.3 && rm -rf /",
	"v1.2.3 | cat /etc/passwd",
	"v1.2.3`whoami`",
	"v1.2.3$(whoami)",
	"v1.2.3\nrm -rf /",
	"v1.2.3'",
	'v1.2.3"',
	"v1.2.3 > /tmp/pwned",
	"v1.2.3 & background",
];

for (const maliciousTag of SHELL_METACHARACTER_TAGS) {
	test(`validateDispatchedTag rejects a tag carrying shell metacharacters: ${JSON.stringify(maliciousTag)}`, () => {
		assert.throws(() => validateDispatchedTag(maliciousTag), /does not match/);
	});
}

// --- a --head injection attempt is rejected --------------------------------

const HEAD_INJECTION_TAGS = [
	"v1.2.3 --head evil-branch",
	"v1.2.3\t--head=evil-branch",
	"--head",
	"--head evil-branch",
	"v1.2.3 --base evil-base",
];

for (const injectionTag of HEAD_INJECTION_TAGS) {
	test(`validateDispatchedTag rejects a --head/--base injection attempt: ${JSON.stringify(injectionTag)}`, () => {
		assert.throws(() => validateDispatchedTag(injectionTag), /does not match/);
	});
}

test("validateDispatchedTag rejects non-string input", () => {
	// @ts-expect-error -- exercising a defensive runtime guard, not a type error
	assert.throws(() => validateDispatchedTag(undefined), /does not match/);
});

// ---------------------------------------------------------------------------
// deriveBumpHeadBranch -- the head branch is derived ONLY from the already
// validated tag, never from any other part of the dispatch payload.
// ---------------------------------------------------------------------------

test("deriveBumpHeadBranch derives a branch name from a validated tag", () => {
	assert.equal(deriveBumpHeadBranch("v2.2.4"), `${GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX}v2.2.4`);
});

test("deriveBumpHeadBranch defensively re-validates even if called directly, without validateDispatchedTag first", () => {
	assert.throws(() => deriveBumpHeadBranch("v1.2.3; rm -rf /"), /already-validated tag/);
	assert.throws(() => deriveBumpHeadBranch("--head evil-branch"), /already-validated tag/);
});

// ---------------------------------------------------------------------------
// buildPullRequestArguments -- an implicit base (no explicit --base main) is
// rejected; the PR base is always the explicit literal "main".
// ---------------------------------------------------------------------------

test("buildPullRequestArguments rejects an implicit (omitted) base", () => {
	assert.throws(
		() =>
			buildPullRequestArguments({
				// @ts-expect-error -- exercising the implicit-base guard, not a type error
				base: undefined,
				head: `${GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX}v2.2.4`,
				title: "chore(gentle-ai): bump pin to v2.2.4",
				body: "body",
			}),
		/explicit literal "main"/,
	);
});

test("buildPullRequestArguments rejects any base other than the explicit literal main", () => {
	assert.throws(
		() =>
			buildPullRequestArguments({
				base: "develop",
				head: `${GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX}v2.2.4`,
				title: "chore(gentle-ai): bump pin to v2.2.4",
				body: "body",
			}),
		/explicit literal "main"/,
	);
});

test("buildPullRequestArguments rejects a head branch that is not the derived prefix + validated tag shape", () => {
	assert.throws(
		() =>
			buildPullRequestArguments({
				base: GENTLE_AI_BUMP_BASE_BRANCH,
				head: "evil-branch",
				title: "chore(gentle-ai): bump pin to v2.2.4",
				body: "body",
			}),
		/head branch must be exactly/,
	);
});

test("buildPullRequestArguments returns an argv array with base and head as separate literal tokens, never a composed string", () => {
	const arguments_ = buildPullRequestArguments({
		base: GENTLE_AI_BUMP_BASE_BRANCH,
		head: `${GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX}v2.2.4`,
		title: "chore(gentle-ai): bump pin to v2.2.4",
		body: buildPullRequestBody("v2.2.4"),
	});
	assert.deepEqual(arguments_.slice(0, 6), ["pr", "create", "--base", "main", "--head", "bump/gentle-ai-v2.2.4"]);
	// The whole argv is a flat array of separate tokens -- nowhere is base or
	// head embedded inside a single composed string that a shell could
	// reparse.
	for (const token of arguments_) {
		assert.equal(typeof token, "string");
	}
});

test("buildPullRequestArguments never includes an auto-merge flag", () => {
	const arguments_ = buildPullRequestArguments({
		base: GENTLE_AI_BUMP_BASE_BRANCH,
		head: `${GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX}v2.2.4`,
		title: "chore(gentle-ai): bump pin to v2.2.4",
		body: buildPullRequestBody("v2.2.4"),
	});
	for (const forbidden of ["--auto", "--admin", "--squash", "merge"]) {
		assert.ok(!arguments_.includes(forbidden), `unexpected auto-merge-adjacent token ${JSON.stringify(forbidden)}`);
	}
});

// ---------------------------------------------------------------------------
// buildPullRequestBody -- states the human-review requirement explicitly.
// ---------------------------------------------------------------------------

test("buildPullRequestBody documents that the PR requires human review and is never auto-merged", () => {
	const body = buildPullRequestBody("v2.2.4");
	assert.match(body, /human review/i);
	assert.match(body, /never auto-merged/i);
	assert.match(body, /v2\.2\.4/);
});

// ---------------------------------------------------------------------------
// parseArguments -- CLI entry point.
// ---------------------------------------------------------------------------

test("parseArguments extracts the --tag value", () => {
	assert.deepEqual(parseArguments(["--tag", "v2.2.4"]), { rawTag: "v2.2.4" });
});

test("parseArguments throws a usage error when --tag is missing", () => {
	assert.throws(() => parseArguments([]), /usage: bump-gentle-ai-pin\.mjs --tag/);
});

test("parseArguments throws a usage error when --tag has no value", () => {
	assert.throws(() => parseArguments(["--tag"]), /usage: bump-gentle-ai-pin\.mjs --tag/);
});

// ---------------------------------------------------------------------------
// runGentleAiPinBump -- orchestration, with an injected command fake so no
// real git/gh/network call ever happens in this test.
// ---------------------------------------------------------------------------

type RecordedCall = { file: string; args: string[] };

function fakeRunCommand(recorded: RecordedCall[], responses: Record<string, string>, failing?: { matches: (call: RecordedCall) => boolean; error: Error }) {
	return async (file: string, args: string[]) => {
		const call = { file, args };
		recorded.push(call);
		if (failing && failing.matches(call)) throw failing.error;
		const key = `${file} ${args.join(" ")}`;
		return responses[key] ?? "";
	};
}

test("runGentleAiPinBump rejects an invalid tag before issuing a single command", async () => {
	const recorded: RecordedCall[] = [];
	await assert.rejects(
		runGentleAiPinBump({ rawTag: "v1.2.3; rm -rf /", packageRoot: "/tmp/does-not-matter", runCommand: fakeRunCommand(recorded, {}) }),
		/does not match/,
	);
	assert.equal(recorded.length, 0, "no command may run before the tag is validated");
});

test("runGentleAiPinBump stops before any commit/push/PR step when the signed-release sync step fails", async () => {
	const recorded: RecordedCall[] = [];
	const syncFailure = new Error("minisign signature verification failed: the message does not match the signature under the trusted public key");
	const runCommand = fakeRunCommand(recorded, {}, {
		matches: (call) => call.args.some((argument) => argument.includes("sync-gentle-ai-release.mjs")),
		error: syncFailure,
	});
	await assert.rejects(
		runGentleAiPinBump({ rawTag: "v2.2.4", packageRoot: "/tmp/does-not-matter", runCommand }),
		/minisign signature verification failed/,
	);
	// D3: digests are written only after signature verification succeeds. The
	// sync step ran (and failed) but nothing that could produce a commit, a
	// push, or a PR ever ran afterward.
	const commandNames = recorded.map((call) => `${call.file} ${call.args[0]}`);
	assert.ok(!commandNames.some((name) => name.includes("build-gentle-ai-baselines")));
	assert.ok(!commandNames.some((name) => name.includes("build-skill-overlays")));
	assert.ok(!recorded.some((call) => call.file === "git" && call.args[0] === "commit"));
	assert.ok(!recorded.some((call) => call.file === "git" && call.args[0] === "push"));
	assert.ok(!recorded.some((call) => call.file === "gh"));
});

test("runGentleAiPinBump runs the three generators in order, then opens a PR with an explicit base=main, when there are changes", async () => {
	const recorded: RecordedCall[] = [];
	const runCommand = fakeRunCommand(recorded, { "git status --porcelain": " M capabilities/gentle-ai-release.lock.json\n" });
	const result = await runGentleAiPinBump({ rawTag: "v2.2.4", packageRoot: "/tmp/does-not-matter", runCommand });

	assert.equal(result.prOpened, true);
	assert.equal(result.tag, "v2.2.4");
	assert.equal(result.headBranch, "bump/gentle-ai-v2.2.4");

	const orderedSignatures = recorded.map((call) => `${call.file}:${call.args[0]}`);
	const syncIndex = orderedSignatures.findIndex((signature) => signature.includes("sync-gentle-ai-release"));
	const baselinesIndex = orderedSignatures.findIndex((signature) => signature.includes("build-gentle-ai-baselines"));
	const overlaysIndex = orderedSignatures.findIndex((signature) => signature.includes("build-skill-overlays"));
	const commitIndex = recorded.findIndex((call) => call.file === "git" && call.args[0] === "commit");
	const pushIndex = recorded.findIndex((call) => call.file === "git" && call.args[0] === "push");
	const ghIndex = recorded.findIndex((call) => call.file === "gh");

	assert.ok(syncIndex !== -1 && baselinesIndex !== -1 && overlaysIndex !== -1);
	assert.ok(syncIndex < baselinesIndex, "sync must run before baselines");
	assert.ok(baselinesIndex < overlaysIndex, "baselines must run before overlays");
	assert.ok(overlaysIndex < commitIndex, "generators must run before the commit");
	assert.ok(commitIndex < pushIndex, "commit must happen before push");
	assert.ok(pushIndex < ghIndex, "push must happen before the PR is opened");

	const ghCall = recorded[ghIndex];
	assert.equal(ghCall.args[0], "pr");
	assert.equal(ghCall.args[1], "create");
	assert.deepEqual(ghCall.args.slice(2, 6), ["--base", GENTLE_AI_BUMP_BASE_BRANCH, "--head", "bump/gentle-ai-v2.2.4"]);

	// No call, anywhere in the whole orchestration, ever merges the PR or
	// requests auto-merge -- the bump PR always waits for human review.
	assert.ok(!recorded.some((call) => call.file === "gh" && call.args[1] === "merge"));
	for (const call of recorded) {
		assert.ok(!call.args.includes("--auto"), `unexpected --auto in ${call.file} ${call.args.join(" ")}`);
	}
});

test("runGentleAiPinBump opens no PR and makes no commit when the generators produce no changes", async () => {
	const recorded: RecordedCall[] = [];
	const runCommand = fakeRunCommand(recorded, { "git status --porcelain": "" });
	const result = await runGentleAiPinBump({ rawTag: "v2.2.4", packageRoot: "/tmp/does-not-matter", runCommand });

	assert.equal(result.prOpened, false);
	assert.ok(!recorded.some((call) => call.file === "git" && call.args[0] === "commit"));
	assert.ok(!recorded.some((call) => call.file === "git" && call.args[0] === "push"));
	assert.ok(!recorded.some((call) => call.file === "gh"));
});
