import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	CHANGE_STATUS,
	ChangesTracker,
	changesSummary,
	emptyChanges,
	parseNumstat,
	parsePorcelain,
	renderChangesWidget,
	sessionChanges,
	snapshotChanges,
	type ChangedFile,
} from "../lib/shell-changes.ts";

// The changes view shows what the agent touched during this session: git
// state now, minus whatever was already dirty when the session started.

const plainTheme = {
	fg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return text;
	},
};

const taggedTheme = {
	fg(color: string, text: string) {
		return `<${color}>${text}</${color}>`;
	},
	bold(text: string) {
		return text;
	},
};

function file(path: string, added: number, deleted: number, status: ChangedFile["status"] = CHANGE_STATUS.MODIFIED): ChangedFile {
	return { path, added, deleted, status };
}

test("parseNumstat reads counts, treats binaries as zero, and resolves rename braces", () => {
	const parsed = parseNumstat("12\t3\tlib/a.ts\n-\t-\tassets/logo.png\n0\t0\tsrc/{old => new}/file.ts\n5\t1\told.ts => new.ts\n");
	assert.deepEqual(parsed, [
		{ path: "lib/a.ts", added: 12, deleted: 3 },
		{ path: "assets/logo.png", added: 0, deleted: 0 },
		{ path: "src/new/file.ts", added: 0, deleted: 0 },
		{ path: "new.ts", added: 5, deleted: 1 },
	]);
});

test("parsePorcelain reads NUL-separated status entries including renames and untracked files", () => {
	const raw = [" M lib/a.ts", "A  lib/b.ts", " D lib/c.ts", "?? notes.md", "R  new.ts", "old.ts", "MM lib/d.ts"].join("\0") + "\0";
	const parsed = parsePorcelain(raw);
	assert.deepEqual(
		[...parsed.entries()],
		[
			["lib/a.ts", CHANGE_STATUS.MODIFIED],
			["lib/b.ts", CHANGE_STATUS.ADDED],
			["lib/c.ts", CHANGE_STATUS.DELETED],
			["notes.md", CHANGE_STATUS.UNTRACKED],
			["new.ts", CHANGE_STATUS.RENAMED],
			["lib/d.ts", CHANGE_STATUS.MODIFIED],
		],
	);
});

test("snapshotChanges merges status with counts and keeps untracked files without counts", () => {
	const files = snapshotChanges({
		numstat: "4\t2\tlib/a.ts\n",
		porcelain: " M lib/a.ts\0?? notes.md\0",
	});
	assert.deepEqual(files, [file("lib/a.ts", 4, 2), file("notes.md", 0, 0, CHANGE_STATUS.UNTRACKED)]);
});

test("sessionChanges drops files that look exactly as they did when the session started", () => {
	const baseline = [file("lib/a.ts", 4, 2), file("notes.md", 0, 0, CHANGE_STATUS.UNTRACKED)];
	const now = [file("lib/a.ts", 4, 2), file("notes.md", 0, 0, CHANGE_STATUS.UNTRACKED), file("lib/b.ts", 10, 0, CHANGE_STATUS.ADDED)];
	const model = sessionChanges(now, baseline);
	assert.deepEqual(model.files, [file("lib/b.ts", 10, 0, CHANGE_STATUS.ADDED)]);
	assert.equal(model.added, 10);
	assert.equal(model.deleted, 0);
});

test("sessionChanges keeps a pre-dirty file once its counts move", () => {
	const baseline = [file("lib/a.ts", 4, 2)];
	const model = sessionChanges([file("lib/a.ts", 9, 2)], baseline);
	assert.deepEqual(model.files, [file("lib/a.ts", 9, 2)]);
});

