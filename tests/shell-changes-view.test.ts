import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CHANGE_STATUS, changesModel, type ChangedFile } from "../lib/shell-changes.ts";
import { WorktreeChangesView, ChangesView, colorDiff, type ChangesViewDeps } from "../lib/shell-changes-view.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";

// The changes overlay: files on the left, the selected file's diff on the
// right, keys at the bottom. Rendering is pure; git access is injected.

const plainTheme = {
	fg(_color: string, text: string) {
		return text;
	},
};

const taggedTheme = {
	fg(color: string, text: string) {
		return `<${color}>${text}</${color}>`;
	},
};

function file(path: string, added: number, deleted: number, status: ChangedFile["status"] = CHANGE_STATUS.MODIFIED): ChangedFile {
	return { path, added, deleted, status };
}

const DIFF_A = ["diff --git a/lib/a.ts b/lib/a.ts", "index 1..2 100644", "--- a/lib/a.ts", "+++ b/lib/a.ts", "@@ -1,2 +1,3 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", "+const c = 4;"].join("\n");

function view(overrides: Partial<ChangesViewDeps> = {}, files = [file("lib/a.ts", 2, 1), file("lib/b.ts", 10, 0, CHANGE_STATUS.ADDED)]) {
	const calls: string[] = [];
	const events: string[] = [];
	const deps: ChangesViewDeps = {
		theme: plainTheme,
		rows: 12,
		async loadDiff(target) {
			calls.push(target.path);
			return target.path === "lib/a.ts" ? DIFF_A : "";
		},
		onOpen(target) {
			events.push(`open:${target.path}`);
		},
		onClose() {
			events.push("close");
		},
		requestRender() {
			events.push("render");
		},
		...overrides,
	};
	return { view: new ChangesView(changesModel(files), deps), calls, events };
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

test("worktree accordion keeps groups and nested files beside a framed lazy diff", async () => {
	const trees = ["/main", "/linked"].map((root) => ({ root, branch: root === "/main" ? "main" : undefined, model: changesModel([file("same.ts", 1, 0)]) }));
	const loaded: string[] = [];
	const opened: string[] = [];
	let closed = 0;
	const component = new WorktreeChangesView(trees, {
		theme: plainTheme, rows: 10,
		loadDiff: async (root, target) => { loaded.push(root); return `+${root}:${target.path}`; },
		onOpen: (root, target) => { opened.push(`${root}:${target.path}`); },
		onClose: () => { closed++; }, requestRender() {}, onRefresh() {},
	});
	assert.deepEqual(loaded, [], "list must not eagerly load diffs");
	assert.match(component.render(100).join("\n"), /detached · linked/);
	component.handleInput("\r");
	assert.deepEqual(loaded, [], "expanding a header must not select a file");
	component.handleInput("j");
	await settle();
	const lines = component.render(100);
	assert.equal(lines.length, 10);
	assert.match(lines[0], /^╭─ ✎ Changes/);
	assert.match(lines[1], /^│   ▾ main · main +│ \+\/main:same.ts +│$/);
	assert.match(lines[2], /^│ ▸   M same.ts +\+1 -0 +│/);
	assert.match(lines[3], /^│   ▸ detached · linked +│/);
	assert.match(lines[9], /^╰─+╯$/);
	for (const line of lines) assert.equal(visibleWidth(line), 100);
	assert.match(component.render(100).join("\n"), /\+\/main:same.ts/);
	component.handleInput("o");
	component.handleInput("j");
	assert.doesNotMatch(component.render(100).join("\n"), /\+\/main:same.ts/, "header selection clears unrelated preview");
	assert.match(component.render(100)[2], /^│     M same.ts +\+1 -0 +│/, "unselected children retain their fixed marker and indentation");
	component.handleInput(" ");
	component.handleInput("j");
	await settle();
	assert.match(component.render(100).join("\n"), /▾ main · main/, "multiple groups remain expanded");
	assert.match(component.render(100).join("\n"), /\+\/linked:same.ts/);
	assert.doesNotMatch(component.render(100).join("\n"), /\+\/main:same.ts/);
	component.handleInput("\r");
	assert.deepEqual(opened, ["/main:same.ts", "/linked:same.ts"]);
	assert.deepEqual(loaded, ["/main", "/linked"]);
	component.update([trees[0]]);
	assert.match(component.render(100).join("\n"), /main · main/);
	component.handleInput("\x1b");
	assert.equal(closed, 1);
});

test("worktree list keeps selection visible, preserves root across reorder and refreshes from either level", async () => {
	const trees = Array.from({ length: 15 }, (_, index) => ({ root: `/tree-${index}`, branch: `branch-${index}`, model: changesModel([file("a.ts", 1, 0)]) }));
	let refreshed = 0;
	const loaded: string[] = [];
	const component = new WorktreeChangesView(trees, {
		theme: plainTheme, rows: 8, loadDiff: async (root) => { loaded.push(root); return ""; },
		onOpen() {}, onClose() {}, requestRender() {}, onRefresh() { refreshed++; },
	});
	for (let index = 0; index < 14; index++) component.handleInput("j");
	assert.match(component.render(100).join("\n"), /▸ ▸ branch-14/);
	component.update([...trees].reverse());
	component.handleInput("r");
	component.handleInput("\r");
	component.handleInput("j");
	component.handleInput("r");
	await settle();
	assert.deepEqual(loaded, ["/tree-14"]);
	assert.equal(refreshed, 2);
	for (const line of component.render(30)) assert.ok(visibleWidth(line) <= 30);
	component.update([]);
	assert.match(component.render(100).join("\n"), /No dirty worktrees/);
	component.handleInput("\r");
	assert.equal(loaded.length, 1);
});

test("worktree labels remove terminal controls without changing diff or editor roots", async () => {
	const root = "/repo\nline\tcolumn\r\x07\x1b[31mred\x1b[0m\x1b]0;injected title\x07";
	const routed: string[] = [];
	const component = new WorktreeChangesView([{ root, branch: "main", model: changesModel([file("a.ts", 1, 0)]) }], {
		theme: plainTheme, rows: 8,
		loadDiff: async (actualRoot) => { routed.push(actualRoot); return "+safe"; },
		onOpen: (actualRoot) => { routed.push(actualRoot); },
		onClose() {}, onRefresh() {}, requestRender() {},
	});
	const assertSafe = (lines: string[]) => {
		for (const line of lines) {
			assert.doesNotMatch(line, /[\x00-\x1f\x7f-\x9f]/);
			assert.ok(visibleWidth(line) <= 100);
		}
		assert.match(lines.join("\n"), /main · repo line columnred/);
		assert.doesNotMatch(lines.join("\n"), /injected title/);
	};
	assertSafe(component.render(100));
	component.handleInput("\r");
	component.handleInput("j");
	await settle();
	assertSafe(component.render(100));
	component.handleInput("o");
	assert.deepEqual(routed, [root, root], "display sanitization must not alter raw root identity");
});

test("accordion refresh preserves expanded roots and selected file; left returns to parent then collapses", async () => {
	const trees = ["/parent/one", "/parent/two"].map((root) => ({ root, branch: "main", model: changesModel([file("a.ts", 1, 0), file("b.ts", 1, 0)]) }));
	const opened: string[] = [];
	const component = new WorktreeChangesView(trees, {
		theme: plainTheme, rows: 12, loadDiff: async () => "+preview",
		onOpen: (root, target) => { opened.push(`${root}/${target.path}`); },
		onClose() {}, onRefresh() {}, requestRender() {},
	});
	component.handleInput("\x1b[C");
	component.handleInput("j");
	component.handleInput("j");
	component.update([trees[1], trees[0]]);
	component.handleInput("o");
	assert.deepEqual(opened, ["/parent/one/b.ts"]);
	assert.match(component.render(100).join("\n"), /▾ main · one/);
	component.handleInput("\x1b[D");
	assert.match(component.render(100).join("\n"), /▸ ▾ main · one/);
	component.handleInput("\x1b[D");
	assert.doesNotMatch(component.render(100).join("\n"), /b.ts/);
	component.handleInput("\r");
	component.handleInput("j");
	component.update([{ ...trees[0], model: changesModel([file("b.ts", 1, 0)]) }]);
	assert.match(component.render(100).join("\n"), /▸ ▾ main · one/, "removed file falls back to its parent header");
	component.handleInput("o");
	assert.equal(opened.length, 1, "header must not open a file");
	component.update([]);
	await settle();
	assert.match(component.render(100).join("\n"), /No dirty worktrees/);
});

test("accordion selection scrolls flattened rows and diff scrolling does not open the editor", async () => {
	let opened = 0;
	const component = new WorktreeChangesView([{ root: "/long/root", branch: "main", model: changesModel(Array.from({ length: 20 }, (_, index) => file(`file-${String(index).padStart(2, "0")}.ts`, 1, 0))) }], {
		theme: plainTheme, rows: 8,
		loadDiff: async () => Array.from({ length: 30 }, (_, index) => `+line ${index}`).join("\n"),
		onOpen() { opened++; }, onClose() {}, onRefresh() {}, requestRender() {},
	});
	component.handleInput(" ");
	for (let index = 0; index < 20; index++) component.handleInput("j");
	await settle();
	assert.match(component.render(100).join("\n"), /▸   M file-19.ts/);
	component.handleInput("\x0a");
	assert.match(component.render(100)[1], /\+line 5/);
	component.handleInput("\x0b");
	assert.match(component.render(100)[1], /\+line 0/);
	assert.equal(opened, 0);
	for (const width of [1, 8, 20, 40, 100]) {
		for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
	}
});

const statusCases = [
	[CHANGE_STATUS.MODIFIED, "M", 2, 1],
	[CHANGE_STATUS.ADDED, "A", 3, 0],
	[CHANGE_STATUS.DELETED, "D", 0, 4],
	[CHANGE_STATUS.RENAMED, "R", 0, 0],
	[CHANGE_STATUS.UNTRACKED, "??", 5, 0],
] as const;

for (const [status, code, added, deleted] of statusCases) {
	test(`both file lists render ${status} with colored signed counts`, () => {
		const theme = {
			fg(role: string, text: string) {
				const color = role === "success" ? 32 : role === "error" ? 31 : 36;
				return `\x1b[${color}m${text}\x1b[39m`;
			},
		};
		const target = file("a.ts", added, deleted, status);
		const accordion = new WorktreeChangesView([{ root: "/main", branch: "main", model: changesModel([target]) }], {
			theme, rows: 10, loadDiff: async () => "", onOpen() {}, onClose() {}, onRefresh() {}, requestRender() {},
		});
		accordion.handleInput("\r");
		const standalone = view({ theme }, [target]).view;
		for (const selected of [false, true]) {
			if (selected) accordion.handleInput("j");
			for (const [component, row] of [[accordion, 2], [standalone, 1]] as const) {
				const line = component.render(100)[row];
				assert.ok(stripAnsi(line).includes(`${code} a.ts  +${added} -${deleted}`));
				assert.ok(line.includes(`\x1b[32m+${added}\x1b[39m`), "addition uses success color");
				assert.ok(line.includes(`\x1b[31m-${deleted}\x1b[39m`), "deletion uses error color");
				for (const width of [8, 20, 40, 100]) {
					for (const rendered of component.render(width)) assert.ok(visibleWidth(rendered) <= width);
				}
			}
		}
	});
}

test("colorDiff drops git headers and colors hunks, additions, and removals by role", () => {
	const lines = colorDiff(DIFF_A, taggedTheme);
	assert.deepEqual(lines, [
		"<customMessageLabel>@@ -1,2 +1,3 @@</customMessageLabel>",
		"<toolDiffContext> const a = 1;</toolDiffContext>",
		"<toolDiffRemoved>-const b = 2;</toolDiffRemoved>",
		"<toolDiffAdded>+const b = 3;</toolDiffAdded>",
		"<toolDiffAdded>+const c = 4;</toolDiffAdded>",
	]);
});

test("ChangesView renders a framed two-pane layout at the requested size", async () => {
	const { view: component } = view();
	await settle();
	const lines = component.render(80);
	assert.equal(lines.length, 12);
	for (const line of lines) assert.equal(visibleWidth(line), 80, `"${stripAnsi(line)}" is not 80 wide`);
	const plain = lines.map(stripAnsi);
	assert.match(plain[0], /^╭─ ✎ Changes · 2 files · \+12 −1 ─+╮$/);
	assert.match(plain[1], /^│ ▸ M lib\/a\.ts +\+2 -1 +│ @@ -1,2 \+1,3 @@ +│$/);
	assert.match(plain[2], /^│   A lib\/b\.ts +\+10 -0 +│  const a = 1; +│$/);
	assert.match(plain[11], /^╰─+╯$/);
	assert.match(plain[10], /j\/k file .* o open in editor .* esc close/);
});

test("ChangesView loads the selected diff lazily and moves with j/k and arrows", async () => {
	const { view: component, calls, events } = view();
	await settle();
	assert.deepEqual(calls, ["lib/a.ts"]);
	component.handleInput("j");
	await settle();
	assert.deepEqual(calls, ["lib/a.ts", "lib/b.ts"]);
	assert.match(stripAnsi(component.render(80)[2]), /^│ ▸ A lib\/b\.ts/);
	component.handleInput("\x1b[A");
	assert.match(stripAnsi(component.render(80)[1]), /^│ ▸ M lib\/a\.ts/);
	component.handleInput("k");
	assert.match(stripAnsi(component.render(80)[1]), /^│ ▸ M lib\/a\.ts/);
	assert.ok(events.filter((event) => event === "render").length >= 2);
});

test("ChangesView scrolls the diff pane and shows an empty state for files without a diff", async () => {
	const long = Array.from({ length: 40 }, (_, index) => `+line ${index}`).join("\n");
	const { view: component } = view({ async loadDiff() { return `@@ -0,0 +1,40 @@\n${long}`; } });
	await settle();
	component.handleInput("\x1b[6~");
	const plain = component.render(80).map(stripAnsi);
	assert.doesNotMatch(plain[1], /@@/);
	assert.match(plain[1], /\+line \d+/);
	component.handleInput("\x0b");
	assert.match(stripAnsi(component.render(80)[1]), /@@/, "ctrl+k scrolls back to the top");
	component.handleInput("\x0a");
	assert.doesNotMatch(stripAnsi(component.render(80)[1]), /@@/, "ctrl+j scrolls a page down");

	const empty = view({ async loadDiff() { return ""; } });
	await settle();
	assert.match(stripAnsi(empty.view.render(80)[1]), /no diff for this file/);
});

test("ChangesView opens the selected file and closes on escape or q", async () => {
	const { view: component, events } = view();
	await settle();
	component.handleInput("o");
	assert.ok(events.includes("open:lib/a.ts"));
	component.handleInput("\x1b");
	component.handleInput("q");
	assert.equal(events.filter((event) => event === "close").length, 2);
});

test("ChangesView.update keeps the selected file, reloads moved diffs, and survives an empty tree", async () => {
	const { view: component, calls } = view();
	await settle();
	component.handleInput("j");
	await settle();
	assert.deepEqual(calls, ["lib/a.ts", "lib/b.ts"]);

	component.update(changesModel([file("lib/a.ts", 5, 1), file("lib/b.ts", 10, 0, CHANGE_STATUS.ADDED), file("lib/c.ts", 1, 0)]));
	await settle();
	assert.match(stripAnsi(component.render(80)[2]), /^│ ▸ A lib\/b\.ts/);
	assert.deepEqual(calls, ["lib/a.ts", "lib/b.ts"], "unchanged selected file must not reload");
	component.handleInput("k");
	await settle();
	assert.deepEqual(calls, ["lib/a.ts", "lib/b.ts", "lib/a.ts"], "moved counts must reload the diff");

	component.update(changesModel([]));
	const plain = component.render(80).map(stripAnsi);
	assert.match(plain[0], /0 files · \+0 −0/);
	assert.match(plain[1], /working tree is clean/);
	component.handleInput("j");
	component.handleInput("o");
});
