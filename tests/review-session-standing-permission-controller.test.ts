import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { NativeReviewConsentRequiredError, type NativeReviewCli } from "../lib/native-review-cli.ts";
import { decodeReviewConsentV3, type ReviewStatusV3 } from "../lib/review-integration-v2.ts";
import {
	HOST_REVIEW_SESSION_PERMISSION_LABEL,
	formatReviewConsentUi,
	presentReviewConsentUi,
} from "../lib/review-consent-ui.ts";

function consent() {
	const path = join(process.cwd(), "tests", "fixtures", "devbinary", "consent-v3.captured.json");
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	raw.agent = "pi";
	return decodeReviewConsentV3(raw, "pi");
}

test("host UI preserves the complete provider envelope and adds a separately owned third action", () => {
	const envelope = consent();
	const before = structuredClone(envelope.raw);
	const model = formatReviewConsentUi(envelope);
	assert.match(model.title, new RegExp(envelope.headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	for (const text of [envelope.reason, envelope.value, ...envelope.riskEvidence, envelope.offPath.note, envelope.offPath.command]) {
		assert.ok(model.title.includes(text), `missing provider text: ${text}`);
	}
	assert.equal(model.options.length, 3);
	for (const [index, choice] of envelope.choices.entries()) {
		assert.ok(model.options[index]!.includes(choice.label));
		assert.ok(model.options[index]!.includes(choice.effect));
	}
	assert.ok(model.options[2]!.includes(HOST_REVIEW_SESSION_PERMISSION_LABEL));
	assert.match(model.title, /The first two actions are provider-owned and apply only to this candidate/);
	assert.match(model.title, /The third action is owned by the Pi host/);
	assert.equal(envelope.choices.length, 2, "the decoded provider envelope must remain a two-choice contract");
	assert.deepEqual(envelope.raw, before, "formatting must not mutate or append to the provider envelope");
});

test("the real Pi Text primitive bounds every consent line at narrow terminal widths", () => {
	const model = formatReviewConsentUi(consent());
	for (const width of [1, 2, 8, 20, 40]) {
		for (const text of [model.title, ...model.options]) {
			const lines = new Text(text, 0, 0).render(width);
			assert.ok(lines.length > 0);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
		}
	}
});

test("selection maps only exact displayed actions and cancellation or UI failure stays unresolved", async () => {
	const envelope = consent();
	const model = formatReviewConsentUi(envelope);
	const selections = [model.options[0], model.options[1], model.options[2], undefined] as const;
	const expected = [
		{ kind: "provider", answer: "granted" },
		{ kind: "provider", answer: "declined" },
		{ kind: "host-session" },
		undefined,
	];
	for (let index = 0; index < selections.length; index += 1) {
		const ctx = { ui: { select: async () => selections[index] } } as unknown as ExtensionContext;
		assert.deepEqual(await presentReviewConsentUi(ctx, envelope), expected[index]);
	}
	const failed = { ui: { select: async () => { throw new Error("UI unavailable"); } } } as unknown as ExtensionContext;
	assert.equal(await presentReviewConsentUi(failed, envelope), undefined);
});

interface RegisteredTool {
	execute(id: string, parameters: unknown, signal: undefined, onUpdate: undefined, context: ExtensionContext): Promise<{ details: Record<string, unknown> }>;
}

interface RegisteredCommand {
	handler(args: string, context: ExtensionContext): Promise<void>;
}

interface RegisteredEvent {
	(event: unknown, context: ExtensionContext): Promise<unknown> | unknown;
}

function reviewRepository(t: test.TestContext): string {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-session-consent-")));
	t.after(() => {
		try { execFileSync("chmod", ["-R", "u+w", cwd], { stdio: "ignore" }); } catch { /* best effort */ }
		rmSync(cwd, { recursive: true, force: true });
	});
	execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "app.ts"], { cwd, stdio: "ignore" });
	execFileSync("git", ["-c", "user.name=Consent Test", "-c", "user.email=consent@example.invalid", "commit", "-m", "base"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	return cwd;
}

function startStatus(cwd: string): ReviewStatusV3 {
	const views = new CandidateViewRegistry();
	const candidate = views.create({ contributorRoot: cwd });
	try {
		return {
			contract: "gentle-ai.review-integration/v2",
			applicability: "unrelated",
			action: "start",
			replayability: "not_replayable",
			targetIdentity: `sha256:${"a".repeat(64)}`,
			projection: {
				schema: "gentle-ai.review-candidate-projection/v1",
				kind: "current-changes",
				projection: "workspace",
				baseTree: candidate.baseTree,
				initialReviewTree: candidate.candidateTree,
				currentCandidateTree: candidate.candidateTree,
				pathsDigest: `sha256:${"a".repeat(64)}`,
				paths: [...candidate.paths],
				intendedUntracked: [],
				intendedUntrackedProof: `sha256:${"a".repeat(64)}`,
				initialSnapshotIdentity: `sha256:${"a".repeat(64)}`,
				currentSnapshotIdentity: `sha256:${"a".repeat(64)}`,
			},
			candidates: [],
			raw: { schema: "gentle-ai.review-integration.status/v5" },
		} as unknown as ReviewStatusV3;
	} finally {
		views.cleanup(candidate.token);
	}
}

function piConsent() {
	const decoded = consent();
	return {
		...decoded,
		choices: decoded.choices.map((choice) => ({
			...choice,
			invocation: choice.invocation.replace(" --consent ", " --agent pi --consent "),
		})) as typeof decoded.choices,
	};
}

function controllerHarness(cwd: string, processEnv: NodeJS.ProcessEnv = {}, options: {
	now?: () => number;
	answerConsentError?: Error & { mutationOutcome?: "none" | "unknown" };
	startAction?: "created" | "resumed" | "replayed" | "closed" | "blocked-scope-action";
} = {}) {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommand>();
	const events = new Map<string, RegisteredEvent>();
	const answers: string[] = [];
	const permissionConsent = piConsent();
	const native = {
		reviewMode: async () => ({ operation: "status", scope: "clone", status: { global: "", cloneLocal: "", effective: "on", source: "default" } }),
		targetStatus: async () => startStatus(cwd),
		start: async () => { throw new NativeReviewConsentRequiredError(permissionConsent); },
		answerConsent: async (request: { answer: "granted" | "declined" }) => {
			answers.push(request.answer);
			if (options.answerConsentError !== undefined && answers.length === 1) throw options.answerConsentError;
			if (request.answer === "declined") return {
				kind: "declined",
				targetIdentity: permissionConsent.targetIdentity,
				projection: permissionConsent.projection,
				riskLevel: permissionConsent.riskLevel,
				changedFiles: permissionConsent.changedFiles,
				changedLines: permissionConsent.changedLines,
				consent: "declined_this_candidate",
				raw: { operation: "review/start", action: "declined", consent: "declined_this_candidate" },
			};
			const action = options.startAction ?? "closed";
			return { kind: "started", start: { lineageId: `lineage-${answers.length}`, state: action === "blocked-scope-action" ? "unreviewed" : "approved", riskLevel: "high", selectedLenses: [], changedFiles: 1, changedLines: 2, correctionBudget: 0, action, lensesRequired: false, riskReasons: [] } };
		},
	} as unknown as NativeReviewCli;
	createGentleAiExtension({ nativeReviewCli: native, candidateViews: new CandidateViewRegistry(), processEnv, now: options.now })({
		on(name: string, handler: RegisteredEvent) { events.set(name, handler); },
		registerCommand(name: string, definition: RegisteredCommand) { commands.set(name, definition); },
		registerTool(definition: RegisteredTool & { name: string }) { tools.set(definition.name, definition); },
		events: { emit() {} },
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	return { controller: controller!, answers, commands, events };
}

function interactiveContext(cwd: string, manager: object, select: (title: string, options: string[]) => Promise<string | undefined>, sessionId = "session-a"): ExtensionContext {
	return {
		cwd,
		mode: "tui",
		hasUI: true,
		sessionManager: Object.assign(manager, { getSessionId: () => sessionId }),
		ui: { select, notify() {}, setStatus() {}, theme: { fg: (_color: string, text: string) => text } },
	} as unknown as ExtensionContext;
}

test("the host third action grants current and next fresh candidate through answer-consent exactly once each", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd);
	const manager = {};
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => {
		prompts += 1;
		return options[2];
	});
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const first = (await runtime.controller.execute("first", start, undefined, undefined, ctx)).details;
	assert.equal(first.operation, "answer-consent");
	assert.deepEqual(runtime.answers, ["granted"]);
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	const second = (await runtime.controller.execute("second", start, undefined, undefined, ctx)).details;
	assert.equal(second.operation, "answer-consent");
	assert.deepEqual(runtime.answers, ["granted", "granted"]);
	assert.equal(prompts, 1, "the next fresh envelope consumes the host permission without another prompt");
});

test("provider grant and decline remain candidate-only and cancellation stores nothing", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd);
	const manager = {};
	const selections = [0, 1, undefined] as const;
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => {
		const selection = selections[prompts++];
		return selection === undefined ? undefined : options[selection];
	});
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	assert.equal(((await runtime.controller.execute("grant", start, undefined, undefined, ctx)).details.result as { lineage_id?: string }).lineage_id, "lineage-1");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	assert.equal((await runtime.controller.execute("decline", start, undefined, undefined, ctx)).details.outcome, "consent-declined-this-candidate");
	writeFileSync(join(cwd, "app.ts"), "export const value = 4;\n");
	const cancelled = (await runtime.controller.execute("cancel", start, undefined, undefined, ctx)).details;
	assert.equal(cancelled.outcome, "native-review-consent-required");
	assert.deepEqual(runtime.answers, ["granted", "declined"]);
	assert.equal(prompts, 3, "neither provider choice creates standing host permission");
});