test("changesSummary and the widget describe the session at a glance", () => {
	const model = sessionChanges([file("extensions/gentle-shell.ts", 31, 0, CHANGE_STATUS.ADDED), file("lib/shell-bar.ts", 9, 7), file("tests/x.test.ts", 2, 0)], []);
	assert.equal(changesSummary(model), "3 files · +42 −7");
	assert.equal(changesSummary(sessionChanges([file("a.ts", 1, 0)], [])), "1 file · +1 −0");

	const [line, ...rest] = renderChangesWidget(model, plainTheme, 120);
	assert.equal(rest.length, 0);
	assert.equal(line, "✎ 3 files · +42 −7 · extensions/gentle-shell.ts, lib/shell-bar.ts, tests/x.test.ts · /gentle:changes");
});

test("renderChangesWidget colors counts by direction and yields nothing when clean", () => {
	const model = sessionChanges([file("a.ts", 1, 2)], []);
	const [line] = renderChangesWidget(model, taggedTheme, 400);
	assert.match(line, /<accent>✎<\/accent>/);
	assert.match(line, /<success>\+1<\/success> <error>−2<\/error>/);
	assert.match(line, /<dim>\/gentle:changes<\/dim>/);
	assert.deepEqual(renderChangesWidget(emptyChanges(), plainTheme, 120), []);
});

test("renderChangesWidget drops the file list before truncating on narrow terminals", () => {
	const model = sessionChanges([file("a/very/long/path/one.ts", 1, 0), file("a/very/long/path/two.ts", 1, 0)], []);
	const [line] = renderChangesWidget(model, plainTheme, 40);
	assert.ok(visibleWidth(line) <= 40);
	assert.match(line, /^✎ 2 files · \+2 −0/);
	assert.doesNotMatch(line, /one\.ts/);
});

function fakeGit(numstats: string[], porcelains: string[], code = 0) {
	const calls: string[][] = [];
	let round = 0;
	const git = async (args: string[]) => {
		calls.push(args);
		const isNumstat = args[0] === "diff";
		const index = Math.min(isNumstat ? round : round++, numstats.length - 1);
		return { stdout: isNumstat ? numstats[index] : porcelains[index], code };
	};
	return { git, calls };
}

test("ChangesTracker captures a baseline on start and reports only later changes", async () => {
	const { git, calls } = fakeGit(
		["4\t2\tlib/a.ts\n", "4\t2\tlib/a.ts\n10\t0\tlib/b.ts\n"],
		[" M lib/a.ts\0", " M lib/a.ts\0A  lib/b.ts\0"],
	);
	const tracker = new ChangesTracker(git);
	await tracker.start();
	assert.deepEqual(tracker.model, emptyChanges());
	const model = await tracker.refresh();
	assert.deepEqual(model.files, [file("lib/b.ts", 10, 0, CHANGE_STATUS.ADDED)]);
	assert.equal(calls.length, 4);
	assert.deepEqual(calls[0], ["diff", "--numstat", "HEAD"]);
	assert.deepEqual(calls[1], ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
});

test("ChangesTracker stays quiet outside a git repository", async () => {
	const { git, calls } = fakeGit([""], [""], 128);
	const tracker = new ChangesTracker(git);
	await tracker.start();
	assert.deepEqual(await tracker.refresh(), emptyChanges());
	assert.equal(calls.length, 2);
});

test("ChangesTracker coalesces overlapping refreshes into at most one extra round", async () => {
	let resolveGate: (() => void) | undefined;
	let rounds = 0;
	const git = async (args: string[]) => {
		if (args[0] === "diff") {
			rounds += 1;
			if (rounds === 2) await new Promise<void>((resolve) => { resolveGate = resolve; });
		}
		return { stdout: "", code: 0 };
	};
	const tracker = new ChangesTracker(git);
	await tracker.start();
	const first = tracker.refresh();
	const second = tracker.refresh();
	const third = tracker.refresh();
	await new Promise((resolve) => setTimeout(resolve, 0));
	resolveGate?.();
	await Promise.all([first, second, third]);
	assert.equal(rounds, 3);
});
