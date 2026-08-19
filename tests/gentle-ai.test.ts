import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../extensions/gentle-ai.ts";
import { GATE_TARGET_KIND } from "../lib/review-publication-gate.ts";
import {
	REVIEW_MODE,
	REVIEW_TRANSITION,
	ReviewTransactionStore,
	createReceiptForState,
	createReviewState,
	type ReviewBudgetV1,
} from "../lib/review-transaction.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { qualifiedReviewLockPlatform, testSnapshot } from "./review-test-fixtures.ts";

function writeMarkdown(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

test("agent discovery skips skills directories", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-agents-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dotAgents = join(root, ".agents");
	writeMarkdown(join(dotAgents, "review-risk.md"), "name: review-risk\n");
	writeMarkdown(join(dotAgents, "team", "worker.md"), "name: worker\n");
	writeMarkdown(join(dotAgents, "skills", "ai-sdk", "SKILL.md"), "name: ai-sdk\n");
	writeMarkdown(
		join(dotAgents, "skills", "ai-sdk", "references", "evaluation.md"),
		"name: Prompt Evaluation\n",
	);

	const syncAgents = __testing.listAgentsFromDir(dotAgents, "user");
	const asyncAgents = await __testing.listAgentsFromDirAsync(dotAgents, "user");

	assert.deepEqual(
		syncAgents.map((agent) => agent.name),
		["review-risk", "worker"],
	);
	assert.deepEqual(
		asyncAgents.map((agent) => agent.name),
		["review-risk", "worker"],
	);
});

test("runtime guidance routes review intent to concrete lenses", () => {
	const guidedFiles = [
		"README.md",
		"assets/orchestrator.md",
		"skills/gentle-ai/SKILL.md",
	];
	const forbiddenGenericRoutes = [
		/fresh-context `reviewer`/,
		/fresh reviewer audits/,
		/reviewer fresh audits/,
		/run a fresh-context `reviewer`/,
	];

	for (const file of guidedFiles) {
		// orchestrator-lazy-diet: the 4R/Review Lens content is split between the
		// always-on core and `assets/orchestrator-delegation.md`. Only this one
		// loop entry is repointed to the core+delegation-ref union; README.md and
		// skills/gentle-ai/SKILL.md are unchanged single-file reads.
		const content =
			file === "assets/orchestrator.md"
				? readFileSync(file, "utf8") + readFileSync("assets/orchestrator-delegation.md", "utf8")
				: readFileSync(file, "utf8");
		assert.match(content, /Review Lens Selection|review lens/);
		assert.match(content, /review-risk/);
		assert.match(content, /review-reliability/);
		assert.match(content, /review-resilience/);
		assert.match(content, /review-readability/);
		for (const forbidden of forbiddenGenericRoutes) {
			assert.doesNotMatch(content, forbidden, `${file} must not route to generic reviewer`);
		}
	}
});

test("agent model discovery prioritizes SDD and Judgment Day agents", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-model-agents-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeMarkdown(join(root, "zeta.md"), "name: zeta\n");
	writeMarkdown(join(root, "jd-fix-agent.md"), "name: jd-fix-agent\n");
	writeMarkdown(join(root, "sdd-apply.md"), "name: sdd-apply\n");
	writeMarkdown(join(root, "alpha.md"), "name: alpha\n");
	writeMarkdown(join(root, "jd-judge-b.md"), "name: jd-judge-b\n");
	writeMarkdown(join(root, "sdd-init.md"), "name: sdd-init\n");
	writeMarkdown(join(root, "jd-judge-a.md"), "name: jd-judge-a\n");

	const discovered = __testing.listAgentsFromDir(root, "user");
	const ordered = __testing.orderDiscoverableAgents(discovered);

	assert.deepEqual(
		ordered.map((agent) => agent.name),
		[
			"sdd-init",
			"sdd-apply",
			"jd-judge-a",
			"jd-judge-b",
			"jd-fix-agent",
			"alpha",
			"zeta",
		],
	);
});

test("discoverable model agents include installed Judgment Day agents", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-installed-agents-"));
	const previousHome = process.env.GENTLE_PI_AGENT_HOME;
	process.env.GENTLE_PI_AGENT_HOME = root;
	t.after(() => {
		if (previousHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousHome;
		rmSync(root, { recursive: true, force: true });
	});
	writeMarkdown(join(root, "agents", "jd-judge-a.md"), "name: jd-judge-a\n");
	writeMarkdown(join(root, "agents", "jd-judge-b.md"), "name: jd-judge-b\n");
	writeMarkdown(join(root, "agents", "jd-fix-agent.md"), "name: jd-fix-agent\n");

	const discovered = __testing.listDiscoverableAgents(root).map((agent) => agent.name);

	assert.deepEqual(
		discovered.filter((name) => name.startsWith("jd-")),
		["jd-judge-a", "jd-judge-b", "jd-fix-agent"],
	);
});

