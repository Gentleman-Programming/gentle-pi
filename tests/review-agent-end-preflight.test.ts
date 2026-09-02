import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import type { NativeReviewCli } from "../lib/native-review-cli.ts";
import type { ReviewStatusV3 } from "../lib/review-integration-v2.ts";

// gentle-pi#556 / gentle-ai#4051: with RDD enabled, the agent finished an
// implementation and reported completion without ever entering the review
// preflight. These tests cover the read-only, idempotent `agent_end` nudge
// that reminds the agent to call gentle_review before reporting completion,
// without ever starting a review or answering consent itself.
//
// gentle-pi#568: `session_start` records the target identity STATUS reports
// at session start as a baseline, so `agent_end` skips a candidate that
// already existed before this session touched the worktree (the user's own
// pre-session work, not this session's output). These tests point
// `GENTLE_PI_AGENT_HOME` and the session `cwd` at fresh temp directories so
// `session_start`'s real SDD asset install and model config sweep never
// touch this machine's actual home directory.

type AnyHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type SentMessage = { message: Record<string, unknown>; options: Record<string, unknown> };

function harness(nativeReviewCli: NativeReviewCli | null): {
	handlers: Map<string, AnyHandler>;
	sent: SentMessage[];
} {
	const handlers = new Map<string, AnyHandler>();
	const sent: SentMessage[] = [];
	const pi = {
		on(name: string, handler: AnyHandler) {
			handlers.set(name, handler);
		},
		events: { emit() {} },
		registerCommand() {},
		registerTool() {},
		sendMessage(message: Record<string, unknown>, options: Record<string, unknown> = {}) {
			sent.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli })(pi);
	return { handlers, sent };
}

function ctx(sessionId: string, hasUI = true, cwd = process.cwd()): ExtensionContext {
	return {
		cwd,
		hasUI,
		ui: { notify() {} },
		sessionManager: { getSessionId: () => sessionId },
	} as unknown as ExtensionContext;
}

async function withSessionStartEnv<T>(callback: (cwd: string) => Promise<T>): Promise<T> {
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	process.env.GENTLE_PI_AGENT_HOME = await mkdtemp(join(tmpdir(), "gentle-pi-session-baseline-agent-home-"));
	// Isolates both the model-config sweep and the dev-binary registration
	// lookup from this machine's real ~/.pi/gentle-ai, so `session_start`'s
	// unrelated notifications never leak into these assertions.
	process.env.GENTLE_PI_CONFIG_HOME = await mkdtemp(join(tmpdir(), "gentle-pi-session-baseline-config-home-"));
	try {
		const cwd = await mkdtemp(join(tmpdir(), "gentle-pi-session-baseline-cwd-"));
		return await callback(cwd);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
	}
}

function onMode(effective: "on" | "off"): NativeReviewCli["reviewMode"] {
	return async () => ({
		operation: "status",
		scope: "clone",
		status: { global: "", cloneLocal: effective === "on" ? "on" : "", effective, source: "clone_local" },
	});
}

function executeStartStatus(targetIdentity: string): ReviewStatusV3 {
	return {
		applicability: "unrelated",
		action: "start",
		targetIdentity,
		nextTransition: { kind: "execute", execute: { operation: "review.start", arguments: [] } },
	} as unknown as ReviewStatusV3;
}

function collectStatus(targetIdentity: string): ReviewStatusV3 {
	return {
		applicability: "unrelated",
		action: "start",
		targetIdentity,
		nextTransition: { kind: "collect", collect: { inputs: [] } },
	} as unknown as ReviewStatusV3;
}

function stopStatus(targetIdentity: string): ReviewStatusV3 {
	return {
		applicability: "unrelated",
		action: "start",
		targetIdentity,
		nextTransition: { kind: "stop" },
	} as unknown as ReviewStatusV3;
}

const agentEndEvent = { type: "agent_end", messages: [] };

