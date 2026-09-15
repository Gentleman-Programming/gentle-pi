import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	formatCost,
	formatTokens,
	gaugeTone,
	renderGauge,
	renderShellBar,
	renderShellSidebarBar,
	shellEnabled,
	type ShellBarModel,
	type ShellBarTheme,
} from "../lib/shell-bar.ts";

// The Gentle Shell bar replaces pi's three-line footer with a responsive
// one-to-three-line layout. Rendering is pure so it can be verified without a TUI.

const taggedTheme: ShellBarTheme = {
	fg(color: string, value: string) {
		return `<${color}>${value}</${color}>`;
	},
	bold(value: string) {
		return value;
	},
};

const plainTheme: ShellBarTheme = {
	fg(_color: string, value: string) {
		return value;
	},
	bold(value: string) {
		return value;
	},
};

function model(overrides: Partial<ShellBarModel> = {}): ShellBarModel {
	return {
		cwd: "~/work/gentle-pi",
		branch: "main",
		dirty: undefined,
		sessionName: undefined,
		modelId: "gpt-5.5",
		effort: "medium",
		contextPercent: 45,
		contextWindow: 272_000,
		costTotal: 9.49,
		subscription: true,
		usage: undefined,
		statuses: [],
		...overrides,
	};
}

test("renderGauge fills cells proportionally to the percentage", () => {
	assert.equal(renderGauge(45, 8), "▰▰▰▰▱▱▱▱");
	assert.equal(renderGauge(0, 8), "▱▱▱▱▱▱▱▱");
	assert.equal(renderGauge(100, 8), "▰▰▰▰▰▰▰▰");
	assert.equal(renderGauge(null, 8), "▱▱▱▱▱▱▱▱");
});

test("gaugeTone turns to warning at 80% and error at 95%", () => {
	assert.equal(gaugeTone(45), "accent");
	assert.equal(gaugeTone(79.9), "accent");
	assert.equal(gaugeTone(80), "warning");
	assert.equal(gaugeTone(95), "error");
	assert.equal(gaugeTone(null), "dim");
});

test("formatTokens and formatCost keep the bar compact", () => {
	assert.equal(formatTokens(950), "950");
	assert.equal(formatTokens(4_200), "4.2k");
	assert.equal(formatTokens(272_000), "272k");
	assert.equal(formatTokens(13_000_000), "13M");
	assert.equal(formatCost(9.49, true), "$9.49 sub");
	assert.equal(formatCost(0.004, false), "$0.004");
});

test("renderShellBar renders one line with the segments in order", () => {
	const [line, ...rest] = renderShellBar(model(), plainTheme, 160);
	assert.equal(rest.length, 0);
	assert.equal(
		line,
		"✿ gentle-pi ⟡ gentle-pi main ⟡ gpt-5.5 · medium ⟡ ctx ▰▰▱▱▱ 45% ⟡ $9.49 sub",
	);
});

test("renderShellBar uses five-cell gauges in its full presentation", () => {
	const usage = {
		provider: "openai-codex",
		plan: "pro",
		fetchedAt: 0,
		limits: [{ name: "codex", limitReached: false, windows: [{ label: "5h", usedPercent: 62, windowSeconds: 18_000, resetAt: null }] }],
	};
	const [line] = renderShellBar(model({ usage }), plainTheme, 200);
	assert.match(line, /ctx ▰▰▱▱▱ 45%/);
	assert.match(line, /codex 5h ▰▰▰▱▱ 62%$/);
});

