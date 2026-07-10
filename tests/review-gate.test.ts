import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";
import {
	FULL_4R_LENSES,
	REVIEW_LENS,
	REVIEW_ROUTE,
	TRIVIALITY,
	buildDiffEvidence,
	classifyReviewRoute,
	type ReviewPlan,
} from "../lib/review-triggers.ts";

const {
	applyReviewAdvice,
	classifyReviewEvent,
	collectReviewDiffForCommand,
	computeDiffForEvent,
	parseNumstat,
	reviewAdviceMessage,
} = __testing;

function plan(overrides: Partial<ReviewPlan> = {}): ReviewPlan {
	return {
		route: REVIEW_ROUTE.STANDARD,
		lenses: [REVIEW_LENS.READABILITY],
		reason: "ordinary non-trivial diff",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// classifyReviewEvent — command → TriggerEvent classification
// ---------------------------------------------------------------------------

test("classifyReviewEvent: git commit → pre-commit", () => {
	assert.equal(classifyReviewEvent("git commit -m 'fix: stuff'"), "pre-commit");
});

test("classifyReviewEvent: git commit --amend → pre-commit", () => {
	assert.equal(classifyReviewEvent("git commit --amend --no-edit"), "pre-commit");
});

test("classifyReviewEvent: git push → pre-push", () => {
	assert.equal(classifyReviewEvent("git push origin main"), "pre-push");
});

test("classifyReviewEvent: git push with flags → pre-push", () => {
	assert.equal(classifyReviewEvent("git push -u origin feat/my-feature"), "pre-push");
});

test("classifyReviewEvent: gh pr create → pre-pr", () => {
	assert.equal(classifyReviewEvent("gh pr create --title 'My PR' --body 'desc'"), "pre-pr");
});

test("classifyReviewEvent: gh pr create with flags → pre-pr", () => {
	assert.equal(classifyReviewEvent("gh pr create --draft"), "pre-pr");
});

test("classifyReviewEvent: unrelated command → null", () => {
	assert.equal(classifyReviewEvent("npm install"), null);
});

test("classifyReviewEvent: echo hello → null", () => {
	assert.equal(classifyReviewEvent("echo hello"), null);
});

test("classifyReviewEvent: git status → null", () => {
	assert.equal(classifyReviewEvent("git status"), null);
});

test("classifyReviewEvent: git log → null", () => {
	assert.equal(classifyReviewEvent("git log --oneline -5"), null);
});

for (const expected of [
	{
		command: "git -C /selected/commit-repo commit -m fix",
		event: "pre-commit",
		gitGlobalArgs: ["-C", "/selected/commit-repo"],
	},
	{
		command: "git -C /selected/push-repo push origin main",
		event: "pre-push",
		gitGlobalArgs: ["-C", "/selected/push-repo"],
	},
	{
		command: "git --git-dir=/repos/commit.git commit -m fix",
		event: "pre-commit",
		gitGlobalArgs: ["--git-dir=/repos/commit.git"],
	},
	{
		command: "git --git-dir /repos/push.git push origin main",
		event: "pre-push",
		gitGlobalArgs: ["--git-dir", "/repos/push.git"],
	},
	{
		command: "git --work-tree=/work/commit commit -m fix",
		event: "pre-commit",
		gitGlobalArgs: ["--work-tree=/work/commit"],
	},
	{
		command: "git --work-tree /work/push push origin main",
		event: "pre-push",
		gitGlobalArgs: ["--work-tree", "/work/push"],
	},
	{
		command: "git -C /repo --git-dir=.git --work-tree . commit -m fix",
		event: "pre-commit",
		gitGlobalArgs: ["-C", "/repo", "--git-dir=.git", "--work-tree", "."],
	},
	{
		command: "git -C /repo --git-dir .git --work-tree=. push origin main",
		event: "pre-push",
		gitGlobalArgs: ["-C", "/repo", "--git-dir", ".git", "--work-tree=."],
	},
] as const) {
	test(`${expected.event} preserves repository selectors for diff evidence: ${expected.command}`, () => {
		const expectedDiff = { changedPaths: ["src/selected.ts"], changedLines: 3 };
		assert.equal(classifyReviewEvent(expected.command), expected.event);
		const collection = collectReviewDiffForCommand(
			expected.command,
			"/session/repo",
			(event, cwd, options) => {
				assert.equal(event, expected.event);
				assert.equal(cwd, "/session/repo");
				assert.deepEqual(options.gitGlobalArgs, expected.gitGlobalArgs);
				return expectedDiff;
			},
		);
		assert.deepEqual(collection, { event: expected.event, diff: expectedDiff });
	});
}

test("all-tracked collection reads staged plus tracked worktree changes and excludes untracked files", (t) => {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-review-git-"));
	const repository = join(parent, "selected-repo");
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	mkdirSync(repository);
	const git = (...args: string[]): string =>
		execFileSync("git", args, { cwd: repository, encoding: "utf8" });
	git("init", "-b", "main");
	for (const file of ["staged.ts", "tracked.ts", "deleted.ts"]) {
		writeFileSync(join(repository, file), `initial ${file}\n`);
	}
	git("add", ".");
	git(
		"-c",
		"user.name=Gentle Pi Tests",
		"-c",
		"user.email=gentle-pi@example.invalid",
		"commit",
		"-m",
		"initial",
	);
	git("update-ref", "refs/remotes/origin/main", "HEAD");

	writeFileSync(join(repository, "staged.ts"), "staged change\n");
	git("add", "staged.ts");
	writeFileSync(join(repository, "tracked.ts"), "tracked worktree change\n");
	rmSync(join(repository, "deleted.ts"));
	writeFileSync(join(repository, "untracked.ts"), "must not be reviewed\n");

	const plain = computeDiffForEvent("pre-commit", repository, {
		gitGlobalArgs: [],
		includeAllTracked: false,
	});
	assert.deepEqual(plain?.changedPaths, ["staged.ts"]);

	for (const target of [
		{
			cwd: parent,
			gitGlobalArgs: ["-C", basename(repository)],
		},
		{
			cwd: parent,
			gitGlobalArgs: [
				`--git-dir=${join(repository, ".git")}`,
				`--work-tree=${repository}`,
			],
		},
		{
			cwd: parent,
			gitGlobalArgs: [
				"--git-dir",
				join(repository, ".git"),
				"--work-tree",
				repository,
			],
		},
	] as const) {
		const allTracked = computeDiffForEvent("pre-commit", target.cwd, {
			gitGlobalArgs: [...target.gitGlobalArgs],
			includeAllTracked: true,
		});
		assert.deepEqual(
			allTracked?.changedPaths.toSorted(),
			["deleted.ts", "staged.ts", "tracked.ts"],
		);
	}

	git("add", "-u");
	git(
		"-c",
		"user.name=Gentle Pi Tests",
		"-c",
		"user.email=gentle-pi@example.invalid",
		"commit",
		"-m",
		"tracked changes",
	);
	for (const target of [
		{ cwd: parent, gitGlobalArgs: ["-C", basename(repository)] },
		{
			cwd: parent,
			gitGlobalArgs: [
				"--git-dir",
				join(repository, ".git"),
				`--work-tree=${repository}`,
			],
		},
	] as const) {
		const push = computeDiffForEvent("pre-push", target.cwd, {
			gitGlobalArgs: [...target.gitGlobalArgs],
			includeAllTracked: false,
		});
		assert.deepEqual(
			push?.changedPaths.toSorted(),
			["deleted.ts", "staged.ts", "tracked.ts"],
		);
	}
});

for (const command of [
	"git commit -a -m fix",
	"git commit -am fix",
	"git commit --all --message fix",
]) {
	test(`pre-commit evidence includes tracked worktree changes for ${command}`, () => {
		collectReviewDiffForCommand(command, "/session/repo", (_event, _cwd, options) => {
			assert.equal(options.includeAllTracked, true);
			return { changedPaths: ["src/tracked.ts"], changedLines: 2 };
		});
	});
}

for (const command of [
	'git commit -m "describe -a without staging"',
	'git commit --message="describe --all without staging"',
]) {
	test(`commit message text does not enable all-tracked collection for ${command}`, () => {
		collectReviewDiffForCommand(command, "/session/repo", (_event, _cwd, options) => {
			assert.equal(options.includeAllTracked, false);
			return { changedPaths: ["docs/message.md"], changedLines: 1 };
		});
	});
}

test("empty successful diff evidence remains conservative", () => {
	const evidence = buildDiffEvidence(
		"pre-commit",
		{ changedPaths: [], changedLines: 0 },
		true,
	);

	assert.equal(evidence.triviality, TRIVIALITY.UNPROVEN);
	assert.equal(classifyReviewRoute(evidence).route, REVIEW_ROUTE.STANDARD);
});

// ---------------------------------------------------------------------------
// parseNumstat — parses git diff --numstat output
// ---------------------------------------------------------------------------

test("parseNumstat: empty string → zero lines, no paths", () => {
	const result = parseNumstat("");
	assert.equal(result.changedLines, 0);
	assert.deepEqual(result.changedPaths, []);
});

test("parseNumstat: single line normal file", () => {
	const result = parseNumstat("5\t3\tsrc/foo.ts\n");
	assert.equal(result.changedLines, 8);
	assert.deepEqual(result.changedPaths, ["src/foo.ts"]);
});

test("parseNumstat: multiple lines", () => {
	const result = parseNumstat("10\t2\tsrc/a.ts\n3\t1\tsrc/b.ts\n");
	assert.equal(result.changedLines, 16);
	assert.deepEqual(result.changedPaths, ["src/a.ts", "src/b.ts"]);
});

test("parseNumstat: binary row (- -) counts as 0 changed lines", () => {
	const result = parseNumstat("-\t-\tassets/image.png\n");
	assert.equal(result.changedLines, 0);
	assert.deepEqual(result.changedPaths, ["assets/image.png"]);
});

test("parseNumstat: mixed normal and binary rows", () => {
	const result = parseNumstat("5\t2\tsrc/main.ts\n-\t-\tassets/logo.png\n1\t0\tsrc/util.ts\n");
	assert.equal(result.changedLines, 8);
	assert.deepEqual(result.changedPaths, ["src/main.ts", "assets/logo.png", "src/util.ts"]);
});

test("parseNumstat: whitespace-only input → zero", () => {
	const result = parseNumstat("   \n   \n");
	assert.equal(result.changedLines, 0);
	assert.deepEqual(result.changedPaths, []);
});

// ---------------------------------------------------------------------------
// FIX 3: parseNumstat distinguishes empty-but-valid from git error (null)
// ---------------------------------------------------------------------------

test("parseNumstat: empty numstat output returns zero diff object, not null", () => {
	// Empty staging area / no changes: git succeeds but prints nothing.
	// Must return a valid ChangedDiff so advisory bindings still fire, not null.
	const result = parseNumstat("");
	assert.ok(result !== null, "parseNumstat should return a ChangedDiff object, not null");
	assert.equal(result.changedLines, 0);
	assert.deepEqual(result.changedPaths, []);
});

test("parseNumstat ignores malformed rows without inventing changed paths", () => {
	const result = parseNumstat("not-numstat\n3\tbroken\n2\t1\tsrc/real.ts\n");
	assert.equal(result.changedLines, 3);
	assert.deepEqual(result.changedPaths, ["src/real.ts"]);
});

test("review advice describes trivial, standard, and full routes without receipts", () => {
	const trivial = reviewAdviceMessage(
		plan({ route: REVIEW_ROUTE.TRIVIAL, lenses: [], reason: "objective triviality proven" }),
		"pre-pr",
	);
	assert.match(trivial, /trivial/);
	assert.match(trivial, /zero review lenses/);

	const standard = reviewAdviceMessage(plan(), "pre-commit");
	assert.match(standard, /standard/);
	assert.match(standard, /review-readability/);

	const full = reviewAdviceMessage(
		plan({ route: REVIEW_ROUTE.FULL_4R, lenses: FULL_4R_LENSES }),
		"pre-pr",
	);
	assert.match(full, /full-4R/);
	for (const lens of FULL_4R_LENSES) assert.match(full, new RegExp(lens));
	assert.doesNotMatch(`${trivial}\n${standard}\n${full}`, /receipt|retry|complete review/i);
});

test("applyReviewAdvice notifies but never blocks command execution", () => {
	const notifications: Array<{ message: string; level: string }> = [];
	const ctx = {
		hasUI: true,
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
	};

	for (const reviewPlan of [
		plan({ route: REVIEW_ROUTE.TRIVIAL, lenses: [] }),
		plan(),
		plan({ route: REVIEW_ROUTE.FULL_4R, lenses: FULL_4R_LENSES }),
	]) {
		assert.equal(applyReviewAdvice(reviewPlan, "pre-pr", ctx), undefined);
	}

	assert.equal(notifications.length, 3);
	assert.ok(notifications.every(({ level }) => level === "info"));
});
