import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CHANGE_STATUS, changesModel, type ChangedFile } from "../lib/shell-changes.ts";
import { ChangesView, colorDiff, type ChangesViewDeps } from "../lib/shell-changes-view.ts";
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
	assert.match(plain[1], /^│ ▸ lib\/a\.ts +\+2 −1 +│ @@ -1,2 \+1,3 @@ +│$/);
	assert.match(plain[2], /^│   lib\/b\.ts +\+10 new +│  const a = 1; +│$/);
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
	assert.match(stripAnsi(component.render(80)[2]), /^│ ▸ lib\/b\.ts/);
	component.handleInput("\x1b[A");
	assert.match(stripAnsi(component.render(80)[1]), /^│ ▸ lib\/a\.ts/);
	component.handleInput("k");
	assert.match(stripAnsi(component.render(80)[1]), /^│ ▸ lib\/a\.ts/);
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