test("agent_end performs no STATUS call and sends nothing when RDD is off", async () => {
	const statusRequests: unknown[] = [];
	const native = {
		reviewMode: onMode("off"),
		targetStatus: async (request: unknown) => {
			statusRequests.push(request);
			throw new Error("targetStatus must not be called when RDD is off");
		},
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	assert.equal(typeof agentEnd, "function");
	await agentEnd!(agentEndEvent, ctx("agent-end-rdd-off"));
	assert.deepEqual(statusRequests, []);
	assert.deepEqual(sent, []);
});

test("agent_end nudges exactly once when RDD is on and STATUS offers review.start", async () => {
	const targetIdentity = `sha256:${"a".repeat(64)}`;
	const statusRequests: Array<{ agent?: string }> = [];
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async (request: { agent?: string }) => {
			statusRequests.push(request);
			return executeStartStatus(targetIdentity);
		},
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	await agentEnd!(agentEndEvent, ctx("agent-end-execute"));

	assert.equal(sent.length, 1);
	const [entry] = sent;
	assert.equal(entry?.message.customType, "gentle-pi.review-preflight");
	const content = String(entry?.message.content);
	assert.match(content, /gentle_review/);
	assert.ok(content.includes(targetIdentity), "message must name the target identity");
	assert.equal(entry?.options.triggerTurn, true);
	assert.equal(statusRequests[0]?.agent, "pi");
});

test("agent_end nudges once per target identity and again for a fresh identity", async () => {
	let targetIdentity = `sha256:${"b".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	const session = ctx("agent-end-repeat");

	await agentEnd!(agentEndEvent, session);
	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 1, "the same target identity nudges only once");

	targetIdentity = `sha256:${"e".repeat(64)}`;
	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 2, "a different target identity nudges again");
});

test("agent_end sends nothing when STATUS offers collect or stop", async () => {
	for (const [label, status] of [
		["collect", collectStatus(`sha256:${"c".repeat(64)}`)],
		["stop", stopStatus(`sha256:${"d".repeat(64)}`)],
	] as const) {
		const native = {
			reviewMode: onMode("on"),
			targetStatus: async () => status,
		} as unknown as NativeReviewCli;
		const { handlers, sent } = harness(native);
		const agentEnd = handlers.get("agent_end");
		await agentEnd!(agentEndEvent, ctx(`agent-end-${label}`));
		assert.deepEqual(sent, [], label);
	}
});

test("agent_end skips headless sessions before any native call", async () => {
	const native = {
		reviewMode: async () => {
			throw new Error("reviewMode must not be called when hasUI is false");
		},
		targetStatus: async () => {
			throw new Error("targetStatus must not be called when hasUI is false");
		},
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	await agentEnd!(agentEndEvent, ctx("agent-end-no-ui", false));
	assert.deepEqual(sent, []);
});

test("agent_end pairs a named agent's start with its own end, then still nudges for the primary loop's end", async () => {
	const targetIdentity = `sha256:${"f".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const beforeAgentStart = handlers.get("before_agent_start");
	const agentEnd = handlers.get("agent_end");
	assert.equal(typeof beforeAgentStart, "function");
	const session = ctx("agent-end-subagent");

	await beforeAgentStart!({ agentName: "review-readability", systemPrompt: "" }, session);
	await agentEnd!(agentEndEvent, session);
	assert.deepEqual(sent, [], "the subagent's own loop end is suppressed");

	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 1, "the primary loop's end still nudges once the subagent's end is paired off");
});

test("agent_end resets the subagent depth when a fresh primary loop starts", async () => {
	const targetIdentity = `sha256:${"1".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const beforeAgentStart = handlers.get("before_agent_start");
	const agentEnd = handlers.get("agent_end");
	const session = ctx("agent-end-subagent-reset");

	await beforeAgentStart!({ agentName: "review-readability", systemPrompt: "" }, session);
	await beforeAgentStart!({ systemPrompt: "" }, session);
	await agentEnd!(agentEndEvent, session);

	assert.equal(sent.length, 1, "a fresh primary-loop start resets the depth so its own end nudges");
});

test("agent_end handler exists but sends nothing when nativeReviewCli is null", async () => {
	const { handlers, sent } = harness(null);
	const agentEnd = handlers.get("agent_end");
	assert.equal(typeof agentEnd, "function");
	await agentEnd!(agentEndEvent, ctx("agent-end-null-cli"));
	assert.deepEqual(sent, []);
});

test("agent_end sends nothing and does not throw when target STATUS rejects", async () => {
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => {
			throw new Error("native status unavailable");
		},
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	await assert.doesNotReject(async () => agentEnd!(agentEndEvent, ctx("agent-end-status-throws")));
	assert.deepEqual(sent, []);
});

test("session_shutdown clears the nudged-target set for its session key", async () => {
	const targetIdentity = `sha256:${"9".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	const shutdown = handlers.get("session_shutdown");
	assert.equal(typeof shutdown, "function");
	const session = ctx("agent-end-shutdown");

	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 1);

	await shutdown!({}, session);
	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 2, "shutdown clears the nudged set so the same identity nudges again");
});

