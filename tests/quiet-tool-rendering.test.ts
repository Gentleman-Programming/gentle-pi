import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, keyHint } from "@earendil-works/pi-coding-agent";
import { imageFallback } from "@earendil-works/pi-tui";
import piPretty from "../extensions/pi-pretty.ts";
import quietTools, {
	countNonEmptyLines,
	extractTextContent,
	formatToolResultOutput,
	gentleAiRoutineCommand,
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

initTheme("dark");

const statusTheme = {
	bold(value: string) {
		return value;
	},
	fg(color: string, value: string) {
		return `<${color}>${value}</${color}>`;
	},
};

function routineRenderContext(overrides: Record<string, unknown> = {}) {
	return {
		args: {},
		toolCallId: "tool-call",
		invalidate() {},
		lastComponent: undefined,
		state: {},
		cwd: "/repo",
		executionStarted: false,
		argsComplete: true,
		isPartial: true,
		expanded: false,
		showImages: false,
		isError: false,
		...overrides,
	};
}

function renderToString(component: { render(width: number): string[] }): string {
	return component.render(120).map((line) => line.trimEnd()).join("\n");
}

function textResult(text: string, details?: unknown) {
	return {
		content: [{ type: "text", text }],
		details,
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

function registeredQuietTools() {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	return tools;
}

function renderToolResult(tool: any, result: any, options: any, context: Record<string, unknown> = {}): string {
	return renderToString(tool.renderResult(result, options, passthroughTheme, context));
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

test("quiet tool execution uses the tool-call cwd", async () => {
	const tool = registeredQuietTools().get("bash");
	const output = extractTextContent(await tool.execute("tool-call", { command: "pwd" }, new AbortController().signal, undefined, { cwd: "/tmp" })).trim();
	assert.equal(output, "/tmp");
	assert.notEqual(output, process.cwd());
});

test("quiet Bash rendering leaves configured shellPath outside its scope (#107)", () => {
	const tool = registeredQuietTools().get("bash");
	const render = (context: Record<string, unknown> = {}) => renderToString(tool.renderCall({ command: "printf output" }, passthroughTheme, routineRenderContext(context)));
	const configured = render({ shellPath: "/configured/bash" });
	assert.equal(configured, render());
	assert.doesNotMatch(configured, /shellPath|configured\/bash/);
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

test("quiet tool rendering uses bounded previews while preserving search summaries", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));

	const read = renderToString(
		tools.get("read").renderResult(textResult("first line\nsecond line"), { expanded: false, isPartial: false }, passthroughTheme, {}),
	);
	const bash = renderToString(
		tools.get("bash").renderResult(textResult("stdout line\nstderr line"), { expanded: false, isPartial: false }, passthroughTheme, { args: { command: "printf output" } }),
	);
	assert.match(read, /first line\nsecond line/);
	assert.match(bash, /stdout line\nstderr line/);
	const configuredHint = keyHint("app.tools.expand", "to expand");
	assert.ok(read.includes(configuredHint));
	assert.ok(bash.includes(configuredHint));

	for (const [tool, text, label] of [
		["grep", "src/a.ts:1:match\nsrc/b.ts:2:match", "2 matches"],
		["find", "src/a.ts\nsrc/b.ts", "2 files"],
		["ls", "file-a.ts\nfile-b.ts", "2 entries"],
	] as const) {
		const collapsed = renderToString(
			tools.get(tool).renderResult(textResult(text), { expanded: false, isPartial: false }, passthroughTheme, {}),
		);
		const expanded = renderToString(
			tools.get(tool).renderResult(textResult(text), { expanded: true, isPartial: false }, passthroughTheme, {}),
		);
		assert.match(collapsed, new RegExp(label));
		assert.doesNotMatch(collapsed, /src\/a\.ts|file-a\.ts/);
		assert.match(expanded, new RegExp(text.split("\n")[1]!));
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
	assert.equal(formatToolResultOutput("read", textResult("a\nb\n") as any, { expanded: false }), "\na\nb");
	assert.equal(formatToolResultOutput("bash", textResult("a\nb\n") as any, { expanded: false }), "\na\nb");
	assert.equal(formatToolResultOutput("bash", textResult("a\nb\n") as any, { expanded: false, args: { command: "git diff" } }), "\na\nb\n");
	assert.equal(formatToolResultOutput("bash", textResult("a\nb\n") as any, { expanded: false, args: { command: "git -C repo status" } }), "\na\nb\n");
	assert.equal(formatToolResultOutput("bash", textResult("a\nb\n") as any, { expanded: false, args: { command: "echo git diff" } }), "\na\nb");
	assert.equal(formatToolResultOutput("edit", textResult("updated") as any, { expanded: false }), "\n✓ applied");
	assert.equal(formatToolResultOutput("write", textResult("wrote") as any, { expanded: false }), "\n✓ written");
	assert.equal(formatToolResultOutput("grep", textResult("a\nb\n") as any, { expanded: true }), "\na\nb\n");
	assert.equal(formatToolResultOutput("read", textResult("ENOENT: missing file") as any, { expanded: false, isError: true }), "\nENOENT: missing file");
});

test("quiet tool rendering identifies only routine Gentle AI SDD and RDD commands", () => {
	assert.equal(gentleAiRoutineCommand({ command: "gentle-ai sdd-status fix-rose --json" }), "sdd-status");
	assert.equal(gentleAiRoutineCommand({ command: "env FOO=bar gentle-ai sdd-continue fix-rose" }), "sdd-continue");
	assert.equal(gentleAiRoutineCommand({ command: "/package/.gentle-ai/v2.2.0/gentle-ai review status --next-transition" }), "review");
	assert.equal(gentleAiRoutineCommand({ command: "./.gentle-ai/v2.2.0/gentle-ai sdd-status rose --json" }), "sdd-status");
	assert.equal(gentleAiRoutineCommand({ command: ".\\.gentle-ai\\v2.2.0\\gentle-ai.exe review status --next-transition" }), "review");
	assert.equal(gentleAiRoutineCommand({ command: "C:\\package\\.gentle-ai\\v2.2.0\\gentle-ai.exe sdd-continue rose" }), "sdd-continue");
	assert.equal(gentleAiRoutineCommand({ command: "gentle-ai sdd-attempt acquire --change fix-rose" }), "sdd-attempt");
	assert.equal(gentleAiRoutineCommand({ command: "gentle-ai sdd-attempt settle --change fix-rose" }), "sdd-attempt");
	assert.equal(gentleAiRoutineCommand({ command: "gentle-ai review status --next-transition" }), "review");
	assert.equal(gentleAiRoutineCommand({ command: "gentle-ai version" }), undefined);
	assert.equal(gentleAiRoutineCommand({ command: "gentle-ai sdd-attempt inspect" }), undefined);
	assert.equal(gentleAiRoutineCommand({ command: "/package/.gentle-ai/v2.2.0/gentle-ai-copy review status" }), undefined);
	assert.equal(gentleAiRoutineCommand({ command: "echo gentle-ai review status" }), undefined);
});

test("quiet tool rendering refuses to compact composed Gentle AI shell commands", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const commands = [
		"gentle-ai review status --next-transition && rm -rf target",
		"gentle-ai review status; rm -rf target",
		"gentle-ai review status || rm -rf target",
		"gentle-ai review status | tee status.json",
		"gentle-ai review status & rm -rf target",
		"gentle-ai review status\nrm -rf target",
		"gentle-ai review status --next-transition $(rm -rf target)",
		"gentle-ai review status --next-transition `rm -rf target`",
		"gentle-ai review status --next-transition <(cat target)",
		"gentle-ai review status --next-transition >(tee target)",
		"gentle-ai review status --next-transition > status.json",
		"gentle-ai review status --next-transition < status.json",
		"gentle-ai review status $HOME",
		"gentle-ai review status ${HOME}",
		"gentle-ai review status\n",
	];

	for (const command of commands) {
		assert.equal(gentleAiRoutineCommand({ command }), undefined, command);
		const call = renderToString(tools.get("bash").renderCall({ command }, passthroughTheme, {}));
		const output = renderToString(tools.get("bash").renderResult(textResult("command output"), { expanded: true, isPartial: false }, passthroughTheme, { args: { command } }));
		assert.equal(call.replace(/[ \t]+$/gm, "").trimEnd(), `$ ${command.trimEnd()}`);
		assert.match(output, /command output/);
	}
});

test("quiet tool rendering compacts successful routine Gentle AI calls but preserves failures", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const command = "gentle-ai review status --next-transition";
	const textRose = "\u{1F339}\uFE0E";
	const tool = tools.get("bash");

	const call = renderToString(tool.renderCall({ command }, passthroughTheme, {}));
	const collapsed = renderToString(tool.renderResult(textResult('{"next_transition":"stop"}'), { expanded: false, isPartial: false }, passthroughTheme, { args: { command } }));
	const expanded = renderToString(tool.renderResult(textResult('{"next_transition":"stop"}'), { expanded: true, isPartial: false }, passthroughTheme, { args: { command } }));
	const failure = renderToString(tool.renderResult(textResult("review status failed: authority unavailable"), { expanded: false, isPartial: false, isError: true }, passthroughTheme, { args: { command } }));

	assert.equal([...textRose].length, 2);
	assert.equal(call.trimEnd(), `${textRose} Gentle AI · running · review status`);
	assert.equal(collapsed, "");
	assert.match(expanded, /"next_transition":"stop"/);
	assert.match(failure, /review status failed: authority unavailable/);
});

test("quiet tool rendering transitions one Gentle AI header through lifecycle states", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const tool = tools.get("bash");
	const command = "gentle-ai review status --cwd /repo/private-change";

	const initial = tool.renderCall({ command }, statusTheme, routineRenderContext());
	const initialText = renderToString(initial).trimEnd();
	const running = tool.renderCall(
		{ command },
		statusTheme,
		routineRenderContext({ executionStarted: true, lastComponent: initial }),
	);
	const runningText = renderToString(running).trimEnd();
	const completed = tool.renderCall(
		{ command },
		statusTheme,
		routineRenderContext({
			executionStarted: true,
			isPartial: false,
			lastComponent: running,
		}),
	);
	const completedText = renderToString(completed).trimEnd();
	const failed = tool.renderCall(
		{ command },
		statusTheme,
		routineRenderContext({
			executionStarted: true,
			isPartial: false,
			isError: true,
			lastComponent: completed,
		}),
	);
	const failedText = renderToString(failed).trimEnd();

	assert.strictEqual(initial, running);
	assert.strictEqual(running, completed);
	assert.strictEqual(completed, failed);
	assert.equal(initialText, "<warning>🌹︎ Gentle AI · running · review status</warning>");
	assert.equal(runningText, "<warning>🌹︎ Gentle AI · running · review status</warning>");
	assert.equal(completedText, "<success>🌹︎ Gentle AI · completed · review status</success>");
	assert.equal(failedText, "<error>🌹︎ Gentle AI · failed · review status</error>");
	assert.doesNotMatch(failedText, /private-change/);
});

test("quiet tool rendering displays only finite safe Gentle AI operation paths", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const tool = tools.get("bash");
	const rose = "🌹︎";
	const cases = [
		["gentle-ai sdd-status change-123 --cwd /repo/private", "sdd status"],
		["gentle-ai sdd-continue change-123 --json", "sdd continue"],
		["gentle-ai sdd-attempt acquire --change change-123", "sdd attempt acquire"],
		["gentle-ai sdd-attempt settle --change change-123 --actor maintainer", "sdd attempt settle"],
		["gentle-ai review capabilities --cwd /repo/private", "review capabilities"],
		["gentle-ai review start --target sha256:secret --path src/private.ts", "review start"],
		["gentle-ai review finalize --lineage lineage-secret --payload '{\"secret\":true}'", "review finalize"],
		["gentle-ai review status --lineage lineage-secret", "review status"],
		["gentle-ai review repair --reason private-reason", "review repair"],
		["gentle-ai review invalidate --lineage lineage-secret", "review invalidate"],
		["gentle-ai review abandon --lineage lineage-secret", "review abandon"],
		["gentle-ai review recover --lineage lineage-secret", "review recover"],
		["gentle-ai review reclaim --lineage lineage-secret", "review reclaim"],
		["gentle-ai review validate --cwd /repo/private", "review validate"],
		["gentle-ai review capture-result --input result.json", "review capture result"],
		["gentle-ai review capture-refuter --input result.json", "review capture refuter"],
		["gentle-ai review capture-validation --input result.json", "review capture validation"],
		["gentle-ai review capture-evidence --input evidence.json", "review capture evidence"],
		["gentle-ai review preserve-result --input result.json", "review preserve result"],
		["gentle-ai review lens-context --lens reviewer", "review lens context"],
		["gentle-ai review retry-final-verification --incident incident.json", "review retry final verification"],
		["gentle-ai review store-reset --authorization secret", "review store reset"],
		["gentle-ai review inspect-authority --path /repo/private", "review inspect authority"],
		["gentle-ai review inspect-candidate --path /repo/private", "review inspect candidate"],
		["gentle-ai review dispose-result --reference result-secret", "review dispose result"],
		["gentle-ai review reopen-results --reference result-secret", "review reopen results"],
		["gentle-ai review opencode-transport --payload secret", "review opencode transport"],
		["gentle-ai review bind-sdd --change change-123 --lineage lineage-secret", "review bind sdd"],
		["gentle-ai review mode enable --actor maintainer", "review mode enable"],
		["gentle-ai review mode disable --actor maintainer", "review mode disable"],
		["gentle-ai review mode status --json", "review mode status"],
		["gentle-ai review validate --gate post-apply --cwd /repo/private", "review validate post apply"],
		["gentle-ai review validate --gate pre-commit --cwd /repo/private", "review validate pre commit"],
		["gentle-ai review validate --gate pre-push --cwd /repo/private", "review validate pre push"],
		["gentle-ai review validate --gate pre-pr --cwd /repo/private", "review validate pre pr"],
		["gentle-ai review validate --gate release --cwd /repo/private", "review validate release"],
		["gentle-ai review schema capture-result-dry-run --path /tmp/private.json", "review schema capture result dry run"],
		["gentle-ai review schema final-verification-incident --path /tmp/private.json", "review schema final verification incident"],
		["gentle-ai review schema refuter --path /tmp/private.json", "review schema refuter"],
		["gentle-ai review schema reviewer --path /tmp/private.json", "review schema reviewer"],
		["gentle-ai review schema validator --path /tmp/private.json", "review schema validator"],
		["gentle-ai review schema verification-evidence --path /tmp/private.json", "review schema verification evidence"],
		["gentle-ai review schema verification-evidence-record --path /tmp/private.json", "review schema verification evidence record"],
		["gentle-ai review unknown-operation --change change-123 --reason private-reason", "review"],
		["gentle-ai review mode restart --actor maintainer", "review"],
		["gentle-ai review validate --gate unknown-gate --cwd /repo/private", "review"],
		["gentle-ai review schema unknown-schema --path /tmp/private.json", "review schema"],
	];

	for (const [command, path] of cases) {
		const rendered = renderToString(
			tool.renderCall(
				{ command },
				passthroughTheme,
				routineRenderContext({ args: { command } }),
			),
		);
		assert.equal(rendered.trimEnd(), `${rose} Gentle AI · running · ${path}`, command);
		assert.doesNotMatch(rendered, /change-123|private|secret|lineage|sha256|result\.json|incident\.json/);
	}
});