test("explicit revocation ends the host grant without changing provider mode or authority", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd);
	const manager = {};
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => options[prompts++ === 0 ? 2 : 1]);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	await runtime.controller.execute("grant-session", start, undefined, undefined, ctx);
	const command = runtime.commands.get("gentle:review-session-permission");
	assert.ok(command);
	await command!.handler("revoke", ctx);
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-revoke", start, undefined, undefined, ctx);
	assert.equal(prompts, 2);
	assert.deepEqual(runtime.answers, ["granted", "declined"]);
});

test("reload shutdown preserves the grant, while nonreload shutdown revokes it", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd);
	const manager = {};
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => options[prompts++ === 0 ? 2 : 1]);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	await runtime.controller.execute("grant-session", start, undefined, undefined, ctx);
	const shutdown = runtime.events.get("session_shutdown");
	assert.ok(shutdown);
	await shutdown!({ reason: "reload" }, ctx);
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-reload", start, undefined, undefined, ctx);
	assert.equal(prompts, 1, "reload keeps the standing permission");
	await shutdown!({ reason: "new" }, ctx);
	writeFileSync(join(cwd, "app.ts"), "export const value = 4;\n");
	await runtime.controller.execute("after-new", start, undefined, undefined, ctx);
	assert.equal(prompts, 2, "new-session shutdown revokes the standing permission");
});