test("renderShellBar degrades usage before context from five cells to two cells to percentage-only", () => {
	const usage = {
		provider: "openai-codex",
		plan: "pro",
		fetchedAt: 0,
		limits: [{ name: "codex", limitReached: false, windows: [{ label: "5h", usedPercent: 62, windowSeconds: 18_000, resetAt: null }] }],
	};
	const runtime = (width: number) => renderShellBar(model({ usage, statuses: ["MCP ready"] }), plainTheme, width)[1];
	assert.match(runtime(62), /ctx ▰▰▱▱▱ 45% ⟡ \$9\.49 sub ⟡ codex 5h ▰▱ 62%$/);
	assert.match(runtime(59), /ctx ▰▰▱▱▱ 45% ⟡ \$9\.49 sub ⟡ codex 5h 62%$/);
	assert.match(runtime(56), /ctx ▰▱ 45% ⟡ \$9\.49 sub ⟡ codex 5h 62%$/);
});

test("renderShellBar reflows complete content into semantic lines before omitting it", () => {
	const usage = {
		provider: "openai-codex",
		plan: "pro",
		fetchedAt: 0,
		limits: [{ name: "codex", limitReached: false, windows: [{ label: "5h", usedPercent: 62, windowSeconds: 18_000, resetAt: null }] }],
	};
	const intermediate = renderShellBar(model({ sessionName: "Release notes" }), plainTheme, 80);
	assert.equal(intermediate.length, 2);
	assert.match(intermediate[0], /Release notes$/);
	assert.match(intermediate[1], /gpt-5\.5/);

	const withUsage = renderShellBar(model({ usage }), plainTheme, 80);
	assert.equal(withUsage.length, 2);
	assert.match(withUsage[1], /codex 5h/);

	const narrow = renderShellBar(model({ usage, statuses: ["MCP: 3/3", "Engram ready"] }), plainTheme, 55);
	assert.equal(narrow.length, 3);
	assert.doesNotMatch(narrow[2], /codex 5h/);
	assert.match(narrow[2], /MCP: 3\/3|Engram ready|\+\d+ integrations/);
	for (const line of [...intermediate, ...withUsage]) assert.ok(visibleWidth(line) <= 80);
	for (const line of narrow) assert.ok(visibleWidth(line) <= 55);
});

test("renderShellBar colors the brand, model, effort, and gauge by role", () => {
	const [line] = renderShellBar(model(), taggedTheme, 400);
	assert.match(line, /<accent>✿ gentle-pi<\/accent>/);
	assert.match(line, /<text>gpt-5\.5<\/text>/);
	assert.match(line, /<syntaxFunction>medium<\/syntaxFunction>/);
	assert.match(line, /<accent>▰▰<\/accent><border>▱▱▱<\/border>/);
	assert.match(line, /<dim>⟡<\/dim>/);
});

test("renderShellBar shows the branch as dirty-neutral and omits it outside git", () => {
	const [line] = renderShellBar(model({ branch: null }), plainTheme, 160);
	assert.match(line, /⟡ gentle-pi ⟡/);
});

test("renderShellBar shows the session dirty count next to the branch", () => {
	const [line] = renderShellBar(model({ dirty: 3 }), taggedTheme, 400);
	assert.match(line, /<text>main<\/text> <warning>±3<\/warning>/);
	const [clean] = renderShellBar(model({ dirty: 0 }), plainTheme, 160);
	assert.doesNotMatch(clean, /±/);
});

test("renderShellBar adds the subscription windows after the cost when usage is known", () => {
	const usage = {
		provider: "openai-codex",
		plan: "pro",
		fetchedAt: 0,
		limits: [{ name: "codex", limitReached: false, windows: [
			{ label: "5h", usedPercent: 62, windowSeconds: 18_000, resetAt: null },
			{ label: "week", usedPercent: 31, windowSeconds: 604_800, resetAt: null },
		] }],
	};
	const [line] = renderShellBar(model({ usage }), plainTheme, 200);
	assert.match(line, /\$9\.49 sub ⟡ codex 5h ▰▰▰▱▱ 62% · week 31%$/);
});

test("renderShellBar shows an unknown context as a question mark after compaction", () => {
	const [line] = renderShellBar(model({ contextPercent: null }), plainTheme, 160);
	assert.match(line, /ctx ▱▱▱▱▱ \?%/);
});