test("quiet tool rendering covers version and future standalone Gentle AI commands", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const tool = tools.get("bash");
	const rose = "🌹︎";
	const cases = [
		["gentle-ai version", "version"],
		["gentle-ai future-command --authorization-root /repo/private", "command"],
		["gentle-ai sdd-attempt future-verb --change secret-change", "sdd attempt"],
		["gentle-ai review future-operation --path /repo/private", "review"],
		["/package/.gentle-ai/v2.2.0/gentle-ai version", "version"],
		["C:\\package\\.gentle-ai\\v2.2.0\\gentle-ai.exe future-command --root C:\\private", "command"],
	] as const;

	for (const [command, path] of cases) {
		const rendered = renderToString(
			tool.renderCall({ command }, passthroughTheme, routineRenderContext({ args: { command } })),
		);
		assert.equal(rendered.trimEnd(), `${rose} Gentle AI · running · ${path}`, command);
		assert.doesNotMatch(rendered, /authorization-root|secret-change|private|C:\\\\private/);
	}
});

test("quiet tool rendering recognizes exact quoted, escaped, Windows, and command-prefixed Gentle AI executables", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const tool = tools.get("bash");
	const routineCommands = [
		"gentle-ai.exe version",
		"'gentle-ai' version",
		'"gentle-ai" version',
		"'gentle-ai.exe' version",
		'"gentle-ai.exe" version',
		"gentle\\-ai version",
		"gentle\\-ai\\.exe version",
		"command -- gentle-ai version",
		"command -- 'gentle-ai.exe' version",
		"env gentle-ai version",
		"FOO='a b' gentle-ai version",
		'FOO="a b" gentle-ai version',
		"env FOO='a b' gentle-ai version",
		'env FOO="a b" gentle-ai version',
	] as const;

	for (const command of routineCommands) {
		const call = renderToString(tool.renderCall({ command }, passthroughTheme, { args: { command } }));
		assert.equal(call.trimEnd(), "🌹︎ Gentle AI · running · version", command);
	}

	for (const command of ["'gentle-ai-copy' version", '"gentle-ai-copy.exe" version', "'gentle-ai' version && echo done"] as const) {
		const call = renderToString(tool.renderCall({ command }, passthroughTheme, { args: { command } }));
		assert.equal(call.trimEnd(), `$ ${command}`);
		assert.doesNotMatch(call, /🌹︎ Gentle AI/);
	}
});

