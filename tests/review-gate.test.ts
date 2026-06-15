import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

const { classifyReviewEvent, parseNumstat } = __testing;

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