test("successful decoded native START action variants remain eligible for a host grant", async (t) => {
	const cwd = reviewRepository(t);
	let candidate = 3;
	for (const action of ["created", "resumed", "replayed", "closed"] as const) {
		const runtime = controllerHarness(cwd, {}, { startAction: action });
		let prompts = 0;
		const ctx = interactiveContext(cwd, {}, async (_title, options) => {
			prompts += 1;
			return options[2];
		}, `session-${action}`);
		const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
		await runtime.controller.execute(`${action}-grant`, start, undefined, undefined, ctx);
		writeFileSync(join(cwd, "app.ts"), `export const value = ${candidate++};\n`);
		await runtime.controller.execute(`${action}-next`, start, undefined, undefined, ctx);
		assert.equal(prompts, 1, `${action} must retain the successful decoded START grant variant`);
	}
});

test("blocked-scope-action never persists host permission", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd, {}, { startAction: "blocked-scope-action" });
	let prompts = 0;
	const ctx = interactiveContext(cwd, {}, async (_title, options) => options[prompts++ === 0 ? 2 : 1]);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const blocked = (await runtime.controller.execute("blocked-host-choice", start, undefined, undefined, ctx)).details;
	assert.equal((blocked.result as { action?: string }).action, "blocked-scope-action");
	assert.equal((blocked.result as { state?: string }).state, "unreviewed");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-blocked-scope", start, undefined, undefined, ctx);
	assert.equal(prompts, 2, "pending explicit scope action must leave the next candidate behind a fresh prompt");
	assert.deepEqual(runtime.answers, ["granted", "declined"]);
});

