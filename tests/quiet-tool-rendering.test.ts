import assert from "node:assert/strict";
import test from "node:test";
import piPretty from "../extensions/pi-pretty.ts";
import quietTools, {
	countNonEmptyLines,
	extractTextContent,
	formatToolResultOutput,
	tailLines,
} from "../extensions/quiet-tools.ts";

const passthroughTheme = {
	bold(value: string) {
		return value;
	},
	fg(_color: string, value: string) {
		return value;
	},
};

function renderToString(component: { render(width: number): string[] }): string {
	return component.render(120).join("\n");
}

function textResult(text: string) {
	return {
		content: [{ type: "text", text }],
	};
}

function createPi(options: { throwOnToolConflict?: boolean } = {}) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const hooks = new Map<string, any[]>();
	return {
		tools,
		pi: {
			registerTool(tool: any) {
				if (options.throwOnToolConflict && tools.has(tool.name)) {
					throw new Error(`Tool ${tool.name} already registered`);
				}
				tools.set(tool.name, tool);
			},
			registerCommand(name: string, command: any) {
				commands.set(name, command);
			},
			on(name: string, handler: any) {
				hooks.set(name, [...(hooks.get(name) ?? []), handler]);
			},
		},
	};
}

function createSdkTool(name: string) {
	return {
		name,
		label: name,
		description: `${name} tool`,
		parameters: { type: "object", properties: {} },
		execute: async () => textResult(`${name} result`),
	};
}

const fakePiPrettyDeps = {
	sdk: {
		createReadTool: () => createSdkTool("read"),
		createBashTool: () => createSdkTool("bash"),
		createLsTool: () => createSdkTool("ls"),
		createFindTool: () => createSdkTool("find"),
		createGrepTool: () => createSdkTool("grep"),
	},
};

