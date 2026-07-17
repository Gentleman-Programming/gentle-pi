#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { domainHashV1 } from "../lib/review-canonical.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXTENSIONS = [
	"extensions/gentle-ai.ts",
	"extensions/quiet-tools.ts",
	"extensions/skill-registry.ts",
	"extensions/sdd-init.ts",
	"extensions/startup-banner.ts",
];

const EXPECTED_BANNER_COMMANDS = [
	"gentle:banner",
	"gentle:toggle-rose",
	"gentle:toggle-text-logo",
	"gentle:banner-color",
];

const EXPECTED_COMMANDS = [
	"gentle:install-sdd",
	"gentle:sdd-preflight",
	"sdd-status",
	"sdd-continue",
	"gentle:models",
	"gentle:persona",
	"gentle:status",
	"gentle:doctor",
	"sdd-init",
	"skill-registry:refresh",
	...EXPECTED_BANNER_COMMANDS,
];

const FORBIDDEN_COMPAT_COMMANDS = [
	"gentle-ai:install-sdd",
	"gentle-ai:sdd-preflight",
	"gentle-ai:sdd-status",
	"gentle-ai:sdd-continue",
	"gentle-ai:models",
	"gentleman:models",
	"gentle-ai:persona",
	"gentleman:persona",
	"gentle-ai:status",
	"gentle-ai:doctor",
	"gentle-ai:banner",
	"gentle-ai:toggle-rose",
	"gentle-ai:toggle-text-logo",
	"gentle-ai:banner-color",
];

function createPi() {
	const hooks = new Map();
	const commands = new Map();
	const flags = new Map();
	const tools = new Map();
	const flagValues = new Map([["no-skill-registry", true]]);
	let activeTools = ["read", "bash", "edit", "write"];

	const pi = {
		on(name, handler) {
			const list = hooks.get(name) ?? [];
			list.push(handler);
			hooks.set(name, list);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerFlag(name, definition) {
			flags.set(name, definition);
		},
		registerTool(definition) {
			tools.set(definition.name, definition);
		},
		getFlag(name) {
			return flagValues.get(name) ?? false;
		},
		setFlag(name, value) {
			flagValues.set(name, value);
		},
		getCommands() {
			return Array.from(commands, ([name, definition]) => ({ name, ...definition }));
		},
		getActiveTools() {
			return activeTools;
		},
		setActiveTools(value) {
			activeTools = value;
		},
		getAllTools() {
			return [
				{ name: "read" },
				{ name: "bash" },
				{ name: "edit" },
				{ name: "write" },
				{ name: "mem_save" },
			];
		},
	};

	return { pi, hooks, commands, flags, tools };
}

function createUi() {
	const notifications = [];
	const selections = [];
	return {
		notifications,
		selections,
		notify(message, level = "info") {
			notifications.push({ message, level });
		},
		async confirm() {
			return false;
		},
		async select(label, options) {
			selections.push({ label, options });
			return options[0];
		},
		async input(_label, placeholder) {
			return placeholder;
		},
		custom() {
			return Promise.resolve({ type: "cancel" });
		},
	};
}

function createCtx(cwd, hasUI = false, sessionId = "session-1") {
	return {
		cwd,
		hasUI,
		ui: createUi(),
		sessionManager: {
			getSessionFile() {
				return join(cwd, `${sessionId}.jsonl`);
			},
			getSessionId() {
				return sessionId;
			},
		},
		modelRegistry: {
			async getAvailable() {
				return [];
			},
		},
	};
}

function readAgentDefinition(source) {
	const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];
	assert.ok(frontmatter, "agent must have frontmatter");
	const name = frontmatter.match(/^name:\s*(\S+)$/m)?.[1];
	assert.ok(name, "agent must declare its identity");
	const tools = [...frontmatter.matchAll(/^ {2}- ([\w-]+)$/gm)].map(
		(match) => match[1],
	);
	return { name, tools };
}

function sha256(content) {
	return createHash("sha256").update(content).digest("hex");
}

async function tempWorkspace() {
	return mkdtemp(join(tmpdir(), "gentle-pi-runtime-"));
}

async function loadExtensions(pi) {
	for (const [index, rel] of EXTENSIONS.entries()) {
		const mod = await import(`${pathToFileURL(join(ROOT, rel)).href}?runtime-harness=${index}`);
		assert.equal(typeof mod.default, "function", `${rel} must export a default function`);
		mod.default(pi);
	}
}