test("a stale consent result with contextual native status never arms host permission", async (t) => {
	const cwd = reviewRepository(t);
	let now = 0;
	const runtime = controllerHarness(cwd, {}, { now: () => now });
	const manager = {};
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => {
		prompts += 1;
		if (prompts === 1) {
			now = 10 * 60 * 1000 + 1;
			return options[2];
		}
		return options[1];
	});
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const stale = (await runtime.controller.execute("expired-host-choice", start, undefined, undefined, ctx)).details;
	assert.equal(stale.outcome, "consent-binding-stale");
	assert.equal(stale.native_invocation_attempted, false);
	assert.equal(typeof stale.result, "object", "native STATUS is contextual evidence, not a successful START result");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-stale", start, undefined, undefined, ctx);
	assert.equal(prompts, 2, "the next fresh consent envelope must still prompt after a stale contextual result");
	assert.deepEqual(runtime.answers, ["declined"]);
});

test("a failed consent invocation never arms host permission", async (t) => {
	const cwd = reviewRepository(t);
	const failure = Object.assign(new Error("provider start failed before mutation"), { mutationOutcome: "none" as const });
	const runtime = controllerHarness(cwd, {}, { answerConsentError: failure });
	let prompts = 0;
	const ctx = interactiveContext(cwd, {}, async (_title, options) => options[prompts++ === 0 ? 2 : 1]);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const failed = (await runtime.controller.execute("failed-host-choice", start, undefined, undefined, ctx)).details;
	assert.equal(failed.outcome, "native-operation-failed");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-error", start, undefined, undefined, ctx);
	assert.equal(prompts, 2, "a native error must leave the next candidate behind a fresh prompt");
	assert.deepEqual(runtime.answers, ["granted", "declined"]);
});

test("headless, child, explicit-workspace, and changed post-UI identity never use host permission", async (t) => {
	const cwd = reviewRepository(t);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	for (const [label, processEnv, makeContext, parameters] of [
		["headless", {}, () => ({ ...interactiveContext(cwd, {}, async () => { throw new Error("must not prompt"); }), mode: "print", hasUI: false }) as ExtensionContext, start],
		["child", { GENTLE_PI_AGENTS_CHILD: "1" }, () => interactiveContext(cwd, {}, async () => { throw new Error("must not prompt"); }), start],
		["explicit workspace", {}, () => interactiveContext(cwd, {}, async () => { throw new Error("must not prompt"); }), { ...start, workspaceRoot: cwd }],
	] as const) {
		const runtime = controllerHarness(cwd, processEnv);
		const result = (await runtime.controller.execute(label, parameters, undefined, undefined, makeContext())).details;
		assert.equal(result.outcome, "native-review-consent-required", label);
		assert.deepEqual(runtime.answers, [], label);
	}

	const runtime = controllerHarness(cwd);
	const manager = { sessionId: "before", getSessionId() { return this.sessionId; } };
	const ctx = {
		cwd,
		mode: "tui",
		hasUI: true,
		sessionManager: manager,
		ui: {
			select: async (_title: string, options: string[]) => { manager.sessionId = "after"; return options[2]; },
			notify() {},
			setStatus() {},
			theme: { fg: (_color: string, text: string) => text },
		},
	} as unknown as ExtensionContext;
	const switched = (await runtime.controller.execute("switched", start, undefined, undefined, ctx)).details;
	assert.equal(switched.outcome, "native-review-consent-required");
	assert.deepEqual(runtime.answers, []);
});