test("model panel render does not auto-apply the Gentle theme and sanitizes agent labels", () => {
	const lines = __testing.renderSddModelPanel(
		{},
		["openai/gpt-5.5"],
		["safe-agent\x1b[31m"],
		72,
	);
	const rendered = lines.join("\n");
	const plain = stripAnsi(rendered);

	assert.doesNotMatch(rendered, /\x1b\[38;2;71;85;105m/);
	assert.doesNotMatch(rendered, /\x1b\[38;2;125;211;252m/);
	assert.match(plain, /Assign Models and Effort to Agents/);
	assert.match(plain, /safe-agent\s+model=inherit, effort=inherit/);
	assert.doesNotMatch(plain, /\[31m/);
});

test("model panel render uses the Pi-provided current theme when supplied", () => {
	const currentTheme = {
		fg(_color: string, text: string): string {
			return `\x1b[35m${text}\x1b[39m`;
		},
	} as unknown as Theme;

	const rendered = __testing
		.renderSddModelPanel({}, ["openai/gpt-5.5"], ["safe-agent"], 72, currentTheme)
		.join("\n");

	assert.match(rendered, /\x1b\[35m/);
	assert.match(stripAnsi(rendered), /Assign Models and Effort to Agents/);
});

function runtimeBudget(): ReviewBudgetV1 {
	return {
		review_batches: 1,
		review_actors: 1,
		refuter_batches: 1,
		fix_batches: 1,
		validator_runs: 1,
		final_verifications: 1,
		judgment_rounds: 0,
		judge_runs: 0,
	};
}

function runtimeAuthority(t: test.TestContext) {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-runtime-gate-"));
	const repository = join(parent, "repo");
	mkdirSync(repository);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const git = (...args: string[]): string =>
		execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	writeFileSync(join(repository, "app.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=Runtime Gate", "-c", "user.email=runtime@example.invalid", "commit", "-m", "base");
	const baseTree = git("rev-parse", "HEAD^{tree}");
	writeFileSync(join(repository, "app.ts"), "export const value = 2;\n");
	git("add", ".");
	git("-c", "user.name=Runtime Gate", "-c", "user.email=runtime@example.invalid", "commit", "-m", "final");
	const finalTree = git("rev-parse", "HEAD^{tree}");
	const store = ReviewTransactionStore.forRepository(repository, { mutationLockPlatform: qualifiedReviewLockPlatform() });
	store.create(createReviewState({
		lineageId: "runtime-approved",
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({
			baseTree,
			completeTree: finalTree,
			route: REVIEW_ROUTE.STANDARD,
			lenses: [REVIEW_LENS.READABILITY],
		}),
		evidenceHash: "b".repeat(64),
		budget: runtimeBudget(),
	}), "start-runtime-approved");
	for (const [transition, input, idempotencyKey] of [
		[REVIEW_TRANSITION.ORDINARY_DISCOVERY, { rows: [] }, "discover"],
		[REVIEW_TRANSITION.ORDINARY_EVIDENCE, { deterministicResults: [] }, "evidence"],
		[REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION, { passed: true }, "verify"],
	] as const) {
		store.runReducerOperation({
			lineageId: "runtime-approved",
			transition,
			idempotencyKey,
			input,
		});
	}
	return {
		repository,
		finalTree,
		receipt: createReceiptForState(store.read("runtime-approved")),
	};
}

test("runtime lifecycle gates reject fabricated metadata while compound and wrapper forms fail closed", async (t) => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	const handlers = new Map<string, ToolCallHandler>();
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");
	const authority = runtimeAuthority(t);
	const ctx = {
		cwd: authority.repository,
		hasUI: false,
	} as ExtensionContext;

	const fabricated = await toolCall!(
		{
			toolName: "bash",
			input: {
				command: "git commit -m bounded",
				reviewGate: {
					receipt: authority.receipt,
					target: {
						kind: GATE_TARGET_KIND.INTENDED_COMMIT,
						intended_commit_tree: authority.finalTree,
					},
					idempotencyKey: "runtime-commit",
					scopeBudget: runtimeBudget(),
				},
			},
		},
		ctx,
	);
	assert.equal(fabricated?.block, true);
	assert.match(fabricated?.reason ?? "", /registered review controller authorization/i);

	const lifecycle = await toolCall!(
		{ toolName: "bash", input: { command: "git commit -m bounded" } },
		ctx,
	);
	assert.equal(lifecycle?.block, true);
	assert.match(lifecycle?.reason ?? "", /approved receipt.*exact typed command target/i);
	for (const command of [
		"git status && git commit -m compound",
		"env SAFE=1 git commit -m wrapped",
		"command git commit -m wrapped",
		"sh -c 'git commit -m wrapped'",
		"git \\\n commit -m continued",
		`git -c safe.long=${"x".repeat(8_192)} commit -m long-direct`,
		`sh -c 'git -c safe.long=${"x".repeat(8_192)} commit -m long-wrapped'`,
	]) {
		const wrapped = await toolCall!({ toolName: "bash", input: { command } }, ctx);
		assert.equal(wrapped?.block, true, command);
		assert.match(wrapped?.reason ?? "", /compound or wrapped lifecycle command.*fail closed/i);
	}

	const destructive = await toolCall!(
		{ toolName: "bash", input: { command: "git push --force origin main" } },
		ctx,
	);
	assert.equal(destructive?.block, true);
	assert.match(destructive?.reason ?? "", /safety policy blocked a destructive shell command/i);
	assert.doesNotMatch(destructive?.reason ?? "", /approved receipt/i);
});

test("intercom project panes require one exact session-scoped authorization", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-pane-guard-"));
	const authorizedCwd = join(root, "authorized");
	const otherCwd = join(root, "other");
	mkdirSync(authorizedCwd);
	mkdirSync(otherCwd);
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const handlers = new Map<string, (...args: any[]) => unknown>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
	const notifications: Array<{ message: string; level: string }> = [];
	const pi = {
		on(name: string, handler: (...args: any[]) => unknown) {
			handlers.set(name, handler);
		},
		registerCommand(name: string, command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) {
			commands.set(name, command);
		},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);

	const toolCall = handlers.get("tool_call") as (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	const command = commands.get("gentle:allow-project-pane-once");
	assert.ok(command);
	const session = (id: string) => ({
		cwd: root,
		hasUI: true,
		sessionManager: { getSessionId: () => id },
		ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
	}) as unknown as ExtensionContext;
	const owner = session("owner-session");
	const otherSession = session("other-session");
	const paneCall = (action: "send" | "ask", cwd: unknown = authorizedCwd) => toolCall(
		{ toolName: "intercom", input: { action, cwd, openProjectPaneIfMissing: true } },
		owner,
	);

	for (const action of ["send", "ask"] as const) {
		const blocked = await paneCall(action);
		assert.equal(blocked?.block, true);
		assert.match(blocked?.reason ?? "", /allow-project-pane-once/i);
	}
	assert.equal(await toolCall({ toolName: "intercom", input: { action: "send", cwd: authorizedCwd, openProjectPaneIfMissing: false } }, owner), undefined);
	assert.equal(await toolCall({ toolName: "intercom", input: { action: "send", cwd: authorizedCwd } }, owner), undefined);
	assert.equal(await toolCall({ toolName: "intercom", input: { action: "list", openProjectPaneIfMissing: true } }, owner), undefined);
	assert.equal(await toolCall({ toolName: "read", input: { action: "send", cwd: authorizedCwd, openProjectPaneIfMissing: true } }, owner), undefined);
	for (const input of [
		{ action: "send", openProjectPaneIfMissing: true },
		{ action: "send", cwd: "", openProjectPaneIfMissing: true },
		{ action: "send", cwd: 42, openProjectPaneIfMissing: true },
	]) {
		const blocked = await toolCall({ toolName: "intercom", input }, owner);
		assert.equal(blocked?.block, true);
		assert.match(blocked?.reason ?? "", /cwd/i);
	}

	await command!.handler("", owner);
	await command!.handler("relative-path", owner);
	assert.match(notifications.at(-1)?.message ?? "", /absolute/i);
	await command!.handler(`${authorizedCwd}/.`, owner);
	assert.match(notifications.at(-1)?.message ?? "", /one intercom pane creation/i);
	assert.equal(await paneCall("send"), undefined);
	assert.equal((await paneCall("ask"))?.block, true, "authorization is consumed before execution");

	await command!.handler(authorizedCwd, owner);
	assert.equal(await paneCall("ask"), undefined, "one authorization also permits ask");
	assert.equal((await paneCall("send"))?.block, true, "ask consumes authorization before execution");

	await command!.handler(authorizedCwd, owner);
	assert.equal((await paneCall("send", otherCwd))?.block, true, "mismatched cwd remains blocked");
	assert.equal(await paneCall("send"), undefined, "mismatch does not consume matching authorization");

	await command!.handler(authorizedCwd, owner);
	const wrongSession = await toolCall(
		{ toolName: "intercom", input: { action: "send", cwd: authorizedCwd, openProjectPaneIfMissing: true } },
		otherSession,
	);
	assert.equal(wrongSession?.block, true);
	assert.equal(await paneCall("send"), undefined, "wrong session does not consume owner authorization");

	await command!.handler(authorizedCwd, owner);
	const shutdown = handlers.get("session_shutdown");
	assert.equal(typeof shutdown, "function");
	await shutdown!({}, owner);
	assert.equal((await paneCall("send"))?.block, true, "session shutdown invalidates authorization");
});

test("orchestrator policy forbids automatic pane fallbacks and documents the one-shot command", () => {
	const policy = readFileSync("assets/orchestrator-delegation.md", "utf8");
	const renderedPrompt = __testing.buildGentlePrompt("gentleman", process.cwd(), ["subagent_run"]);
	for (const content of [policy, renderedPrompt]) {
		assert.doesNotMatch(content, /openProjectPaneIfMissing\s*:\s*true/);
		assert.match(content, /never open.*visible.*pane.*automatic/i);
		assert.match(content, /gentle:allow-project-pane-once <cwd>/);
	}
});
