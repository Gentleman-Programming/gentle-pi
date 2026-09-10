import assert from "node:assert/strict";
import test from "node:test";
import { ScrollView, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { installSidebar } from "../lib/shell-sidebar-layout.ts";
import { sidebarPart, sidebarState } from "../lib/shell-sidebar.ts";
import { renderShellSidebarBar } from "../lib/shell-bar.ts";
import { renderTodoCard, type TodoState } from "../lib/shell-todo.ts";

const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
function fixture(mode = "fullscreen", columns = 140) {
	const original = () => ({ type: "vstack", entries: [] });
	const root = { render: () => ["transcript"], invalidate() {}, [NODE]: original };
	let renders = 0;
	const host = { mode, terminal: { columns }, layoutRoot: root, requestRender() { renders++; } };
	const tui = host as unknown as TUI;
	const bottom = sidebarPart(tui, "footer", { render: (_width: number) => ["Status"], invalidate() {} });
	return { host, tui, root, original, bottom, renders: () => renders };
}
function rail(f: ReturnType<typeof fixture>): ScrollView {
	const node = f.root[NODE]() as unknown as { type: string; entries: { component: ScrollView }[] };
	assert.equal(node.type, "hstack");
	return node.entries[1].component;
}

test("grouped Status preserves structured fields and opaque integration text", () => {
	const lines = renderShellSidebarBar({
		cwd: "/project", branch: "main", dirty: 2, sessionName: "session",
		modelId: "model", effort: "high", contextPercent: 45, contextWindow: 1000,
		costTotal: 1, subscription: false, statuses: ["opaque integration"],
	}, theme, 46);
	const text = lines.join("\n");
	let previous = -1;
	for (const heading of ["Status", "Project", "Model", "Context", "Usage", "Integrations"]) {
		const index = text.indexOf(heading);
		assert.ok(index > previous, heading);
		previous = index;
	}
	assert.match(text, /opaque integration/);
	assert.match(text, /Branch.*main/);
});

test("scrollable TODO keeps every task while bottom and collapsed cards stay bounded", () => {
	const state: TodoState = { tasks: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Task-${i + 1}!`, status: "pending" })), nextId: 21, updatedTurn: 0 };
	const todoTheme = { ...theme, strikethrough: (text: string) => text };
	const render = (scrollable: boolean, collapsed = false) => renderTodoCard(state, todoTheme, 46, { scrollable, collapsed, staleTurns: 0 }).join("\n");
	for (const task of state.tasks) assert.ok(render(true).includes(task.title));
	assert.ok(!render(false).includes("Task-20!"));
	assert.ok(!render(true, true).includes("Task-20!"));
});

test("installation on a missing-terminal host is a harmless no-op", () => {
	const dispose = installSidebar({} as TUI, theme);
	assert.doesNotThrow(dispose);
});

test("only fullscreen at 140 columns activates; shrinking restores bottom paint", (t) => {
	for (const [mode, width, active] of [["regular", 140, false], ["fullscreen", 139, false], ["fullscreen", 140, true]] as const) {
		const f = fixture(mode, width);
		t.after(installSidebar(f.tui, theme));
		assert.equal(f.root[NODE]().type, active ? "hstack" : "vstack");
		assert.deepEqual(f.bottom.render(80), active ? [] : ["Status"]);
		f.host.terminal.columns = 139;
		assert.equal(f.root[NODE]().type, "vstack");
		assert.deepEqual(f.bottom.render(80), ["Status"]);
	}
});

test("rail orders Status, changes, agents, TODO independent of registration order", (t) => {
	const f = fixture();
	for (const key of ["todo", "agents", "changes"]) {
		sidebarPart(f.tui, key, { render: () => [key, ""], invalidate() {} });
	}
	t.after(installSidebar(f.tui, theme));
	assert.deepEqual(rail(f).render(50).map((line) => line.trim()), ["✿ Gentle-Pi ✿", "", "Status", "", "changes", "", "agents", "", "todo"]);
});

test("branding belongs to scroll content before Status, never transcript or narrow bottom", (t) => {
	const f = fixture();
	t.after(installSidebar(f.tui, theme));
	const scroll = rail(f);
	const lines = scroll.render(50);
	const brandIndex = lines.findIndex((line) => line.includes("✿ Gentle-Pi ✿"));
	assert.ok(brandIndex >= 0 && brandIndex < lines.findIndex((line) => line.includes("Status")));
	assert.doesNotMatch(lines.join("\n"), /[\u2800-\u28ff]/);
	const heading = lines[brandIndex];
	const usableWidth = scroll.getContentWidth(50) - 2;
	const spare = usableWidth - visibleWidth("✿ Gentle-Pi ✿");
	const scrollbarWidth = 50 - scroll.getContentWidth(50);
	assert.equal(heading, " ".repeat(1 + Math.floor(spare / 2)) + "✿ Gentle-Pi ✿" + " ".repeat(1 + Math.ceil(spare / 2) + scrollbarWidth));
	assert.deepEqual(f.root.render(), ["transcript"]);
	scroll.updateLayout(lines.length, 2, () => {});
	scroll.scrollBy(9);
	assert.ok(scroll.scrollTop > 0);
	f.host.terminal.columns = 80;
	assert.equal(f.root[NODE]().type, "vstack");
	assert.deepEqual(f.bottom.render(80), ["Status"]);
});

test("wheel scrolls the rail and is consumed at both boundaries and blank space", (t) => {
	const f = fixture();
	t.after(installSidebar(f.tui, theme));
	const scroll = rail(f);
	scroll.updateLayout(20, 5, () => {});
	for (const [delta, expected] of [[-1, 0], [3, 3], [100, 15], [1, 15], [-100, 0]]) {
		const result = scroll.handleMouse({ type: "wheel", wheelDelta: delta, x: 3, y: 4, screenX: 93, screenY: 6, width: 50, height: 5 } as Parameters<typeof scroll.handleMouse>[0]);
		assert.equal(result?.handled, true);
		assert.equal(scroll.scrollTop, expected);
		assert.equal(result?.target?.component, scroll);
	}
	f.host.terminal.columns = 139;
	assert.equal(f.root[NODE]().type, "vstack");
	assert.deepEqual(f.bottom.render(80), ["Status"]);
	f.host.terminal.columns = 160;
	const restored = rail(f);
	assert.deepEqual(f.bottom.render(80), []);
	const layout = f.root[NODE]() as unknown as { gap: number; entries: { basis: number; grow: number; shrink: number; minSize: number }[] };
	assert.equal(layout.gap, 3);
	assert.deepEqual(layout.entries.map(({ basis, grow, shrink, minSize }) => ({ basis, grow, shrink, minSize })), [
		{ basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ basis: 50, grow: 0, shrink: 0, minSize: 50 },
	]);
	const restoredLines = restored.render(50);
	// Native ScrollView.render only appends the scrollbar gutter; short rows need not fill the layout allocation.
	for (const line of restoredLines) assert.ok(visibleWidth(line) <= 50);
	assert.ok(restoredLines.some((line) => line.startsWith(" Status ")));
	assert.deepEqual(f.root.render(), ["transcript"]);
	restored.updateLayout(20, 5, () => {});
	const before = restored.scrollTop;
	const result = restored.handleMouse({ type: "wheel", wheelDelta: 2, x: 3, y: 4, screenX: 113, screenY: 6, width: 50, height: 5 } as Parameters<typeof restored.handleMouse>[0]);
	assert.equal(result?.handled, true);
	assert.equal(result?.target?.component, restored);
	assert.equal(restored.scrollTop, Math.min(15, before + 2));
	for (const line of restored.render(50)) assert.ok(visibleWidth(line) <= 50);
	assert.deepEqual(f.root.render(), ["transcript"]);
	scroll.updateLayout(1, 5, () => {});
	assert.equal(scroll.handleMouse({ type: "wheel", wheelDelta: 1 } as Parameters<typeof scroll.handleMouse>[0])?.handled, true);
	assert.equal(scroll.scrollTop, 0);
});

test("real layout frames reuse unchanged sidebar output and invalidate at state and breakpoint boundaries", (t) => {
	const f = fixture();
	const counts = { footer: 0, changes: 0, agents: 0, todo: 0 };
	let todo = "Todo one";
	for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
		sidebarPart(f.tui, key, {
			render: () => {
				counts[key]++;
				return [`${key === "todo" ? todo : key}`];
			},
			invalidate() {},
		});
	}
	t.after(installSidebar(f.tui, theme));

	const first = renderLayoutFrame(f.root, 140, 20, () => {});
	assert.deepEqual(counts, { footer: 1, changes: 1, agents: 1, todo: 1 });
	const sidebarRail = first.root.children[1]?.component as ScrollView;
	renderLayoutFrame(f.root, 140, 20, () => {});
	assert.deepEqual(counts, { footer: 1, changes: 1, agents: 1, todo: 1 });

	todo = "Todo two";
	sidebarRail.invalidate();
	const changed = renderLayoutFrame(f.root, 140, 20, () => {});
	assert.match(changed.lines.join("\n"), /Todo two/);
	assert.deepEqual(counts, { footer: 2, changes: 2, agents: 2, todo: 2 });

	f.host.terminal.columns = 139;
	renderLayoutFrame(f.root, 139, 20, () => {});
	assert.deepEqual(f.bottom.render(80), ["Status"]);
	f.host.terminal.columns = 140;
	renderLayoutFrame(f.root, 140, 20, () => {});
	assert.deepEqual(counts, { footer: 3, changes: 3, agents: 3, todo: 3 });

	f.host.mode = "regular";
	renderLayoutFrame(f.root, 140, 20, () => {});
	assert.deepEqual(f.bottom.render(80), ["Status"]);
	f.host.mode = "fullscreen";
	renderLayoutFrame(f.root, 140, 20, () => {});
	assert.deepEqual(counts, { footer: 4, changes: 4, agents: 4, todo: 4 });

	let replacementRenders = 0;
	sidebarPart(f.tui, "todo", {
		render: () => {
			replacementRenders++;
			return ["Todo replacement"];
		},
		invalidate() {},
	});
	const replaced = renderLayoutFrame(f.root, 140, 20, () => {});
	assert.match(replaced.lines.join("\n"), /Todo replacement/);
	assert.equal(replacementRenders, 1);
});

test("cleanup restores the native layout and bottom paint without disposing widgets", () => {
	const f = fixture();
	const dispose = installSidebar(f.tui, theme);
	rail(f);
	dispose();
	assert.equal(f.root[NODE], f.original);
	assert.deepEqual(f.bottom.render(80), ["Status"]);
	assert.equal(sidebarState(f.tui).parts.size, 1);
	assert.ok(f.renders() >= 2);
});

test("unsupported roots, empty rails and overflowing parts leave native layout intact", (t) => {
	for (const lines of [[], ["x".repeat(100)]]) {
		const f = fixture();
		sidebarPart(f.tui, "footer", { render: () => lines, invalidate() {} });
		t.after(installSidebar(f.tui, theme));
		assert.equal(f.root[NODE]().type, "vstack");
		assert.equal(sidebarState(f.tui).active, false);
	}
	const f = fixture();
	Reflect.deleteProperty(f.root, NODE);
	t.after(installSidebar(f.tui, theme));
	assert.deepEqual(f.bottom.render(80), ["Status"]);
});