test("quiet tool rendering hides the routine partial result because the header owns state", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const tool = tools.get("bash");
	const command = "gentle-ai review status --cwd /repo/private";

	const partial = renderToString(
		tool.renderResult(
			textResult("{\"status\":\"running\"}"),
			{ expanded: false, isPartial: true },
			passthroughTheme,
			{ ...routineRenderContext({ args: { command } }), isError: false },
		),
	);
	const partialExpanded = renderToString(
		tool.renderResult(
			textResult("{\"status\":\"running\"}"),
			{ expanded: true, isPartial: true },
			passthroughTheme,
			{ ...routineRenderContext({ args: { command } }), isError: false },
		),
	);
	const partialFailure = renderToString(
		tool.renderResult(
			textResult("review status failed: authority unavailable"),
			{ expanded: false, isPartial: true },
			passthroughTheme,
			{ ...routineRenderContext({ args: { command } }), isError: true },
		),
	);

	assert.equal(partial, "");
	assert.match(partialExpanded, /"status":"running"/);
	assert.match(partialFailure, /review status failed: authority unavailable/);
});

test("quiet tool rendering keeps grant invocation auditing separate from the safe lifecycle path", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const tool = tools.get("bash");
	const command = "gentle-ai sdd-attempt grant --authorization-root /repo/root --authorization-root /other/root --change secret-change\x1b[31m";
	const expectedAudit = command.replace("\x1b[31m", "");

	const initial = tool.renderCall(
		{ command },
		statusTheme,
		routineRenderContext({ args: { command } }),
	);
	const running = tool.renderCall(
		{ command },
		statusTheme,
		routineRenderContext({ args: { command }, executionStarted: true, lastComponent: initial }),
	);
	const completed = tool.renderCall(
		{ command },
		statusTheme,
		routineRenderContext({ args: { command }, executionStarted: true, isPartial: false, lastComponent: running }),
	);
	const failed = tool.renderCall(
		{ command },
		statusTheme,
		routineRenderContext({ args: { command }, executionStarted: true, isPartial: false, isError: true, lastComponent: completed }),
	);

	assert.strictEqual(initial, running);
	assert.strictEqual(running, completed);
	assert.strictEqual(completed, failed);
	const lines = renderToString(failed).split("\n").map((line) => line.replace(/[ \t]+$/g, ""));
	assert.equal(lines[0], "<error>🌹︎ Gentle AI · failed · sdd attempt grant</error>");
	const audit = lines.slice(1).join(" ").replace(/<\/?dim>/g, "").replace(/\s+/g, " ").trim();
	assert.equal(audit, `audit: ${expectedAudit}`);
	assert.match(audit, /--authorization-root \/repo\/root --authorization-root \/other\/root/);
	assert.doesNotMatch(lines[0], /authorization-root|secret-change|other\/root/);
	assert.doesNotMatch(audit, /\x1b\[/);
});