function withEnv<T>(updates: Record<string, string | undefined>, run: () => T): T {
	const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
	try {
		for (const [key, value] of Object.entries(updates)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		return run();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

async function withEnvAsync<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
	const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
	try {
		for (const [key, value] of Object.entries(updates)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		return await run();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("quiet tool rendering registers noisy built-in tools", () => {
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => {
		const { pi, tools } = createPi();

		quietTools(pi as any);

		for (const toolName of ["read", "bash", "grep", "find", "ls", "edit", "write"]) {
			const tool = tools.get(toolName);
			assert.ok(tool, `missing quiet renderer for ${toolName}`);
			assert.equal(typeof tool.execute, "function", `${toolName} must delegate execution`);
			assert.ok(tool.parameters, `${toolName} must preserve built-in parameters`);
		}
	});
});

test("quiet tool rendering can be disabled by env", () => {
	withEnv({ GENTLE_PI_QUIET_TOOLS: "0" }, () => {
		const { pi, tools } = createPi();

		quietTools(pi as any);

		assert.equal(tools.size, 0);
	});
});

test("pi-pretty suppresses overlapping tools before quiet tools register", async () => {
	await withEnvAsync(
		{ GENTLE_PI_QUIET_TOOLS: undefined, PRETTY_DISABLE_TOOLS: "multi_grep" },
		async () => {
			const { pi, tools } = createPi({ throwOnToolConflict: true });

			await piPretty(pi as any, fakePiPrettyDeps as any);
			quietTools(pi as any);

			for (const toolName of ["read", "bash", "grep", "find", "ls", "edit", "write"]) {
				assert.ok(tools.has(toolName), `missing quiet tool ${toolName}`);
			}
			assert.equal(process.env.PRETTY_DISABLE_TOOLS, "multi_grep,read,bash,ls,find,grep");
		},
	);
});

test("pi-pretty suppression is skipped when quiet tools are disabled", async () => {
	await withEnvAsync(
		{ GENTLE_PI_QUIET_TOOLS: "0", PRETTY_DISABLE_TOOLS: undefined },
		async () => {
			const { pi, tools } = createPi();

			await piPretty(pi as any, fakePiPrettyDeps as any);
			quietTools(pi as any);

			for (const toolName of ["read", "bash", "grep", "find", "ls"]) {
				assert.ok(tools.has(toolName), `pi-pretty should keep ${toolName} when quiet tools are disabled`);
			}
			assert.equal(process.env.PRETTY_DISABLE_TOOLS, undefined);
		},
	);
});

test("quiet tool rendering hides noisy result bodies while collapsed and restores them when expanded", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));

	const cases = [
		{ tool: "read", text: "first line\nsecond line", hidden: "first line", expanded: "second line" },
		{ tool: "bash", text: "stdout line\nstderr line", hidden: "stdout line", expanded: "stderr line" },
		{ tool: "grep", text: "src/a.ts:1:match\nsrc/b.ts:2:match", hidden: "src/a.ts", expanded: "src/b.ts" },
		{ tool: "find", text: "src/a.ts\nsrc/b.ts", hidden: "src/a.ts", expanded: "src/b.ts" },
		{ tool: "ls", text: "file-a.ts\nfile-b.ts", hidden: "file-a.ts", expanded: "file-b.ts" },
	];

	for (const entry of cases) {
		const tool = tools.get(entry.tool);
		const collapsed = renderToString(
			tool.renderResult(textResult(entry.text), { expanded: false, isPartial: false }, passthroughTheme, {}),
		);
		const expanded = renderToString(
			tool.renderResult(textResult(entry.text), { expanded: true, isPartial: false }, passthroughTheme, {}),
		);

		assert.doesNotMatch(collapsed, new RegExp(entry.hidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${entry.tool} collapsed output must not include result body`);
		assert.match(expanded, new RegExp(entry.expanded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${entry.tool} expanded output must include full result body`);
	}
});

test("quiet tool rendering keeps compact collapsed summaries for search and listing tools", () => {
	assert.equal(countNonEmptyLines("a\n\n b \n"), 2);
	assert.equal(extractTextContent(textResult("alpha\nbeta") as any), "alpha\nbeta");
	assert.equal(formatToolResultOutput("grep", textResult("a\nb\n") as any, { expanded: false }), " → 2 matches");
	assert.equal(formatToolResultOutput("find", textResult("a\nb\n") as any, { expanded: false }), " → 2 files");
	assert.equal(formatToolResultOutput("ls", textResult("a\nb\n") as any, { expanded: false }), " → 2 entries");
	assert.equal(formatToolResultOutput("grep", textResult("No matches found") as any, { expanded: false }), "");
	assert.equal(formatToolResultOutput("find", textResult("No files found matching pattern") as any, { expanded: false }), "");
	assert.equal(formatToolResultOutput("ls", textResult("Directory is empty") as any, { expanded: false }), "");
	assert.equal(formatToolResultOutput("read", textResult("a\nb\n") as any, { expanded: false }), "");
	assert.equal(formatToolResultOutput("bash", textResult("a\nb\n") as any, { expanded: false }), "");
	assert.equal(formatToolResultOutput("bash", textResult("a\nb\n") as any, { expanded: false, args: { command: "git diff" } }), "\na\nb\n");
	assert.equal(formatToolResultOutput("bash", textResult("a\nb\n") as any, { expanded: false, args: { command: "git -C repo status" } }), "\na\nb\n");
	assert.equal(formatToolResultOutput("bash", textResult("a\nb\n") as any, { expanded: false, args: { command: "echo git diff" } }), "");
	assert.equal(formatToolResultOutput("edit", textResult("updated") as any, { expanded: false }), "\nupdated");
	assert.equal(formatToolResultOutput("write", textResult("wrote") as any, { expanded: false }), "\nwrote");
	assert.equal(formatToolResultOutput("grep", textResult("a\nb\n") as any, { expanded: true }), "\na\nb\n");
	assert.equal(formatToolResultOutput("read", textResult("ENOENT: missing file") as any, { expanded: false, isError: true }), "\nENOENT: missing file");
});

test("quiet tool rendering keeps collapsed git bash result tails", () => {
	const text = Array.from({ length: 12 }, (_, index) => `git line ${index + 1}`).join("\n");

	assert.equal(formatToolResultOutput("bash", textResult(text) as any, { expanded: false, args: { command: "git diff" } }), `\n${tailLines(text, 10)}`);
	assert.equal(formatToolResultOutput("bash", textResult(text) as any, { expanded: false, args: { command: "git status --short" } }), `\n${tailLines(text, 10)}`);
});

test("quiet tool rendering keeps collapsed edit and write result tails", () => {
	const text = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");

	assert.equal(tailLines(text, 10), Array.from({ length: 10 }, (_, index) => `line ${index + 3}`).join("\n"));
	assert.equal(formatToolResultOutput("edit", textResult(text) as any, { expanded: false }), `\n${tailLines(text, 10)}`);
	assert.equal(formatToolResultOutput("write", textResult(text) as any, { expanded: false }), `\n${tailLines(text, 10)}`);
});

test("quiet tool rendering sanitizes collapsed output and call rows", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));

	const collapsed = renderToString(
		tools.get("write").renderResult(textResult("safe\x1b[31mred\x1b[0m"), { expanded: false, isPartial: false }, passthroughTheme, {}),
	);
	const call = renderToString(tools.get("bash").renderCall({ command: "echo \x1b[31mred\x1b[0m" }, passthroughTheme, {}));

	assert.equal(collapsed.replace(/[ \t]+$/gm, ""), "\nsafered");
	assert.equal(call.trimEnd(), "$ echo red");
});

test("quiet tool rendering call rows show tool calls without result output", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));

	const readCall = renderToString(tools.get("read").renderCall({ path: "/tmp/example.ts", offset: 2, limit: 3 }, passthroughTheme, {}));
	const bashCall = renderToString(tools.get("bash").renderCall({ command: "printf noisy", timeout: 5 }, passthroughTheme, {}));
	const grepCall = renderToString(tools.get("grep").renderCall({ pattern: "needle", path: "src", glob: "*.ts" }, passthroughTheme, {}));

	assert.match(readCall, /read .*example\.ts:2-4/);
	assert.match(bashCall, /\$ printf noisy \(timeout 5s\)/);
	assert.match(grepCall, /grep \/needle\/ in src \(\*\.ts\)/);
});