test("renderShellBar right-aligns the session name when it fits", () => {
	const [line] = renderShellBar(model({ sessionName: "Release notes" }), plainTheme, 120);
	assert.equal(visibleWidth(line), 120);
	assert.match(line, /Release notes$/);
});

test("renderShellBar appends extension statuses as trailing segments", () => {
	const [line] = renderShellBar(model({ statuses: ["🔌 MCP: 3 servers\tenabled"] }), plainTheme, 160);
	assert.match(line, /⟡ 🔌 MCP: 3 servers enabled$/);
});

test("renderShellBar repaints extension statuses in the bar role, discarding colors the extension embedded", () => {
	const tagged = { fg: (color: string, text: string) => `<${color}>${text}</${color}>`, bold: (text: string) => text };
	const [line] = renderShellBar(model({ statuses: ["\x1b[38;2;255;0;0mMCP: 3/3 servers\x1b[0m"] }), tagged, 400);
	assert.match(line, /<muted>MCP: 3\/3 servers<\/muted>$/);
	assert.doesNotMatch(line, /\x1b\[/);
});

test("renderShellBar preserves the project identity before it sacrifices an extension status", () => {
	const long = model({ branch: "fix/shell-bar-status-ansi", dirty: 2, statuses: ["MCP: 3/3 servers"] });
	const [full] = renderShellBar(long, plainTheme, 160);
	assert.match(full, /gentle-pi fix\/shell-bar-status-ansi ±2 .* MCP: 3\/3 servers$/);
	const compact = renderShellBar(long, plainTheme, 90);
	for (const line of compact) assert.ok(visibleWidth(line) <= 90, `line overflowed: ${visibleWidth(line)}`);
	assert.match(compact[0], /✿ gentle-pi ⟡ gentle-pi fix\/shell-bar-status-ansi ±2$/);
	assert.match(compact.join("\n"), /MCP: 3\/3 servers/);
});

test("renderShellBar keeps provider usage on line two and statuses on line three", () => {
	const usage = {
		provider: "openai-codex",
		plan: "pro",
		fetchedAt: 0,
		limits: [{ name: "codex", limitReached: false, windows: [{ label: "week", usedPercent: 4, windowSeconds: 604_800, resetAt: null }] }],
	};
	const lines = renderShellBar(model({ usage, statuses: ["MCP: 3 servers enabled", "Engram ready"] }), plainTheme, 80);
	assert.equal(lines.length, 3);
	assert.match(lines[1], /\$9\.49 sub ⟡ codex week/);
	assert.match(lines[2], /MCP: 3 servers enabled|Engram ready|\+\d+ (more|integrations)/);
	assert.doesNotMatch(lines[2], /codex week/);
});

test("renderShellBar compacts runtime details before omitting provider usage", () => {
	const usage = {
		provider: "openai-codex",
		plan: "pro",
		fetchedAt: 0,
		limits: [{ name: "codex", limitReached: false, windows: [{ label: "week", usedPercent: 4, windowSeconds: 604_800, resetAt: null }] }],
	};
	const lines = renderShellBar(model({ usage, statuses: ["MCP: 3 servers enabled"] }), plainTheme, 55);
	assert.equal(lines.length, 3);
	assert.match(lines[1], /codex week/);
	assert.match(lines[2], /MCP: 3 servers enabled/);
});

test("renderShellBar keeps the session on the project line and reports narrow status omissions", () => {
	const wide = model({ sessionName: "Release notes", statuses: ["MCP: 3 servers enabled", "Engram ready"] });
	const atNinety = renderShellBar(wide, plainTheme, 90);
	assert.equal(atNinety.length, 3);
	assert.match(atNinety[0], /Release notes$/);
	assert.match(atNinety[1], /gpt-5\.5/);
	assert.match(atNinety[2], /MCP: 3 servers enabled|\+1 integrations/);

	const atFifty = renderShellBar(wide, plainTheme, 50);
	assert.equal(atFifty.length, 3);
	for (const line of atFifty) assert.ok(visibleWidth(line) <= 50, `line overflowed: ${visibleWidth(line)}`);
	assert.match(atFifty[0], /^✿ gentle-pi/);
});

test("renderShellBar characterizes the installed terminal-width oracle for representative graphemes", () => {
	const expectedWidths = new Map([
		["🧠", 2],
		["🔌", 2],
		["🐴", 2],
		["👩🏽‍💻", 2],
		["👨‍👩‍👧‍👦", 2],
		["❤️", 2],
		["©️", 2],
		["🇺🇸", 2],
		["界", 2],
		["é", 1],
	]);
	for (const [text, width] of expectedWidths) assert.equal(visibleWidth(text), width, `${text} should be ${width} cells`);
});

test("renderShellBar characterizes literal emoji and CJK status boundaries", () => {
	const candidates = [
		{ text: "🧠X", width: 3, limits: [2, 3, 4] },
		{ text: "👩🏽‍💻X", width: 3, limits: [2, 3, 4] },
		{ text: "設計X", width: 5, limits: [4, 5, 6] },
	];
	for (const { text, width, limits } of candidates) {
		assert.equal(visibleWidth(text), width);
		for (const limit of limits) {
			const lines = renderShellBar(model({ statuses: [text] }), plainTheme, limit);
			assert.ok(lines.every((line) => visibleWidth(line) <= limit), `${text} overflowed ${limit}`);
			assert.equal(Boolean(lines[2]?.includes(text)), limit >= width, `${text} fit decision at ${limit}`);
		}
	}
});

test("renderShellBar keeps emoji-heavy statuses or their omission count at baseline widths", () => {
	const statuses = ["🧠 runtime ready", "🔌 MCP connected", "🐴 FFF indexed"];
	const ansiTheme: ShellBarTheme = {
		fg: (_color, text) => `\x1b[38;5;141m${text}\x1b[0m`,
		bold: (text) => text,
	};
	for (const [themeName, theme] of [["plain", plainTheme], ["ANSI", ansiTheme]] as const) {
		for (const width of [220, 160, 120, 100, 80]) {
			const lines = renderShellBar(model({ statuses }), theme, width);
			assert.ok(lines.every((line) => visibleWidth(line) <= width), `${themeName} overflowed ${width}`);
			const visible = statuses.filter((status) => lines.some((line) => line.includes(status))).length;
			const indicator = lines.join("\n").match(/\+(\d+) (more|integrations)/);
			const omitted = indicator ? Number(indicator[1]) : 0;
			assert.equal(visible + omitted, statuses.length, `${themeName} status accounting at ${width}`);
		}
	}
});

test("renderShellBar counts only sanitized statuses when reporting omissions", () => {
	const lines = renderShellBar(model({
		branch: "feature/設計-👩🏽‍💻-👨‍👩‍👧‍👦-❤️-©️-🇺🇸-é",
		statuses: ["\x1b[32m🧠 ready\x1b[0m", "\n\t", "🔌 connected", "🐴 indexed"],
	}), plainTheme, 16);
	assert.ok(lines.every((line) => visibleWidth(line) <= 16));
	assert.match(lines[2], /\+3 integrations/);
	assert.doesNotMatch(lines[2], /\+4 integrations/);
});

test("renderShellBar keeps ANSI, Unicode, and long sanitized statuses within three lines", () => {
	const ansiTheme: ShellBarTheme = {
		fg: (_color, text) => `\x1b[31m${text}\x1b[0m`,
		bold: (text) => text,
	};
	const lines = renderShellBar(model({
		cwd: "/workspace/設計/very-long-project-name",
		branch: "feature/非常に長いブランチ名",
		modelId: "gpt\n5.5",
		sessionName: "🚀 release notes",
		statuses: ["\x1b[32mMCP:\t3/3\x1b[0m", "Engram\nready", "A status that is deliberately very long"],
	}), ansiTheme, 42);
	assert.equal(lines.length, 3);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 42, `line overflowed: ${visibleWidth(line)}`);
		assert.doesNotMatch(line, /\t|\n/);
	}
	// The compact project identity fills this width, so the session is omitted;
	// where there is remaining space, projectLine clips it before omission.
	assert.doesNotMatch(lines[0], /release|🚀/);
	assert.match(lines[1], /gpt 5\.5/);
	assert.match(lines[2], /\+\d+ (more|integrations)|MCP: 3\/3/);
});