test("quiet tool rendering keeps shell compositions, expansions, and lookalikes generic", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));
	const tool = tools.get("bash");
	const commands = [
		"gentle-ai version && echo done",
		"gentle-ai version; echo done",
		"gentle-ai version | tee output",
		"gentle-ai version $HOME",
		"gentle-ai version $(printf nested)",
		"gentle-ai sdd-attempt grant --change secret-change # ignored comment",
		"/package/.gentle-ai/v2.2.0/gentle-ai-copy version",
		"echo gentle-ai version",
	];

	for (const command of commands) {
		const call = renderToString(tool.renderCall({ command }, passthroughTheme, { args: { command } }));
		const output = renderToString(
			tool.renderResult(textResult("original command output"), { expanded: true, isPartial: false }, passthroughTheme, { args: { command } }),
		);
		assert.equal(call.trimEnd(), `$ ${command}`);
		assert.doesNotMatch(call, /🌹︎ Gentle AI/);
		assert.match(output, /original command output/);
	}
});

test("quiet tool rendering keeps collapsed git bash result tails", () => {
	const text = Array.from({ length: 12 }, (_, index) => `git line ${index + 1}`).join("\n");

	assert.equal(formatToolResultOutput("bash", textResult(text) as any, { expanded: false, args: { command: "git diff" } }), `\n${tailLines(text, 10)}`);
	assert.equal(formatToolResultOutput("bash", textResult(text) as any, { expanded: false, args: { command: "git status --short" } }), `\n${tailLines(text, 10)}`);
});

