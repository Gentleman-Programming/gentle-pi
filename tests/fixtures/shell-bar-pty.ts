#!/usr/bin/env node

import { visibleWidth } from "@earendil-works/pi-tui";
import { renderShellBar, type ShellBarModel, type ShellBarTheme } from "../../lib/shell-bar.ts";

const USAGE = `Usage: node --experimental-strip-types tests/fixtures/shell-bar-pty.ts [--width <columns>] [--theme <plain|ansi>] [--diagnostic]`;
const THEMES = new Set(["plain", "ansi"]);

function fail(message: string): never {
	console.error(`Error: ${message}`);
	console.error(USAGE);
	process.exit(1);
}

function parseWidth(value: string): number {
	if (!/^\d+$/.test(value)) fail(`width must be a positive integer, received ${JSON.stringify(value)}`);
	const width = Number(value);
	if (!Number.isSafeInteger(width) || width < 1) fail(`width must be a positive integer, received ${JSON.stringify(value)}`);
	return width;
}

function parseArguments(args: string[]): { width: number; theme: string; diagnostic: boolean } {
	let width: number | undefined;
	let theme: string | undefined;
	let diagnostic = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--help" || argument === "-h") {
			console.log(USAGE);
			process.exit(0);
		}
		if (argument === "--diagnostic") {
			diagnostic = true;
			continue;
		}
		if (argument === "--width") {
			if (width !== undefined) fail("--width may be supplied only once");
			const value = args[++index];
			if (value === undefined) fail("--width requires a positive integer");
			width = parseWidth(value);
			continue;
		}
		if (argument === "--theme") {
			if (theme !== undefined) fail("--theme may be supplied only once");
			const value = args[++index];
			if (value === undefined) fail("--theme requires plain or ansi");
			theme = value;
			continue;
		}
		fail(`unknown argument ${JSON.stringify(argument)}`);
	}
	const selectedTheme = theme ?? process.env.SHELL_BAR_PTY_THEME ?? "plain";
	if (!THEMES.has(selectedTheme)) fail(`theme must be plain or ansi, received ${JSON.stringify(selectedTheme)}`);
	return { width: width ?? process.stdout.columns ?? 80, theme: selectedTheme, diagnostic };
}

const plainTheme: ShellBarTheme = {
	fg(_color, text) {
		return text;
	},
	bold(text) {
		return text;
	},
};

const ansiTheme: ShellBarTheme = {
	fg(color, text) {
		const code = { accent: 141, dim: 244, muted: 110, text: 255, warning: 220, syntaxFunction: 81, border: 60, error: 203 }[color] ?? 255;
		return `\x1b[38;5;${code}m${text}\x1b[0m`;
	},
	bold(text) {
		return `\x1b[1m${text}\x1b[22m`;
	},
};

const fixture: ShellBarModel = {
	cwd: "/workspace/gentle-pi",
	branch: "fix/715-footer",
	dirty: 7,
	sessionName: "#715",
	modelId: "gpt-5.5-codex",
	effort: "high",
	contextPercent: 84,
	contextWindow: 272_000,
	costTotal: 12.345,
	subscription: true,
	usage: {
		provider: "openai-codex",
		plan: "pro",
		fetchedAt: 0,
		limits: [{
			name: "codex",
			limitReached: false,
			windows: [
				{ label: "5h", usedPercent: 73, windowSeconds: 18_000, resetAt: null },
				{ label: "week", usedPercent: 41, windowSeconds: 604_800, resetAt: null },
			],
		}],
	},
	statuses: [
		"🧠 Engram: 128 memories indexed",
		"🧠 Memory: session recall ready",
		"🐴 FFF: fixture fleet ready",
		"🔌 MCP: 4 servers connected",
		"🧩 LSP: TypeScript diagnostics ready",
		"🎀 Ponytail: status synced",
	],
};

const { width, theme, diagnostic } = parseArguments(process.argv.slice(2));
const lines = renderShellBar(fixture, theme === "ansi" ? ansiTheme : plainTheme, width);

if (diagnostic) {
	for (const [index, line] of lines.entries()) console.error(`line ${index + 1}: ${visibleWidth(line)}/${width}`);
}
process.stdout.write(`${lines.join("\n")}\n`);