test("session_start records the baseline target identity when RDD is on", async () => {
	const targetIdentity = `sha256:${"2".repeat(64)}`;
	const statusRequests: Array<{ agent?: string }> = [];
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async (request: { agent?: string }) => {
			statusRequests.push(request);
			return executeStartStatus(targetIdentity);
		},
	} as unknown as NativeReviewCli;
	await withSessionStartEnv(async (cwd) => {
		const { handlers, sent } = harness(native);
		const sessionStart = handlers.get("session_start");
		assert.equal(typeof sessionStart, "function");
		const notifications: Array<{ message: string; severity: string }> = [];
		const session = {
			...ctx("session-baseline-record", true, cwd),
			ui: { notify: (message: string, severity: string) => notifications.push({ message, severity }) },
		};
		await sessionStart!({}, session);
		assert.equal(statusRequests[0]?.agent, "pi");
		assert.deepEqual(sent, []);
		assert.deepEqual(notifications, []);
	});
});

test("agent_end skips the candidate that matches the session's recorded baseline, then nudges for a new one", async () => {
	let targetIdentity = `sha256:${"3".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	await withSessionStartEnv(async (cwd) => {
		const { handlers, sent } = harness(native);
		const sessionStart = handlers.get("session_start");
		const agentEnd = handlers.get("agent_end");
		const session = ctx("session-baseline-skip", true, cwd);

		await sessionStart!({}, session);
		await agentEnd!(agentEndEvent, session);
		assert.deepEqual(sent, [], "the baseline candidate predates the session and is not nudged");

		targetIdentity = `sha256:${"4".repeat(64)}`;
		await agentEnd!(agentEndEvent, session);
		assert.equal(sent.length, 1, "a candidate identity different from the baseline still nudges");
	});
});

test("session_start with RDD off records no baseline, so agent_end still reminds once", async () => {
	const targetIdentity = `sha256:${"5".repeat(64)}`;
	let mode: "on" | "off" = "off";
	const statusRequests: unknown[] = [];
	const native = {
		reviewMode: async () => ({
			operation: "status",
			scope: "clone",
			status: { global: "", cloneLocal: mode === "on" ? "on" : "", effective: mode, source: "clone_local" },
		}),
		targetStatus: async (request: unknown) => {
			statusRequests.push(request);
			if (mode === "off") throw new Error("targetStatus must not be called when RDD is off");
			return executeStartStatus(targetIdentity);
		},
	} as unknown as NativeReviewCli;
	await withSessionStartEnv(async (cwd) => {
		const { handlers, sent } = harness(native);
		const sessionStart = handlers.get("session_start");
		const agentEnd = handlers.get("agent_end");
		const session = ctx("session-baseline-rdd-off", true, cwd);

		await sessionStart!({}, session);
		assert.deepEqual(statusRequests, []);

		mode = "on";
		await agentEnd!(agentEndEvent, session);
		assert.equal(sent.length, 1, "no baseline was recorded while RDD was off, so the first dirty candidate still reminds");
	});
});

test("session_start whose targetStatus rejects records no baseline, so agent_end still reminds once", async () => {
	const targetIdentity = `sha256:${"6".repeat(64)}`;
	let shouldThrow = true;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => {
			if (shouldThrow) throw new Error("native status unavailable at session start");
			return executeStartStatus(targetIdentity);
		},
	} as unknown as NativeReviewCli;
	await withSessionStartEnv(async (cwd) => {
		const { handlers, sent } = harness(native);
		const sessionStart = handlers.get("session_start");
		const agentEnd = handlers.get("agent_end");
		const session = ctx("session-baseline-throws", true, cwd);

		await assert.doesNotReject(async () => sessionStart!({}, session));

		shouldThrow = false;
		await agentEnd!(agentEndEvent, session);
		assert.equal(sent.length, 1, "STATUS threw at session_start, so no baseline was recorded and the candidate still reminds");
	});
});

test("session_shutdown clears the recorded baseline so the same identity reminds again", async () => {
	const targetIdentity = `sha256:${"7".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	await withSessionStartEnv(async (cwd) => {
		const { handlers, sent } = harness(native);
		const sessionStart = handlers.get("session_start");
		const agentEnd = handlers.get("agent_end");
		const shutdown = handlers.get("session_shutdown");
		const session = ctx("session-baseline-shutdown", true, cwd);

		await sessionStart!({}, session);
		await agentEnd!(agentEndEvent, session);
		assert.deepEqual(sent, [], "the baseline candidate is skipped");

		await shutdown!({}, session);
		await agentEnd!(agentEndEvent, session);
		assert.equal(sent.length, 1, "shutdown cleared the baseline, so the same identity reminds again in the next session");
	});
});