async function run() {
	const globalConfigHome = await tempWorkspace();
	const globalAgentHome = await tempWorkspace();
	const ambientTestAssetsDir = await tempWorkspace();
	process.env.GENTLE_PI_CONFIG_HOME = globalConfigHome;
	process.env.GENTLE_PI_AGENT_HOME = globalAgentHome;
	process.env.GENTLE_PI_TEST_ASSETS_DIR = ambientTestAssetsDir;
	const globalModelsPath = join(globalConfigHome, "models.json");
	const globalSubagentsPath = join(globalAgentHome, "subagents.json");
	const { pi, hooks, commands, flags, tools } = createPi();
	await loadExtensions(pi);

	for (const name of EXPECTED_COMMANDS) {
		assert.ok(commands.has(name), `missing command ${name}`);
	}
	for (const name of FORBIDDEN_COMPAT_COMMANDS) {
		assert.equal(commands.has(name), false, `compat command should not be registered: ${name}`);
	}
	assert.ok(flags.has("no-skill-registry"), "missing no-skill-registry flag");
	assert.ok(hooks.has("session_start"), "missing session_start hook");
	assert.ok(hooks.has("session_shutdown"), "missing session_shutdown hook");
	assert.ok(hooks.has("input"), "missing input hook");
	assert.ok(hooks.has("before_agent_start"), "missing before_agent_start hook");
	assert.ok(hooks.has("tool_call"), "missing tool_call hook");
	for (const toolName of ["read", "bash", "grep", "find", "ls", "edit", "write"]) {
		assert.ok(tools.has(toolName), `missing quiet built-in tool renderer ${toolName}`);
	}
	assert.ok(tools.has("gentle_review"), "missing registered bounded review controller tool");
	assert.deepEqual(
		tools.get("gentle_review").parameters.properties.operation.enum.filter((operation) => operation.includes("supersession") || operation === "supersede"),
		["prepare-supersession", "supersede"],
		"runtime controller must expose explicit supersession operations",
	);

	for (const entry of await readdir(join(ROOT, "assets", "agents"))) {
		if (!entry.endsWith(".md")) continue;
		const agentPrompt = await readFile(join(ROOT, "assets", "agents", entry), "utf8");
		assert.doesNotMatch(
			agentPrompt,
			/inheritProjectContext:\s*true/,
			`${entry} must not inherit parent project context by default`,
		);
	}

	const discovered = await discoverAndLoadExtensions(["./extensions"], ROOT);
	assert.deepEqual(
		discovered.errors,
		[],
		"declared extension directory must load without invalid helper modules",
	);

	// orchestrator-lazy-diet: Pi Subagent Model Routing detail (the "do not
	// pass the `model` parameter by default" / SDD-model-assignment-scoping
	// rules) moved verbatim to assets/orchestrator-delegation.md; the
	// always-on combined prompt now only carries a pointer to it. Union read
	// so these assertions are repointed, not weakened.
	const delegationDetail = await readFile(join(ROOT, "assets", "orchestrator-delegation.md"), "utf8");

	const promptCwd = await tempWorkspace();
	try {
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook({ systemPrompt: "base" }, createCtx(promptCwd));
		assert.match(promptResult.systemPrompt, /base/);
		assert.match(promptResult.systemPrompt, /el Gentleman/);
		assert.match(promptResult.systemPrompt + delegationDetail, /do not pass the `model` parameter by default/);
		assert.match(
			promptResult.systemPrompt + delegationDetail,
			/SDD model assignment tables apply only to SDD\/Judgment-Day phase agents/,
		);
		assert.doesNotMatch(promptResult.systemPrompt, /Every Agent tool call MUST include `model`/);
		assert.doesNotMatch(promptResult.systemPrompt, /default\s*\|\s*sonnet\s*\|\s*Non-SDD general delegation/);
		assert.match(promptResult.systemPrompt, /openspec\/config\.yaml.*not session preflight/s);
		assert.match(promptResult.systemPrompt, /Do not mark SDD preflight complete/);
		assert.match(
			promptResult.systemPrompt,
			new RegExp(`${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*assets.*sdd-orchestrator-workflow\\.md`),
		);
		assert.doesNotMatch(
			promptResult.systemPrompt,
			new RegExp(ambientTestAssetsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
			"normal runtime must ignore ambient GENTLE_PI_TEST_ASSETS_DIR",
		);
		assert.doesNotMatch(promptResult.systemPrompt, /\{\{GENTLE_PI_SDD_WORKFLOW_PATH\}\}/);
		delete process.env.GENTLE_PI_TEST_ASSETS_DIR;
		await rm(ambientTestAssetsDir, { recursive: true, force: true });
		await writeFile(
			join(globalConfigHome, "persona.json"),
			'{"mode":"neutral"}\n',
		);
		const neutralPromptResult = await promptHook({ systemPrompt: "base" }, createCtx(promptCwd));
		assert.match(neutralPromptResult.systemPrompt, /Do not use slang or regional expressions/);
		assert.doesNotMatch(
			neutralPromptResult.systemPrompt,
			/When the user writes Spanish, answer in natural Rioplatense Spanish with voseo/,
			"neutral persona prompt must not include unconditional voseo instructions after reload",
		);
		const subagentPromptResult = await promptHook(
			{ agentName: "worker", systemPrompt: "worker base" },
			createCtx(promptCwd),
		);
		assert.equal(subagentPromptResult.systemPrompt, "worker base");
		assert.equal(
			existsSync(join(promptCwd, ".pi", "agents", "sdd-apply.md")),
			false,
			"normal agent startup must not run SDD preflight",
		);
		await mkdir(join(promptCwd, ".pi", "gentle-ai"), { recursive: true });
		await writeFile(
			join(promptCwd, ".pi", "gentle-ai", "persona.json"),
			'{"mode":"gentleman"}\n',
		);
		const localOverridePromptResult = await promptHook({ systemPrompt: "base" }, createCtx(promptCwd));
		assert.match(
			localOverridePromptResult.systemPrompt,
			/When the user writes Spanish, answer in natural Rioplatense Spanish with voseo/,
		);
		const personaCtx = createCtx(promptCwd, true);
		personaCtx.ui.select = async () => "neutral";
		await commands.get("gentle:persona").handler("", personaCtx);
		assert.equal(
			await readFile(join(globalConfigHome, "persona.json"), "utf8"),
			'{\n  "mode": "neutral"\n}\n',
		);
		assert.equal(
			await readFile(join(promptCwd, ".pi", "gentle-ai", "persona.json"), "utf8"),
			'{\n  "mode": "neutral"\n}\n',
		);
		assert.match(personaCtx.ui.notifications.at(-1).message, /Global config:/);
		const onboardCtx = createCtx(promptCwd, true, "sdd-onboard-session");
		onboardCtx.ui.select = async (_label, options) => options[0];
		const onboardPromptResult = await promptHook(
			{ agentName: "sdd-onboard", systemPrompt: "onboard base" },
			onboardCtx,
		);
		assert.match(onboardPromptResult.systemPrompt, /onboard base/);
		assert.match(onboardPromptResult.systemPrompt, /## SDD Session Preflight/);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-onboard.md")), true);
		await mkdir(join(promptCwd, "openspec", "changes", "status-demo", "specs", "demo"), { recursive: true });
		await writeFile(join(promptCwd, "openspec", "changes", "status-demo", "proposal.md"), "# Proposal\n");
		await writeFile(join(promptCwd, "openspec", "changes", "status-demo", "specs", "demo", "spec.md"), "# Spec\n");
		await writeFile(join(promptCwd, "openspec", "changes", "status-demo", "design.md"), "# Design\n");
		await writeFile(join(promptCwd, "openspec", "changes", "status-demo", "tasks.md"), "# Tasks\n\n- [ ] 1.1 Implement demo\n");
		const applyPromptResult = await promptHook(
			{ agentName: "sdd-apply", systemPrompt: "apply base" },
			createCtx(promptCwd, true, "sdd-apply-session"),
		);
		assert.match(applyPromptResult.systemPrompt, /## Native SDD Status Engine/);
		assert.match(applyPromptResult.systemPrompt, /"changeName": "status-demo"/);
		assert.match(applyPromptResult.systemPrompt, /### apply instructions/);
		const statusCtx = createCtx(promptCwd, true);
		await commands.get("sdd-status").handler("status-demo --json", statusCtx);
		assert.match(statusCtx.ui.notifications.at(-1).message, /"schemaName": "gentle-pi\.sdd-status"/);
		const continueCtx = createCtx(promptCwd, true);
		await commands.get("sdd-continue").handler("status-demo", continueCtx);
		assert.match(continueCtx.ui.notifications.at(-1).message, /Native SDD Dispatcher/);
		assert.match(continueCtx.ui.notifications.at(-1).message, /nextPhase: sdd-apply/);
		const { execFileSync } = await import("node:child_process");
		execFileSync("git", ["init"], { cwd: promptCwd, stdio: "ignore" });
		const recoveryRequiredDirectory = join(promptCwd, ".git", "gentle-ai", "reviews", "control", "recovery-required-v1");
		await mkdir(recoveryRequiredDirectory, { recursive: true });
		await writeFile(
			join(recoveryRequiredDirectory, `${domainHashV1("openspec-change-name", "status-demo")}.json`),
			'{"schema":"gentle-ai.recovery-required/v1","change_name":"status-demo"}',
		);
		const blockedContinueCtx = createCtx(promptCwd, true);
		await commands.get("sdd-continue").handler("status-demo", blockedContinueCtx);
		assert.match(blockedContinueCtx.ui.notifications.at(-1).message, /resolve-review:/);
		assert.match(blockedContinueCtx.ui.notifications.at(-1).message, /nextPhase: resolve-review/);
	} finally {
		await rm(promptCwd, { recursive: true, force: true });
	}

	const toolCwd = await tempWorkspace();
	try {
		const toolHook = hooks.get("tool_call")[0];
		assert.equal(await toolHook({ toolName: "bash", input: { command: "git status" } }, createCtx(toolCwd)), undefined);
		const receiptGate = await toolHook(
			{ toolName: "bash", input: { command: "gh pr create --draft" } },
			createCtx(toolCwd, true, "receipt-gate-session"),
		);
		assert.equal(receiptGate.block, true);
		assert.match(receiptGate.reason, /exactly derive.*--base/i);
		const denied = await toolHook({ toolName: "bash", input: { command: "rm -rf /" } }, createCtx(toolCwd));
		assert.equal(denied.block, true);
		assert.match(denied.reason, /destructive/);
		const reviewDispatch = { agent: "review-risk", task: "review", mode: "task" };
		const missingReviewView = await toolHook({ toolName: "subagent_run", input: reviewDispatch }, createCtx(toolCwd));
		assert.equal(missingReviewView.block, true);
		assert.match(missingReviewView.reason, /candidate view/i);
		assert.equal(reviewDispatch.task, "review", "blocked review dispatch must not mutate child input");
		const sensitiveRead = await toolHook({ toolName: "read", input: { path: join(toolCwd, ".env.local") } }, createCtx(toolCwd));
		assert.equal(sensitiveRead.block, true);
		assert.match(sensitiveRead.reason, /sensitive path/);
		const sensitiveWrite = await toolHook({ toolName: "write", input: { path: join(toolCwd, "secrets", "token.txt"), content: "x" } }, createCtx(toolCwd));
		assert.equal(sensitiveWrite.block, true);
		const sensitiveEdit = await toolHook({ toolName: "edit", input: { edits: [], path: join(toolCwd, "id_rsa.pem") } }, createCtx(toolCwd));
		assert.equal(sensitiveEdit.block, true);
		assert.equal(await toolHook({ toolName: "read", input: { path: join(toolCwd, "src", "index.ts") } }, createCtx(toolCwd)), undefined);
		const dangerousReviewCtx = createCtx(toolCwd, true, "dangerous-review-session");
		const needsConfirm = await toolHook(
			{ toolName: "bash", input: { command: "git push" } },
			dangerousReviewCtx,
		);
		assert.equal(needsConfirm.block, true);
		assert.match(needsConfirm.reason, /not confirmed/);
		assert.equal(
			dangerousReviewCtx.ui.notifications.length,
			0,
			"receipt validation must not launch or announce review actors",
		);
		const commitGate = await toolHook(
			{ toolName: "bash", input: { command: "git commit -m bounded" } },
			createCtx(toolCwd),
		);
		assert.equal(commitGate.block, true);
		assert.match(commitGate.reason, /exactly derive/i);
	} finally {
		await rm(toolCwd, { recursive: true, force: true });
	}

	const bannerCwd = await tempWorkspace();
	try {
		const ctx = createCtx(bannerCwd, true);
		await commands.get("gentle:toggle-rose").handler("", ctx);
		let bannerConfig = JSON.parse(await readFile(join(globalConfigHome, "banner.json"), "utf8"));
		assert.equal(bannerConfig.showRose, false);
		assert.equal(bannerConfig.showTextLogo, true);
		assert.equal(bannerConfig.color, "pink");
		await commands.get("gentle:toggle-text-logo").handler("", ctx);
		bannerConfig = JSON.parse(await readFile(join(globalConfigHome, "banner.json"), "utf8"));
		assert.equal(bannerConfig.showTextLogo, false);
		await commands.get("gentle:banner-color").handler("cyan", ctx);
		bannerConfig = JSON.parse(await readFile(join(globalConfigHome, "banner.json"), "utf8"));
		assert.equal(bannerConfig.color, "cyan");
		await commands.get("gentle:banner").handler("", ctx);
		bannerConfig = JSON.parse(await readFile(join(globalConfigHome, "banner.json"), "utf8"));
		assert.equal(bannerConfig.showRose, true);
	} finally {
		await rm(bannerCwd, { recursive: true, force: true });
		await rm(join(globalConfigHome, "banner.json"), { force: true });
	}

	const noUiCwd = await tempWorkspace();
	try {
		for (const handler of hooks.get("session_start")) {
			await handler({ reason: "startup" }, createCtx(noUiCwd, false));
		}
		assert.equal(
			existsSync(join(noUiCwd, ".pi", "agents", "sdd-apply.md")),
			false,
			"session_start must not install project-local SDD agents",
		);
		assert.equal(
			existsSync(join(noUiCwd, ".pi", "chains", "sdd-full.chain.md")),
			false,
			"session_start must not install project-local SDD chains",
		);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		const installedRefuterPath = join(globalAgentHome, "agents", "review-refuter.md");
		assert.equal(existsSync(installedRefuterPath), true);
		assert.deepEqual(
			readAgentDefinition(await readFile(installedRefuterPath, "utf8")),
			{ name: "review-refuter", tools: ["read", "grep", "find"] },
			"isolated package installation must activate only the refuter inspection tools",
		);
		const installedRefuterSource = await readFile(installedRefuterPath, "utf8");
		assert.match(installedRefuterSource, /complete inferential-severe frozen-row list once/);
		assert.match(installedRefuterSource, /refuted \| corroborated \| inconclusive/);
		assert.doesNotMatch(installedRefuterSource, /general, correctness, impact\/exploitability, or reproducibility/);
		const installedRiskSource = await readFile(
			join(globalAgentHome, "agents", "review-risk.md"),
			"utf8",
		);
		assert.match(installedRiskSource, /exactly once against the supplied `initial_review_tree`/);
		assert.match(installedRiskSource, /cannot authorize transitions, fixes, receipts, gates, or delivery/);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "gentle-ai", "support", "sdd-status-contract.md")), true);
		const managedAssetsManifestPath = join(globalAgentHome, "gentle-ai", "managed-assets.json");
		const managedAssetsManifest = JSON.parse(
			await readFile(managedAssetsManifestPath, "utf8"),
		);
		const previousManagedApply = "stale global apply\n";
		const previousManagedChain = "stale global chain\n";
		const previousManagedSupport = "stale global status contract\n";
		await writeFile(join(globalAgentHome, "agents", "sdd-apply.md"), previousManagedApply);
		managedAssetsManifest.assets["agents/sdd-apply.md"] = sha256(previousManagedApply);
		const samePathUserRefuter = [
			"---",
			"name: review-refuter",
			"tools:",
			"  - read",
			"  - bash",
			"---",
			"user-owned runtime policy",
			"",
		].join("\n");
		await writeFile(installedRefuterPath, samePathUserRefuter);
		delete managedAssetsManifest.assets["agents/review-refuter.md"];
		await mkdir(join(globalAgentHome, "subagents"), { recursive: true });
		const userRefuterOverride = join(globalAgentHome, "subagents", "review-refuter.md");
		await writeFile(userRefuterOverride, "user refuter override must stay\n");
		await writeFile(join(globalAgentHome, "chains", "sdd-full.chain.md"), previousManagedChain);
		managedAssetsManifest.assets["chains/sdd-full.chain.md"] = sha256(previousManagedChain);
		await writeFile(join(globalAgentHome, "gentle-ai", "support", "sdd-status-contract.md"), previousManagedSupport);
		managedAssetsManifest.assets["gentle-ai/support/sdd-status-contract.md"] = sha256(previousManagedSupport);
		await writeFile(
			managedAssetsManifestPath,
			JSON.stringify(managedAssetsManifest, null, 2),
		);
		await mkdir(join(noUiCwd, ".pi", "agents"), { recursive: true });
		await writeFile(join(noUiCwd, ".pi", "agents", "sdd-apply.md"), "project override must stay\n");
		const projectRefuterOverride = join(noUiCwd, ".pi", "agents", "review-refuter.md");
		await writeFile(projectRefuterOverride, "project refuter override must stay\n");
		for (const handler of hooks.get("session_start")) {
			await handler({ reason: "startup" }, createCtx(noUiCwd, false));
		}
		assert.notEqual(
			await readFile(join(globalAgentHome, "agents", "sdd-apply.md"), "utf8"),
			"stale global apply\n",
			"session_start must refresh stale global SDD agents",
		);
		assert.equal(
			await readFile(installedRefuterPath, "utf8"),
			samePathUserRefuter,
			"session refresh must preserve a same-path user-authored agent byte-for-byte",
		);
		assert.notEqual(
			await readFile(join(globalAgentHome, "chains", "sdd-full.chain.md"), "utf8"),
			"stale global chain\n",
			"session_start must refresh stale global SDD chains",
		);
		assert.notEqual(
			await readFile(join(globalAgentHome, "gentle-ai", "support", "sdd-status-contract.md"), "utf8"),
			"stale global status contract\n",
			"session_start must refresh stale global SDD support files",
		);
		assert.equal(
			await readFile(join(noUiCwd, ".pi", "agents", "sdd-apply.md"), "utf8"),
			"project override must stay\n",
			"session_start must not overwrite project-local SDD overrides",
		);
		assert.equal(
			await readFile(projectRefuterOverride, "utf8"),
			"project refuter override must stay\n",
			"package refresh must not rewrite or certify an explicit project refuter",
		);
		assert.equal(
			await readFile(userRefuterOverride, "utf8"),
			"user refuter override must stay\n",
			"package refresh must not rewrite or certify an explicit user refuter",
		);
	} finally {
		await rm(noUiCwd, { recursive: true, force: true });
	}

	const lazySddCwd = await tempWorkspace();
	try {
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": { model: "openai/gpt-5", thinking: "high" } }, null, 2),
		);
		const ctx = createCtx(lazySddCwd, true);
		const inputHook = hooks.get("input")[0];
		assert.deepEqual(
			await inputHook({ text: "hola, solo mirando", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "what is SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "what can I do with SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "how do I use SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "Can I use SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "don't use sdd for this", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "sin usar SDD por ahora", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "let's not use SDD for this", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "never use SDD here", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "no quiero usar SDD por ahora", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "I use SDD sometimes", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "I'm using SDD in another repo", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), false);

		assert.deepEqual(
			await inputHook({ text: "vamos con sdd", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-status.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-sync.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "gentle-ai", "support", "sdd-status-contract.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		assert.equal(ctx.ui.selections.length, 3);
		assert.equal(ctx.ui.selections[0].label, "SDD execution mode");
		assert.equal(ctx.ui.selections[1].label, "SDD artifact store");
		assert.deepEqual(ctx.ui.selections[1].options, ["openspec"]);
		assert.equal(ctx.ui.selections[2].label, "SDD PR chaining");
		assert.match(ctx.ui.notifications.at(-1).message, /Preference source: user prompt/);
		assert.deepEqual(
			await inputHook({ text: "please use sdd for this change", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(ctx.ui.selections.length, 3, "natural SDD trigger should reuse session choices");
		assert.deepEqual(
			await inputHook({ text: "/sdd", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "/sdd plan", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "/sdd:plan", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(ctx.ui.selections.length, 3);

		assert.deepEqual(
			await inputHook({ text: "/sdd-plan this change", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-status.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-sync.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "gentle-ai", "support", "sdd-status-contract.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		const globalSddApply = await readFile(
			join(globalAgentHome, "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(globalSddApply, /model: openai\/gpt-5/);
		assert.match(globalSddApply, /thinking: high/);
		const lazySettingsPath = join(lazySddCwd, ".pi", "settings.json");
		if (existsSync(lazySettingsPath)) {
			const lazySettings = JSON.parse(await readFile(lazySettingsPath, "utf8"));
			assert.equal(
				lazySettings.subagents?.agentOverrides?.["sdd-apply"],
				undefined,
				"global SDD model routing must be materialized in agent frontmatter, not project settings overrides",
			);
		}
		assert.equal(ctx.ui.selections.length, 3);
		assert.deepEqual(ctx.ui.selections[1].options, ["openspec"]);
		assert.match(ctx.ui.notifications.at(-1).message, /SDD preflight complete/);
		await commands.get("gentle:status").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Global SDD assets stale: 0 file\(s\)/);
		assert.doesNotMatch(ctx.ui.notifications.at(-1).message, /install-sdd --force/);

		await inputHook({ text: "/sdd-plan another change", source: "interactive" }, ctx);
		assert.equal(ctx.ui.selections.length, 3, "preflight should run only once per session");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook({ systemPrompt: "base" }, ctx);
		assert.match(promptResult.systemPrompt, /SDD Session Preflight/);
		assert.match(promptResult.systemPrompt, /Execution mode: interactive/);
		const workerPromptResult = await promptHook(
			{ agentName: "worker", systemPrompt: "worker base" },
			ctx,
		);
		assert.equal(
			workerPromptResult.systemPrompt,
			"worker base",
			"non-SDD subagents must not receive parent harness or SDD preflight prompts",
		);
	} finally {
		await rm(lazySddCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	for (const [index, text] of ["/sdd", "/sdd plan", "/sdd:plan", "/sdd-plan this change"].entries()) {
		const slashSddCwd = await tempWorkspace();
		try {
			const ctx = createCtx(slashSddCwd, true, `slash-sdd-session-${index}`);
			const inputHook = hooks.get("input")[0];
			assert.deepEqual(await inputHook({ text, source: "interactive" }, ctx), {
				action: "continue",
			});
			assert.equal(existsSync(join(slashSddCwd, ".pi", "agents", "sdd-apply.md")), false);
			assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
			assert.equal(ctx.ui.selections.length, 3, `${text} should run canonical preflight`);
		} finally {
			await rm(slashSddCwd, { recursive: true, force: true });
		}
	}

	const commandSddCwd = await tempWorkspace();
	try {
		const ctx = createCtx(commandSddCwd, true, "command-session");
		await commands.get("gentle:sdd-preflight").handler("", ctx);
		assert.equal(existsSync(join(commandSddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(ctx.ui.selections.length, 3);
		await commands.get("gentle:sdd-preflight").handler("", ctx);
		assert.equal(ctx.ui.selections.length, 3, "manual preflight command should reuse session choices");
	} finally {
		await rm(commandSddCwd, { recursive: true, force: true });
	}

	const sddAgentGuardCwd = await tempWorkspace();
	try {
		const ctx = createCtx(sddAgentGuardCwd, true, "sdd-agent-guard-session");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook(
			{
				systemPrompt: "You are the SDD proposal executor for Gentle AI.",
			},
			ctx,
		);
		assert.equal(existsSync(join(sddAgentGuardCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(sddAgentGuardCwd, ".pi", "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		assert.equal(ctx.ui.selections.length, 3);
		assert.match(promptResult.systemPrompt, /SDD Session Preflight/);
		assert.doesNotMatch(
			promptResult.systemPrompt,
			/el Gentleman Identity and Harness/,
			"SDD executor startup must not receive the parent orchestrator prompt",
		);
		assert.doesNotMatch(
			promptResult.systemPrompt,
			/Work Routing Ladder/,
			"SDD executor startup must not receive parent routing instructions",
		);
		assert.match(ctx.ui.notifications.at(-1).message, /SDD preflight complete/);

		const reusedPromptResult = await promptHook(
			{
				agentName: "sdd-tasks",
				systemPrompt: "You are the SDD tasks executor for Gentle AI.",
			},
			ctx,
		);
		assert.equal(ctx.ui.selections.length, 3, "SDD agent guard should reuse session choices");
		assert.doesNotMatch(
			reusedPromptResult.systemPrompt,
			/el Gentleman Identity and Harness/,
			"named SDD executor startup must not receive the parent orchestrator prompt",
		);
	} finally {
		await rm(sddAgentGuardCwd, { recursive: true, force: true });
	}

	const noUiSddAgentCwd = await tempWorkspace();
	try {
		const ctx = createCtx(noUiSddAgentCwd, false, "no-ui-sdd-agent-session");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook(
			{
				agentName: "sdd-proposal",
				systemPrompt: "You are the SDD proposal executor for Gentle AI.",
			},
			ctx,
		);
		assert.match(promptResult.systemPrompt, /SDD Session Preflight/);
		assert.match(promptResult.systemPrompt, /No interactive UI was available/);
		assert.equal(ctx.ui.selections.length, 0);
		assert.equal(existsSync(join(noUiSddAgentCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
	} finally {
		await rm(noUiSddAgentCwd, { recursive: true, force: true });
	}

	const invalidPreflightCwd = await tempWorkspace();
	try {
		await writeFile(globalModelsPath, "{ invalid json");
		const ctx = createCtx(invalidPreflightCwd, true, "invalid-preflight-session");
		await commands.get("gentle:sdd-preflight").handler("", ctx);
		assert.equal(ctx.ui.notifications.at(-1).level, "warning");
		assert.match(ctx.ui.notifications.at(-1).message, /Model routing skipped:/);
		assert.match(ctx.ui.notifications.at(-1).message, /invalid JSON or not an object/);
	} finally {
		await rm(invalidPreflightCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const engramSddCwd = await tempWorkspace();
	try {
		pi.setActiveTools(["read", "bash", "edit", "write", "mem_save"]);
		const ctx = createCtx(engramSddCwd, true, "engram-session");
		await commands.get("gentle:sdd-preflight").handler("", ctx);
		assert.deepEqual(ctx.ui.selections[1].options, ["openspec", "engram", "both"]);
	} finally {
		pi.setActiveTools(["read", "bash", "edit", "write"]);
		await rm(engramSddCwd, { recursive: true, force: true });
	}

	const directEngramToolCwd = await tempWorkspace();
	try {
		pi.setActiveTools(["read", "bash", "edit", "write", "engram_mem_save"]);
		const ctx = createCtx(directEngramToolCwd, true, "direct-engram-session");
		await commands.get("gentle:sdd-preflight").handler("", ctx);
		assert.deepEqual(ctx.ui.selections[1].options, ["openspec"]);
	} finally {
		pi.setActiveTools(["read", "bash", "edit", "write"]);
		await rm(directEngramToolCwd, { recursive: true, force: true });
	}

	const installCwd = await tempWorkspace();
	try {
		const ctx = createCtx(installCwd, true);
		await commands.get("gentle:install-sdd").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Global Gentle AI SDD assets installed/);
		assert.equal(existsSync(join(installCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-status.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "gentle-ai", "support", "sdd-status-contract.md")), true);
	} finally {
		await rm(installCwd, { recursive: true, force: true });
	}

	const staleAssetsCwd = await tempWorkspace();
	try {
		await mkdir(join(staleAssetsCwd, ".pi", "agents"), { recursive: true });
		await mkdir(join(staleAssetsCwd, ".pi", "chains"), { recursive: true });
		await mkdir(join(staleAssetsCwd, ".pi", "gentle-ai", "support"), { recursive: true });
		await writeFile(join(staleAssetsCwd, ".pi", "agents", "sdd-apply.md"), "stale apply\n");
		await writeFile(join(staleAssetsCwd, ".pi", "agents", "sdd-spec.md"), "stale spec\n");
		await writeFile(join(staleAssetsCwd, ".pi", "agents", "sdd-custom-debug.md"), "custom debug agent\n");
		await writeFile(join(staleAssetsCwd, ".pi", "chains", "sdd-full.chain.md"), "stale chain\n");
		await writeFile(join(staleAssetsCwd, ".pi", "gentle-ai", "support", "sdd-status-contract.md"), "stale status contract\n");
		const ctx = createCtx(staleAssetsCwd, true);
		await commands.get("gentle:status").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Project-local SDD agent overrides: 2 file\(s\)/);
		assert.match(ctx.ui.notifications.at(-1).message, /local SDD agents shadow package assets/);
		await commands.get("gentle:doctor").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /el Gentleman doctor/);
		assert.match(ctx.ui.notifications.at(-1).message, /Sensitive-path guard active/);
		pi.setActiveTools([{ name: "engram.mem_save" }]);
		await commands.get("gentle:doctor").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Engram memory tools active/);
		pi.setActiveTools([{ name: "engram_mem_save" }]);
		await commands.get("gentle:doctor").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Engram memory tools not active in this session/);
		pi.setActiveTools(["read", "bash", "edit", "write"]);
	} finally {
		await rm(staleAssetsCwd, { recursive: true, force: true });
	}

	const sddCwd = await tempWorkspace();
	try {
		const ctx = createCtx(sddCwd, true);
		await commands.get("sdd-init").handler("", ctx);
		assert.equal(existsSync(join(sddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(sddCwd, ".pi", "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-status.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-sync.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "gentle-ai", "support", "sdd-status-contract.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		assert.equal(ctx.ui.selections.length, 3);
		assert.match(ctx.ui.notifications[0].message, /SDD preflight complete/);
		assert.match(ctx.ui.notifications.at(-1).message, /Wrote openspec\/config\.yaml/);

		await commands.get("gentle:sdd-preflight").handler("", ctx);
		assert.equal(ctx.ui.selections.length, 3, "/sdd-init preflight should be reused by later manual preflight");
	} finally {
		await rm(sddCwd, { recursive: true, force: true });
	}

	const invalidSddInitCwd = await tempWorkspace();
	try {
		await mkdir(join(invalidSddInitCwd, ".pi", "agents"), { recursive: true });
		await writeFile(
			join(invalidSddInitCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\nmodel: keep/provider-model\n---\n\nbody\n`,
		);
		await writeFile(globalModelsPath, "{ invalid json");
		const ctx = createCtx(invalidSddInitCwd, true, "invalid-sdd-init-session");
		await commands.get("sdd-init").handler("", ctx);
		assert.equal(ctx.ui.notifications[0].level, "warning");
		assert.match(ctx.ui.notifications[0].message, /Model routing skipped:/);
		assert.match(ctx.ui.notifications[0].message, /models\.json/);
		assert.match(ctx.ui.notifications.at(-1).message, /Wrote openspec\/config\.yaml/);
		const preservedAgent = await readFile(
			join(invalidSddInitCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(preservedAgent, /model: keep\/provider-model/);
	} finally {
		await rm(invalidSddInitCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const legacyModelsCwd = await tempWorkspace();
	try {
		await mkdir(join(legacyModelsCwd, ".pi", "agents"), { recursive: true });
		await mkdir(join(legacyModelsCwd, ".pi", "gentle-ai"), { recursive: true });
		await writeFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\n---\n\nbody\n`,
		);
		await writeFile(
			join(legacyModelsCwd, ".pi", "gentle-ai", "models.json"),
			JSON.stringify({ "sdd-apply": "legacy/provider-model" }, null, 2),
		);
		const legacyCtx = createCtx(legacyModelsCwd, true);
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const legacyAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(legacyAgent, /model: legacy\/provider-model/);
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": "global/provider-model" }, null, 2),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const globalWinsAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(globalWinsAgent, /model: global\/provider-model/);
		assert.doesNotMatch(globalWinsAgent, /model: legacy\/provider-model/);
		await writeFile(globalModelsPath, "{ invalid json");
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const invalidGlobalSkippedAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(invalidGlobalSkippedAgent, /model: global\/provider-model/);
		assert.doesNotMatch(invalidGlobalSkippedAgent, /model: legacy\/provider-model/);
		assert.equal(legacyCtx.ui.notifications.at(-1).level, "warning");
		assert.match(legacyCtx.ui.notifications.at(-1).message, /skipped model config/);
		let modelPanelOpened = false;
		legacyCtx.ui.custom = () => {
			modelPanelOpened = true;
			return Promise.resolve({ type: "save", config: {} });
		};
		await commands.get("gentle:models").handler("", legacyCtx);
		assert.equal(modelPanelOpened, false);
		assert.equal(await readFile(globalModelsPath, "utf8"), "{ invalid json");
		assert.equal(legacyCtx.ui.notifications.at(-1).level, "warning");
		assert.match(legacyCtx.ui.notifications.at(-1).message, /cannot open model config/);
		await writeFile(globalModelsPath, JSON.stringify({}, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const emptyGlobalPreservesAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(emptyGlobalPreservesAgent, /model: global\/provider-model/);
		const emptyGlobalPreservesProfiles = JSON.parse(
			await readFile(join(legacyModelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(
			emptyGlobalPreservesProfiles.model_profiles["sdd-apply"].model,
			"global/provider-model",
		);
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": { model: "bad\nmodel: injected" } }, null, 2),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const invalidEntryPreservesAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(invalidEntryPreservesAgent, /model: global\/provider-model/);
		const invalidEntryPreservesProfiles = JSON.parse(
			await readFile(join(legacyModelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(
			invalidEntryPreservesProfiles.model_profiles["sdd-apply"].model,
			"global/provider-model",
		);
		await writeFile(globalModelsPath, JSON.stringify({ "sdd-apply": {} }, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const explicitInheritClearsAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.doesNotMatch(explicitInheritClearsAgent, /model:/);
		const explicitInheritClearsProfiles = JSON.parse(
			await readFile(join(legacyModelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(explicitInheritClearsProfiles.model_profiles, undefined);
	} finally {
		await rm(legacyModelsCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const staleSettingsOnlyCwd = await tempWorkspace();
	try {
		await writeFile(
			globalSubagentsPath,
			JSON.stringify(
				{
					model_profiles: {
						worker: { model: "stale/model", effort: "high" },
					},
				},
				null,
				2,
			),
		);
		await writeFile(globalModelsPath, JSON.stringify({ worker: {} }, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(staleSettingsOnlyCwd, true));
		const staleOnlyClearedProfiles = JSON.parse(
			await readFile(globalSubagentsPath, "utf8"),
		);
		assert.equal(staleOnlyClearedProfiles.model_profiles, undefined);
	} finally {
		await rm(staleSettingsOnlyCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
		await rm(globalSubagentsPath, { force: true });
	}

	const legacySettingsMigrationCwd = await tempWorkspace();
	try {
		await mkdir(join(legacySettingsMigrationCwd, ".pi", "subagents"), { recursive: true });
		await mkdir(join(globalAgentHome, "subagents"), { recursive: true });
		await writeFile(
			join(legacySettingsMigrationCwd, ".pi", "subagents", "local-worker.md"),
			`---\nname: local-worker\ndescription: Local worker\n---\n`,
		);
		await writeFile(
			join(legacySettingsMigrationCwd, ".pi", "subagents", "local-new.md"),
			`---\nname: local-new\ndescription: Local new worker\n---\n`,
		);
		await writeFile(
			join(globalAgentHome, "subagents", "global-worker.md"),
			`---\nname: global-worker\ndescription: Global worker\n---\n`,
		);
		await writeFile(
			join(globalAgentHome, "subagents", "global-new.md"),
			`---\nname: global-new\ndescription: Global new worker\n---\n`,
		);
		await writeFile(
			join(legacySettingsMigrationCwd, ".pi", "subagents.json"),
			JSON.stringify({ model_profiles: { "local-worker": { model: "existing/local", effort: "medium" } } }, null, 2),
		);
		await writeFile(
			globalSubagentsPath,
			JSON.stringify({ model_profiles: { "global-worker": { model: "existing/global", effort: "medium" } } }, null, 2),
		);
		await writeFile(
			join(legacySettingsMigrationCwd, ".pi", "settings.json"),
			JSON.stringify(
				{
					theme: "keep-me",
					subagents: {
						history: "keep-me-too",
						agentOverrides: {
							"local-worker": {},
							"local-new": { model: "local/new-model", thinking: "minimal" },
							"global-worker": {},
							"global-new": { model: "global/new-model", thinking: "xhigh" },
							"unknown-project": { model: "unknown/project-model", thinking: "low" },
						},
					},
				},
				null,
				2,
			),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(legacySettingsMigrationCwd, true));
		const migratedProjectProfiles = JSON.parse(
			await readFile(join(legacySettingsMigrationCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(migratedProjectProfiles.model_profiles["local-worker"].model, "existing/local");
		assert.equal(migratedProjectProfiles.model_profiles["local-worker"].effort, "medium");
		assert.equal(migratedProjectProfiles.model_profiles["local-new"].model, "local/new-model");
		assert.equal(migratedProjectProfiles.model_profiles["local-new"].effort, "minimal");
		assert.equal(migratedProjectProfiles.model_profiles["unknown-project"].model, "unknown/project-model");
		assert.equal(migratedProjectProfiles.model_profiles["unknown-project"].effort, "low");
		const migratedGlobalProfiles = JSON.parse(await readFile(globalSubagentsPath, "utf8"));
		assert.equal(migratedGlobalProfiles.model_profiles["global-worker"].model, "existing/global");
		assert.equal(migratedGlobalProfiles.model_profiles["global-worker"].effort, "medium");
		assert.equal(migratedGlobalProfiles.model_profiles["global-new"].model, "global/new-model");
		assert.equal(migratedGlobalProfiles.model_profiles["global-new"].effort, "xhigh");
		const migratedSettings = JSON.parse(
			await readFile(join(legacySettingsMigrationCwd, ".pi", "settings.json"), "utf8"),
		);
		assert.equal(migratedSettings.theme, "keep-me");
		assert.equal(migratedSettings.subagents.history, "keep-me-too");
		assert.equal(migratedSettings.subagents.agentOverrides, undefined);
	} finally {
		await rm(legacySettingsMigrationCwd, { recursive: true, force: true });
		await rm(globalSubagentsPath, { force: true });
	}

	const invalidMigrationTargetCwd = await tempWorkspace();
	try {
		await mkdir(join(invalidMigrationTargetCwd, ".pi", "subagents"), { recursive: true });
		await writeFile(
			join(invalidMigrationTargetCwd, ".pi", "subagents", "local-bad.md"),
			`---\nname: local-bad\ndescription: Local bad target\n---\n`,
		);
		await mkdir(join(globalAgentHome, "subagents"), { recursive: true });
		await writeFile(
			join(globalAgentHome, "subagents", "global-bad.md"),
			`---\nname: global-bad\ndescription: Global bad target\n---\n`,
		);
		await writeFile(join(invalidMigrationTargetCwd, ".pi", "subagents.json"), "{ invalid json");
		await writeFile(globalSubagentsPath, "{ invalid global json");
		await writeFile(
			join(invalidMigrationTargetCwd, ".pi", "settings.json"),
			JSON.stringify({ subagents: { agentOverrides: { "local-bad": { model: "legacy/model", thinking: "low" }, "global-bad": { model: "legacy/global-model", thinking: "high" } } } }, null, 2),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(invalidMigrationTargetCwd, true));
		assert.equal(await readFile(join(invalidMigrationTargetCwd, ".pi", "subagents.json"), "utf8"), "{ invalid json");
		assert.equal(await readFile(globalSubagentsPath, "utf8"), "{ invalid global json");
		const preservedLegacySettings = JSON.parse(
			await readFile(join(invalidMigrationTargetCwd, ".pi", "settings.json"), "utf8"),
		);
		assert.equal(preservedLegacySettings.subagents.agentOverrides["local-bad"].model, "legacy/model");
		assert.equal(preservedLegacySettings.subagents.agentOverrides["global-bad"].model, "legacy/global-model");
	} finally {
		await rm(invalidMigrationTargetCwd, { recursive: true, force: true });
		await rm(globalSubagentsPath, { force: true });
	}

	const modelsCwd = await tempWorkspace();
	try {
		await mkdir(join(modelsCwd, ".pi", "agents"), { recursive: true });
		await mkdir(join(modelsCwd, ".pi", "subagents"), { recursive: true });
		await mkdir(join(globalAgentHome, "subagents"), { recursive: true });
		await mkdir(
			join(modelsCwd, ".pi", "npm", "node_modules", "pi-subagents-j0k3r", "agents"),
			{ recursive: true },
		);
		await mkdir(
			join(modelsCwd, ".pi", "npm", "node_modules", "pi-subagents", "agents"),
			{ recursive: true },
		);
		await writeFile(
			join(
				modelsCwd,
				".pi",
				"npm",
				"node_modules",
				"pi-subagents-j0k3r",
				"agents",
				"worker.md",
			),
			`---\nname: worker\ndescription: Builtin worker\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "agents", "worker.md"),
			`---\nname: worker\ndescription: Project worker\nmodel: existing/project-worker\nthinking: high\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "subagents", "worker.md"),
			`---\nname: worker\ndescription: Project subagents worker\nmodel: existing/project-subagent-worker\nthinking: medium\n---\n`,
		);
		await writeFile(
			join(
				modelsCwd,
				".pi",
				"npm",
				"node_modules",
				"pi-subagents",
				"agents",
				"researcher.md",
			),
			`---\nname: researcher\ndescription: Legacy builtin researcher\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\n---\n\nbody\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "subagents", "project-special.md"),
			`---\nname: project-special\ndescription: Project subagent dir fixture\n---\n\nbody\n`,
		);
		await writeFile(
			join(globalAgentHome, "subagents", "global-special.md"),
			`---\nname: global-special\ndescription: Global subagent dir fixture\n---\n\nbody\n`,
		);
		for (let i = 0; i < 25; i++) {
			const name = `large-agent-${String(i).padStart(2, "0")}`;
			await writeFile(
				join(modelsCwd, ".pi", "agents", `${name}.md`),
				`---\nname: ${name}\ndescription: Scroll fixture\n---\n`,
			);
		}
		await writeFile(
			join(modelsCwd, ".pi", "agents", "escape-agent.md"),
			`---\nname: evil\u001b]52;c;Zm9v\u0007-agent\ndescription: Escape fixture\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "subagents.json"),
			JSON.stringify(
				{
					model_profiles: {
						worker: { model: "existing/model", effort: "high" },
					},
				},
				null,
				2,
			),
		);
		await writeFile(globalModelsPath, JSON.stringify({}, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(modelsCwd, true));
		const preservedProfiles = JSON.parse(
			await readFile(join(modelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(
			preservedProfiles.model_profiles.worker.model,
			"existing/model",
		);
		assert.equal(preservedProfiles.model_profiles.worker.effort, "high");
		const preservedProjectWorker = await readFile(
			join(modelsCwd, ".pi", "agents", "worker.md"),
			"utf8",
		);
		assert.match(preservedProjectWorker, /model: existing\/project-worker/);
		assert.match(preservedProjectWorker, /thinking: high/);
		const preservedProjectSubagentWorker = await readFile(
			join(modelsCwd, ".pi", "subagents", "worker.md"),
			"utf8",
		);
		assert.match(preservedProjectSubagentWorker, /model: existing\/project-subagent-worker/);
		assert.match(preservedProjectSubagentWorker, /thinking: medium/);
		await writeFile(globalModelsPath, JSON.stringify({ worker: {} }, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(modelsCwd, true));
		const clearedProfiles = JSON.parse(
			await readFile(join(modelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(clearedProfiles.model_profiles, undefined);
		const unchangedProjectWorker = await readFile(
			join(modelsCwd, ".pi", "agents", "worker.md"),
			"utf8",
		);
		assert.match(unchangedProjectWorker, /model: existing\/project-worker/);
		assert.match(unchangedProjectWorker, /thinking: high/);
		const clearedProjectSubagentWorker = await readFile(
			join(modelsCwd, ".pi", "subagents", "worker.md"),
			"utf8",
		);
		assert.doesNotMatch(clearedProjectSubagentWorker, /model:/);
		assert.doesNotMatch(clearedProjectSubagentWorker, /thinking:/);

		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": "openai/gpt-5" }, null, 2),
		);

		const ctx = createCtx(modelsCwd, true);
		ctx.modelRegistry.getAvailable = async () => [
			{ provider: "safe", id: "model" },
			{ provider: "evil\u001b]52;c;Zm9v\u0007", id: "model" },
		];
		ctx.ui.custom = (factory) => {
			const panel = factory(null, null, null, () => undefined);
			const initialLines = panel.render(120);
			const plainInitialLines = initialLines.map(stripAnsi);
			assert.ok(
				plainInitialLines[0].startsWith("╭") && plainInitialLines.at(-1).startsWith("╰"),
				"model panel should render inside a bordered card",
			);
			assert.ok(
				initialLines.length <= 20,
				"long model agent list should fit within a 24-row terminal 85% overlay budget",
			);
			assert.ok(
				plainInitialLines.some((line) => /↓ \d+ more agent\(s\)/.test(line)),
				"long model agent list should render a down-scroll indicator",
			);
			assert.ok(
				plainInitialLines.some((line) => line.includes("Continue")),
				"long model agent list should keep Continue visible",
			);
			assert.doesNotMatch(
				initialLines.join("\n"),
				/\u001b\]|\u0007/,
				"model panel must strip unsafe terminal control sequences from agent labels",
			);
			assert.doesNotMatch(
				plainInitialLines.join("\n"),
				/\]52|\[31m/,
				"model panel must strip user-provided terminal escapes from labels",
			);
			for (let i = 0; i < 20; i++) panel.handleInput("j");
			const scrolledLines = panel.render(120);
			const plainScrolledLines = scrolledLines.map(stripAnsi);
			assert.ok(
				scrolledLines.length <= 20,
				"scrolled model agent list should stay within the overlay height budget",
			);
			assert.ok(
				plainScrolledLines.some((line) => /↑ \d+ more agent\(s\)/.test(line)),
				"long model agent list should render an up-scroll indicator after navigation",
			);
			panel.handleInput("G");
			const bottomLines = panel.render(120);
			const plainBottomLines = bottomLines.map(stripAnsi);
			assert.ok(
				bottomLines.length <= 20,
				"bottom model agent list should stay within the overlay height budget",
			);
			assert.ok(
				plainBottomLines.some((line) => line.includes("▸ ← Back")),
				"G should jump to the Back action",
			);
			return Promise.resolve({ type: "cancel" });
		};
		await commands.get("gentle:models").handler("", ctx);

		await hooks.get("session_start")[0]({ reason: "startup" }, ctx);
		const legacyAppliedAgent = await readFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(legacyAppliedAgent, /model: openai\/gpt-5/);
		assert.doesNotMatch(legacyAppliedAgent, /thinking:/);

		ctx.ui.custom = () =>
			Promise.resolve({
				type: "save",
				config: {
					"sdd-apply": { model: "openai/gpt-5", thinking: "high" },
					worker: { model: "openai/gpt-5-mini", thinking: "low" },
					researcher: { model: "openai/gpt-5-mini", thinking: "low" },
					"project-special": { model: "openai/gpt-5-mini", thinking: "low" },
					"global-special": { model: "openai/gpt-5-mini", thinking: "low" },
				},
			});
		await commands.get("gentle:models").handler("", ctx);
		assert.doesNotMatch(
			ctx.ui.notifications.at(-1).message,
			/[\u001b\u0007]/,
			"model save notification must strip terminal control sequences from discovered agent names",
		);

		const savedConfig = JSON.parse(
			await readFile(globalModelsPath, "utf8"),
		);
		assert.deepEqual(savedConfig["sdd-apply"], {
			model: "openai/gpt-5",
			thinking: "high",
		});
		assert.equal(
			existsSync(join(modelsCwd, ".pi", "gentle-ai", "models.json")),
			false,
			"/gentle:models must save model routing globally, not per project",
		);

		const applyAgent = await readFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(applyAgent, /model: openai\/gpt-5/);
		assert.match(applyAgent, /thinking: high/);

		const projectSubagents = JSON.parse(
			await readFile(join(modelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(
			projectSubagents.model_profiles["sdd-apply"].model,
			"openai/gpt-5",
		);
		assert.equal(projectSubagents.model_profiles["sdd-apply"].effort, "high");
		assert.equal(
			projectSubagents.model_profiles.worker.model,
			"openai/gpt-5-mini",
		);
		assert.equal(projectSubagents.model_profiles.worker.effort, "low");
		const routedProjectSubagentWorker = await readFile(
			join(modelsCwd, ".pi", "subagents", "worker.md"),
			"utf8",
		);
		assert.match(routedProjectSubagentWorker, /model: openai\/gpt-5-mini/);
		assert.match(routedProjectSubagentWorker, /thinking: low/);
		const shadowedProjectAgentWorker = await readFile(
			join(modelsCwd, ".pi", "agents", "worker.md"),
			"utf8",
		);
		assert.match(shadowedProjectAgentWorker, /model: existing\/project-worker/);
		assert.match(shadowedProjectAgentWorker, /thinking: high/);
		assert.equal(
			projectSubagents.model_profiles["project-special"].model,
			"openai/gpt-5-mini",
		);
		assert.equal(projectSubagents.model_profiles["project-special"].effort, "low");
		const globalSubagents = JSON.parse(await readFile(globalSubagentsPath, "utf8"));
		assert.equal(
			globalSubagents.model_profiles.researcher.model,
			"openai/gpt-5-mini",
		);
		assert.equal(globalSubagents.model_profiles.researcher.effort, "low");
		assert.equal(
			globalSubagents.model_profiles["global-special"].model,
			"openai/gpt-5-mini",
		);
		assert.equal(globalSubagents.model_profiles["global-special"].effort, "low");
		assert.equal(existsSync(join(modelsCwd, ".pi", "settings.json")), false);

		const kittyE = "\x1b[101u";
		assert.notEqual(kittyE, "e");
		assert.equal(matchesKey(kittyE, "e"), true);

		let customPanelCalls = 0;
		ctx.ui.input = async () => "custom/provider-model";
		ctx.ui.custom = (factory) =>
			new Promise((resolve) => {
				customPanelCalls += 1;
				const panel = factory(null, null, null, resolve);
				if (customPanelCalls === 1) {
					panel.handleInput(kittyE); // effort picker for all agents
					for (let i = 0; i < 4; i++) panel.handleInput("j"); // medium
					panel.handleInput("\r");
					panel.handleInput("c"); // custom model from the same unsaved draft
					return;
				}
				panel.handleInput("\u0013"); // ctrl+s saves the draft reopened after custom model input
			});
		await commands.get("gentle:models").handler("", ctx);

		const customSavedConfig = JSON.parse(
			await readFile(globalModelsPath, "utf8"),
		);
		assert.deepEqual(customSavedConfig["sdd-apply"], {
			model: "custom/provider-model",
			thinking: "medium",
		});

		let invalidCustomCalls = 0;
		ctx.ui.input = async () => "bad\nmodel: injected";
		ctx.ui.custom = (factory) =>
			new Promise((resolve) => {
				invalidCustomCalls += 1;
				const panel = factory(null, null, null, resolve);
				if (invalidCustomCalls === 1) {
					panel.handleInput("c");
					return;
				}
				panel.handleInput("\u001b");
			});
		await commands.get("gentle:models").handler("", ctx);
		assert.match(
			ctx.ui.notifications.at(-1).message,
			/Custom model id must be a single-line/,
		);
		const rejectedCustomConfig = JSON.parse(
			await readFile(globalModelsPath, "utf8"),
		);
		assert.deepEqual(rejectedCustomConfig["sdd-apply"], {
			model: "custom/provider-model",
			thinking: "medium",
		});

		let exportPanelCalls = 0;
		ctx.ui.custom = () => {
			exportPanelCalls += 1;
			return Promise.resolve(exportPanelCalls === 1 ? { type: "export", config: {} } : { type: "cancel" });
		};
		await commands.get("gentle:models").handler("", ctx);
		const exported = JSON.parse(await readFile(join(globalConfigHome, "models.export.json"), "utf8"));
		assert.equal(exported.kind, "gentle-pi.agent_model_routing");
		assert.equal(exported.version, 1);
		assert.deepEqual(exported.agents["sdd-apply"], {
			model: "custom/provider-model",
			thinking: "medium",
		});

		await writeFile(
			join(globalConfigHome, "models.export.json"),
			JSON.stringify({
				kind: "gentle-pi.agent_model_routing",
				version: 1,
				agents: { "sdd-apply": { model: "restore/provider", thinking: "high" } },
			}, null, 2),
		);
		let restorePanelCalls = 0;
		ctx.ui.confirm = async () => true;
		ctx.ui.custom = () => {
			restorePanelCalls += 1;
			return Promise.resolve(restorePanelCalls === 1 ? { type: "restore", config: {} } : { type: "cancel" });
		};
		await commands.get("gentle:models").handler("", ctx);
		const restoredConfig = JSON.parse(await readFile(globalModelsPath, "utf8"));
		assert.deepEqual(restoredConfig["sdd-apply"], {
			model: "restore/provider",
			thinking: "high",
		});
		const restoredAgent = await readFile(join(modelsCwd, ".pi", "agents", "sdd-apply.md"), "utf8");
		assert.match(restoredAgent, /model: restore\/provider/);
		assert.match(restoredAgent, /thinking: high/);
	} finally {
		await rm(modelsCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
		await rm(globalSubagentsPath, { force: true });
	}

	const registryCwd = await tempWorkspace();
	try {
		const ctx = createCtx(registryCwd, true);
		await commands.get("skill-registry:refresh").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Skill registry:/);
	} finally {
		await rm(registryCwd, { recursive: true, force: true });
	}
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