const providerUsage = {
	provider: "openai-codex",
	plan: "pro",
	fetchedAt: 0,
	limits: [{ name: "codex", limitReached: false, windows: [{ label: "week", usedPercent: 4, windowSeconds: 604_800, resetAt: null }] }],
};

function assertBoundedNonEmptyLines(lines: string[], width: number): void {
	assert.ok(lines.length >= 1 && lines.length <= 3);
	for (const line of lines) {
		assert.notEqual(line, "");
		assert.ok(visibleWidth(line) <= width, `line overflowed ${width}: ${line}`);
	}
}

test("renderShellBar declares omitted runtime without inflating integration counts at 42 columns", () => {
	const statuses = ["🧠 tmp ready", "🔌 MCP connected", "🐴 FFF indexed", "Engram ready", "Review clean"];
	const lines = renderShellBar(model({ usage: providerUsage, statuses }), plainTheme, 42);
	assertBoundedNonEmptyLines(lines, 42);
	const output = lines.join("\n");
	assert.match(output, /codex week|r!/);
	assert.match(output, /\$9\.49 sub|r!/);
	const visible = statuses.filter((status) => output.includes(status)).length;
	const indicator = output.match(/\+(\d+) (more|integrations)/);
	assert.equal(visible + Number(indicator?.[1] ?? 0), statuses.length);
});