test("quiet tool rendering keeps concise collapsed edit and write summaries", () => {
	const text = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");

	assert.equal(tailLines(text, 10), Array.from({ length: 10 }, (_, index) => `line ${index + 3}`).join("\n"));
	assert.equal(formatToolResultOutput("edit", textResult(text, { diff: "@@\n-old\n+new" }) as any, { expanded: false }), "\n✓ +1 / -1");
	assert.equal(formatToolResultOutput("write", textResult("Successfully wrote 12 bytes\n" + text) as any, { expanded: false }), "\n✓ wrote 12 bytes");
});

test("quiet tool rendering sanitizes collapsed output and call rows", () => {
	const { pi, tools } = createPi();
	withEnv({ GENTLE_PI_QUIET_TOOLS: undefined }, () => quietTools(pi as any));

	const collapsed = renderToString(
		tools.get("bash").renderResult(textResult("safe\x1b[31mred\x1b[0m"), { expanded: false, isPartial: false }, passthroughTheme, { args: { command: "printf output" } }),
	);
	const call = renderToString(tools.get("bash").renderCall({ command: "echo \x1b[31mred\x1b[0m" }, passthroughTheme, {}));

	assert.match(collapsed, /safered/);
	assert.doesNotMatch(collapsed, /\x1b\[31m|\x1b\[0m/);
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

test("quiet tool rendering bounds and sanitizes partial text without a completion hint", () => {
	const tool = registeredQuietTools().get("bash");
	const result = textResult("first\nsecond\nthird\nfourth");
	const collapsed = renderToolResult(tool, result, { expanded: false, isPartial: true }, { args: { command: "printf output" } });
	const expanded = renderToolResult(tool, result, { expanded: true, isPartial: true }, { args: { command: "printf output" } });

	assert.match(collapsed, /… bash · 4 lines/);
	assert.doesNotMatch(collapsed, /first/);
	assert.match(collapsed, /second\nthird\nfourth/);
	assert.doesNotMatch(collapsed, /to expand|Ctrl\+O/);
	assert.match(expanded, /first\nsecond\nthird\nfourth/);
	assert.doesNotMatch(expanded, /to expand|Ctrl\+O/);

	const sanitized = renderToolResult(tool, textResult("safe\x1b]52;c;Y2xpcGJvYXJk\x07\x1b[2Jdone"), { expanded: true, isPartial: true }, { args: { command: "echo safe" } });
	assert.match(sanitized, /safedone/);
	assert.doesNotMatch(sanitized, /\x1b/);

	for (const [value, options] of [
		[textResult(""), { expanded: false, isPartial: true }],
		[{ content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] }, { expanded: true, isPartial: true }],
	] as const) {
		assert.equal(renderToolResult(tool, value, options, { args: { command: "true" } }).trimEnd(), "… bash");
	}
});

test("quiet tool rendering bounds completed previews, errors, and edit/write summaries", () => {
	const tools = registeredQuietTools();
	for (const [toolName, text, hidden, visible, context] of [
		["read", "read one\nread two\nread three\nread four", "read four", "read one\nread two\nread three", {}],
		["bash", "bash one\nbash two\nbash three\nbash four", "bash one", "bash two\nbash three\nbash four", { args: { command: "printf output" } }],
	] as const) {
		const rendered = renderToolResult(tools.get(toolName), textResult(text), { expanded: false, isPartial: false }, context);
		assert.doesNotMatch(rendered, new RegExp(hidden));
		assert.match(rendered, new RegExp(visible));
		assert.match(rendered, /to expand/);
	}

	for (const toolName of ["read", "bash", "grep", "find", "ls", "edit", "write"] as const) {
		const rendered = renderToolResult(tools.get(toolName), textResult("error one\nerror two\nerror three\nerror four"), { expanded: false, isPartial: false, isError: true }, { args: toolName === "bash" ? { command: "false" } : {} });
		assert.doesNotMatch(rendered, /error one/);
		assert.match(rendered, /error two\nerror three\nerror four/);
		assert.match(rendered, /to expand/);
	}

	const edit = renderToolResult(tools.get("edit"), textResult("Applied", { diff: "@@\n-old\n+new" }), { expanded: false, isPartial: false }, { args: { path: "file.ts", edits: [] } });
	const write = renderToolResult(tools.get("write"), textResult("Successfully wrote 4 bytes\nbody"), { expanded: false, isPartial: false }, { args: { path: "file.ts", content: "body" } });
	assert.match(edit, /\+1 \/ -1/);
	assert.doesNotMatch(edit, /Applied|old|new/);
	assert.match(write, /wrote 4 bytes/);
	assert.doesNotMatch(write, /body/);
});

test("quiet tool rendering preserves complete expanded text and delegates sanitized image reads", () => {
	const tools = registeredQuietTools();
	const expanded = renderToolResult(tools.get("bash"), textResult("first\nsecond\nthird\nfourth\nsafe\x1b]52;c;Y2xpcGJvYXJk\x07done"), { expanded: true, isPartial: false }, { args: { command: "printf safe" } });
	assert.match(expanded, /first\nsecond\nthird\nfourth\nsafedone/);
	assert.doesNotMatch(expanded, /\x1b/);

	const edit = renderToolResult(tools.get("edit"), textResult("Applied", { diff: "@@\n-old\x1b]52;c;Y2xpcGJvYXJk\x07\n+new" }), { expanded: true, isPartial: false }, { args: { path: "file\x1b[2J.ts", edits: [{ oldText: "old\x1b[31m", newText: "new" }] } });
	assert.match(edit, /-old\n\+new/);
	assert.doesNotMatch(edit, /\x1b/);

	const image = renderToolResult(
		tools.get("read"),
		{ content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }], details: { path: "image\x1b[2J.png", note: "safe\x1b]2;title\x07" } },
		{ expanded: true, isPartial: false },
		{ args: { path: "image\x1b[2J.png", offset: 1, limit: 2 }, cwd: "/repo\x1b[2J", showImages: false, isError: false },
	);
	assert.ok(image.includes(imageFallback("image/png")));
	assert.doesNotMatch(image, /\x1b/);
});