test("renderShellBar declares omitted cost at narrower widths", () => {
	const lines = renderShellBar(model({ usage: providerUsage, statuses: ["MCP ready"] }), plainTheme, 20);
	assertBoundedNonEmptyLines(lines, 20);
	assert.match(lines.join("\n"), /\$9\.49 sub|r!/);
});

test("renderShellBar does not return an empty third row when usage cannot fit without statuses", () => {
	const lines = renderShellBar(model({ usage: providerUsage }), plainTheme, 30);
	assertBoundedNonEmptyLines(lines, 30);
	assert.match(lines.join("\n"), /codex week|r!/);
});

test("renderShellBar treats sanitized-empty statuses as absent", () => {
	const lines = renderShellBar(model({ usage: providerUsage, statuses: ["\n\t", "\x1b[31m\x1b[0m"] }), plainTheme, 30);
	assertBoundedNonEmptyLines(lines, 30);
	assert.match(lines.join("\n"), /codex week|r!/);
});

test("renderShellBar maps width-five omission markers to their semantic classes", () => {
	const cases = [
		["statuses only", model({ statuses: ["MCP ready"] }), ["i!"]],
		["usage only", model({ usage: providerUsage }), ["r!"]],
		["usage and statuses", model({ usage: providerUsage, statuses: ["MCP ready"] }), ["r! i!"]],
		["neither", model(), ["!"]],
	] as const;
	for (const [name, input, expected] of cases) {
		assert.deepEqual(renderShellBar(input, plainTheme, 5), expected, name);
	}
	const constrained = model({ usage: providerUsage, statuses: ["MCP ready"] });
	assert.match(renderShellBar(constrained, plainTheme, 6).join("\n"), /r! i!/);
	for (const width of [1, 2, 3, 4]) assertBoundedNonEmptyLines(renderShellBar(constrained, plainTheme, width), width);
	for (const line of renderShellBar(constrained, plainTheme, 0)) assert.ok(visibleWidth(line) <= 0);
});

test("renderShellBar does not emit i! below five columns without effective integrations", () => {
	const noIntegrations = model({ usage: providerUsage, statuses: ["\n\t", "\x1b[31m\x1b[0m"] });
	for (const width of [1, 2, 3, 4]) {
		const lines = renderShellBar(noIntegrations, plainTheme, width);
		assertBoundedNonEmptyLines(lines, width);
		assert.doesNotMatch(lines.join("\n"), /i!/);
	}
});

test("renderShellBar triangulates runtime and integration omissions across costs and decreasing widths", () => {
	for (const subscription of [true, false]) {
		for (const usage of [undefined, providerUsage]) {
			for (const statuses of [[], ["MCP ready"], ["\n\t", "MCP ready", "Engram ready"]]) {
				for (const width of [80, 42, 20, 6, 5, 4, 3, 2, 1]) {
					const lines = renderShellBar(model({ subscription, usage, statuses }), plainTheme, width);
					assertBoundedNonEmptyLines(lines, width);
					if (width >= 5 && usage && statuses.filter((status) => status.trim()).length) {
						assert.match(lines.join("\n"), /codex week|r!/);
					}
				}
			}
		}
	}
});

test("renderShellBar clips compact branches on grapheme boundaries", () => {
	const branch = "\x1b[35m123456789012👩🏽‍❤️‍💋‍👩é界\x1b[0m";
	const ansiTheme: ShellBarTheme = {
		fg: (_color, text) => `\x1b[38;5;141m${text}\x1b[0m`,
		bold: (text) => text,
	};
	for (const [themeName, theme] of [["plain", plainTheme], ["ANSI", ansiTheme]] as const) {
		const lines = renderShellBar(model({ branch }), theme, 39);
		const first = lines[0].replace(/\x1b\[[0-9;]*m/g, "");
		assert.equal(first, "✿ gentle-pi ⟡ gentle-pi 123456789012…", `${themeName} compact branch`);
		assert.ok(visibleWidth(lines[0]) <= 39, `${themeName} compact branch overflowed`);
		assert.doesNotMatch(first, /\u200d|\u{fe0f}|[\u{1f3fb}-\u{1f3ff}]|\p{M}/u, `${themeName} left incomplete grapheme control`);
		assert.doesNotMatch(lines.join(""), /\x1b\[35m/, `${themeName} preserved source branch ANSI`);
	}

	assert.deepEqual(renderShellBar(model({ branch }), plainTheme, 0), []);
	for (const width of [1, 2]) {
		const lines = renderShellBar(model({ branch }), plainTheme, width);
		assert.ok(lines.every((line) => visibleWidth(line) <= width), `boundary width ${width} overflowed`);
		assert.doesNotMatch(lines.join(""), /\u200d|\u{fe0f}|[\u{1f3fb}-\u{1f3ff}]|\p{M}/u, `boundary width ${width} retained grapheme control`);
	}
});

test("shellEnabled stays off inside a Gentle Agents child", () => {
	assert.equal(shellEnabled({ GENTLE_PI_AGENTS_CHILD: "1" }), false);
});

test("shellEnabled honors GENTLE_PI_SHELL=0", () => {
	assert.equal(shellEnabled({}), true);
	assert.equal(shellEnabled({ GENTLE_PI_SHELL: "1" }), true);
	assert.equal(shellEnabled({ GENTLE_PI_SHELL: "0" }), false);
	assert.equal(shellEnabled({ GENTLE_PI_SHELL: "false" }), false);
});

test("sidebar profile wraps long names without changing the compact bar", () => {
	const profile = "team-" + "x".repeat(59);
	const base = model();
	const active = model({ profile });
	for (const width of [24, 46]) {
		const lines = renderShellSidebarBar(active, plainTheme, width);
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
		assert.match(lines.join("\n"), /Profile/);
		assert.ok(lines.join("").replace(/[│\s]/g, "").includes(profile));
	}
	assert.deepEqual(renderShellBar(active, plainTheme, 120), renderShellBar(base, plainTheme, 120));
});
