import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseRemediationPlan, remediationEvidence, observeRemediationTool, type RemediationObservations, type RemediationPlan, type RemediationScope, type TaskRequest } from "../lib/agents-runner.ts";
import { NATIVE_REVIEW_ERROR_CODE, NATIVE_REVIEW_OPERATION, NativeReviewCliError, type NativeReviewCli } from "../lib/native-review-cli.ts";
import { remediationUnresolved } from "../lib/agents-history.ts";
import type { TaskRecord } from "../lib/agents-protocol.ts";

const testCwd = process.cwd();
const human = { hasUI: true, ui: { confirm: async () => true } } as unknown as Pick<ExtensionContext, "hasUI" | "ui">;
const shellScope = (cwd: string, commands: string[]): RemediationScope => ({ cwd, commands, editPaths: [], allowedEditRoots: [cwd] });
const revision = `sha256:${"a".repeat(64)}`;
const plan: RemediationPlan = { cwd: testCwd, commands: ["pnpm test"], runtimeHarness: { naReason: "Not applicable because this correction changes only static assets." }, rollback: { boundary: "Revert the changed asset and paired test", command: "git diff --check" } };
function state(): RemediationObservations { return { failedEvidenceRevision: revision, plan: parseRemediationPlan(plan, testCwd), observations: [], pending: {}, invalid: false }; }
function observed(s: RemediationObservations, command: string, id: string, exitCode: number | null = 0, overrides: Record<string, unknown> = {}) {
	observeRemediationTool(s, { type: "tool_execution_start", toolName: "bash", toolCallId: id, args: { command } });
	observeRemediationTool(s, { type: "tool_execution_end", toolName: "bash", toolCallId: id, isError: false, result: { content: [{ type: "text", text: "concrete command output" }], details: { remediationCommand: { toolCallId: id, command, cwd: testCwd, exitCode, ...overrides } } } });
}
test("remediation evidence requires every exact planned command and rollback observation", () => {
	const s = state();
	assert.equal(remediationEvidence(s), undefined);
	observed(s, "pnpm test", "a");
	assert.equal(remediationEvidence(s), undefined);
	observed(s, "git diff --check", "b");
	const evidence = remediationEvidence(s);
	assert.equal(evidence.failed_evidence_revision, revision);
	assert.equal(evidence.commands[0].exit_code, 0);
	assert.match(evidence.commands[0].result, /sha256:/);
	assert.equal(evidence.runtime_harness.status, "not_applicable");
	assert.equal(evidence.rollback.boundary, plan.rollback.boundary);
});
for (const fault of ["nonzero", "null", "cwd", "id", "truncated", "unmatched"]) test(`remediation refuses ${fault} without parsing prose`, () => {
	const s = state();
	observed(s, fault === "unmatched" ? "echo passed" : "pnpm test", "a", fault === "nonzero" ? 1 : fault === "null" ? null : 0, fault === "cwd" ? { cwd: "/other" } : fault === "id" ? { toolCallId: "wrong" } : fault === "truncated" ? { truncated: true } : {});
	observed(s, "git diff --check", "b");
	assert.equal(remediationEvidence(s), undefined);
});
test("remediation plan is bounded and cannot select another working directory", () => {
	assert.throws(() => parseRemediationPlan({ ...plan, cwd: "/other" }, testCwd), /plan/);
	assert.throws(() => parseRemediationPlan({ ...plan, commands: [] }, testCwd), /plan/);
	assert.throws(() => parseRemediationPlan({ ...plan, runtimeHarness: { naReason: "N/A" } }, testCwd), /plan/);
});


test("remediation shell captures numeric exit, preserves stock errors and executes once", async () => {
	const { remediationBash } = await import("../extensions/gentle-agents.ts");
	for (const exitCode of [0, 7, null]) {
		let calls = 0;
		const shell = remediationBash(testCwd, { exec: async (command, cwd, options) => {
			calls++; assert.equal(command, "pnpm test"); assert.equal(cwd, testCwd);
			options.onData(Buffer.from("real output")); return { exitCode };
		} }, shellScope(testCwd, ["pnpm test"]));
		const run = shell.definition.execute("call", { command: "pnpm test" }, undefined, undefined, undefined);
		if (exitCode === 7) await assert.rejects(run, /code 7/); else await run;
		const patch = shell.result({ toolCallId: "call", details: { fullOutputPath: "/retained", remediationCommand: { exitCode: 99 } } } as unknown as Parameters<typeof shell.result>[0]);
		const details = patch.details as typeof patch.details & { fullOutputPath?: string };
		assert.equal(details.remediationCommand.exitCode, exitCode);
		assert.equal(details.remediationCommand.command, "pnpm test");
		assert.equal(details.remediationCommand.cwd, testCwd);
		assert.equal(details.fullOutputPath, "/retained");
		assert.equal(shell.result({ toolCallId: "call" }), undefined);
		assert.equal(calls, 1);
	}
});


test("remediation owner and packaged actor are installed through existing ownership", async () => {
	const { getPackageAssetOwner } = await import("../lib/sdd-preflight.ts");
	const { readFileSync } = await import("node:fs");
	assert.equal(getPackageAssetOwner("agents/sdd-remediate.md"), "sdd");
	assert.match(readFileSync("assets/agents/sdd-remediate.md", "utf8"), /SDD remediate executor/);
});

test("native remediation admission refuses unsupported owner before acquire", async () => {
	const { admitManagedRemediation } = await import("../extensions/gentle-agents.ts");
	let acquires = 0;
	await assert.rejects(admitManagedRemediation({ agent: { name: "sdd-remediate", filePath: "/absent" }, sddChange: { changeName: "fix", workspaceRoot: testCwd, phase: "remediate", failedEvidenceRevision: revision }, cwd: testCwd } as unknown as TaskRequest, {}, { sddAttemptAcquire: async () => { acquires++; } } as unknown as NativeReviewCli, async () => {}), /unsupported/i);
	assert.equal(acquires, 0);
});


test("admitted remediation retains exact settlement before one lost-reply replay", async () => {
	const { admitManagedRemediation } = await import("../extensions/gentle-agents.ts");
	const { resolve } = await import("node:path");
	const { readFileSync } = await import("node:fs");
	const path = resolve("assets/agents/sdd-remediate.md");
	const { parseAgentDefinition } = await import("../lib/agents-config.ts");
	const agent = parseAgentDefinition(readFileSync(path, "utf8"), path, "global");
	assert.ok("instructions" in agent);
	const saved = [], calls = [];
	const request = { agent, sddChange: { changeName: "fix", workspaceRoot: testCwd, phase: "remediate", failedEvidenceRevision: revision }, cwd: testCwd } as unknown as TaskRequest;
	const native = { sddStatus: async () => ({ schemaName: "gentle-ai.sdd-status", schemaVersion: 2, artifactStore: "openspec", planningHome: { mode: "repo-local", path: `${testCwd}/openspec` }, changeRoot: `${testCwd}/openspec/changes/fix`, dependencies: Object.fromEntries(["proposal", "specs", "design", "tasks", "apply", "verify", "archive"].map(key => [key, "ready"])), phaseInstructions: { apply: [], verify: [], remediate: ["Correct evidence"], archive: [] }, blockedReasons: [], nextRecommended: "remediate", changeName: "fix", actionContext: { mode: "repo-local", workspaceRoot: testCwd, allowedEditRoots: [testCwd] }, remediationState: { required: true, complete: false, failedEvidenceRevision: revision } }), sddAttemptAcquire: async input => { calls.push(["acquire", input]); return { state: "proceed", token: "opaque-admitted" }; }, sddAttemptSettle: async input => { assert.equal(saved.at(-1).sddRemediation.settle.requestId, input.requestId); calls.push(["settle", structuredClone(input)]); if (calls.length === 2) throw new Error("lost reply"); return { state: "complete" as const }; } } as unknown as NativeReviewCli;
	const admitted = await admitManagedRemediation(request, { plan, attempt: { requestId: "a", workUnit: "fix", evidenceGoal: "Observed correction", maxAttempts: 1, maxChangedLines: 200 } }, native, async task => { saved.push(structuredClone(task)); }, human, { id: "prepared", cwd: testCwd, agent: "sdd-remediate", status: "queued" } as unknown as TaskRecord);
	const task = { id: "task", cwd: testCwd, status: "completed", sddRemediation: admitted.sddRemediation } as unknown as TaskRecord & { sddRemediation: typeof admitted.sddRemediation };
	observed(task.sddRemediation, "pnpm test", "one"); observed(task.sddRemediation, "git diff --check", "two");
	await admitted.finalizeRemediation(task, { spawned: true, exited: true, cleanupConfirmed: true });
	assert.equal(calls.filter(([verb]) => verb === "acquire").length, 1);
	assert.equal(calls.filter(([verb]) => verb === "settle").length, 2);
	assert.deepEqual(calls[1], calls[2]);
	assert.equal(calls[1][1].outcome, "passed");
	assert.equal(calls[1][1].remediatesEvidenceRevision, revision);
	assert.equal(JSON.parse(calls[1][1].remediationEvidence).failed_evidence_revision, revision);
});


async function admissionFixture(overrides = {}, persist: (task: TaskRecord) => Promise<void> = async () => {}, agentPatch = {}, attemptPatch = {}, context: Pick<ExtensionContext, "hasUI" | "ui"> = human) {
	const { admitManagedRemediation } = await import("../extensions/gentle-agents.ts");
	const { parseAgentDefinition } = await import("../lib/agents-config.ts");
	const { readFileSync } = await import("node:fs");
	const { resolve } = await import("node:path");
	const path = resolve("assets/agents/sdd-remediate.md");
	const request = { agent: { ...parseAgentDefinition(readFileSync(path, "utf8"), path, "global"), ...agentPatch }, cwd: testCwd, sddChange: { changeName: "fix", workspaceRoot: testCwd, phase: "remediate", failedEvidenceRevision: revision } } as unknown as TaskRequest;
	const calls = [];
	const native = { sddStatus: async () => ({ schemaName: "gentle-ai.sdd-status", schemaVersion: 2, artifactStore: "openspec", planningHome: { mode: "repo-local", path: `${testCwd}/openspec` }, changeRoot: `${testCwd}/openspec/changes/fix`, dependencies: Object.fromEntries(["proposal", "specs", "design", "tasks", "apply", "verify", "archive"].map(key => [key, "ready"])), phaseInstructions: { apply: [], verify: [], remediate: ["Correct evidence"], archive: [] }, blockedReasons: [], nextRecommended: "remediate", changeName: "fix", actionContext: { mode: "repo-local", workspaceRoot: testCwd, allowedEditRoots: [testCwd] }, remediationState: { required: true, complete: false, failedEvidenceRevision: revision } }), sddAttemptAcquire: async input => { calls.push(["acquire", input]); return { state: "proceed", token: "opaque" }; }, sddAttemptSettle: async input => { calls.push(["settle", input]); return { state: "proceed" as const }; }, ...overrides } as unknown as NativeReviewCli;
	const admitted = await admitManagedRemediation(request, { plan, attempt: { requestId: "a", workUnit: "fix", evidenceGoal: "Observed correction", untrackedScope: "select", expectedUntrackedInventory: revision, intendedUntracked: ["new file.ts"], ...attemptPatch } }, native, persist, context, { id: "prepared", cwd: testCwd, agent: "sdd-remediate", status: "queued" } as unknown as TaskRecord);
	return { admitted, calls, task: { id: "one", status: "failed", sddRemediation: admitted.sddRemediation } as unknown as TaskRecord & { sddRemediation: typeof admitted.sddRemediation } };
}
for (const state of ["blocked", "complete"]) test(`native ${state} refuses without settlement`, async () => {
	let settles = 0;
	await assert.rejects(admissionFixture({ sddAttemptAcquire: async () => ({ state }), sddAttemptSettle: async () => { settles++; } }), new RegExp(state));
	assert.equal(settles, 0);
});
for (const status of ["failed", "cancelled", "timed_out"] as const) test(`terminal ${status} settles without passing evidence and retains exact untracked scope`, async () => {
	const { admitted, calls, task } = await admissionFixture(); task.status = status;
	await admitted.finalizeRemediation(task, { spawned: true, exited: true, cleanupConfirmed: true });
	const payload = calls[1][1];
	assert.equal(payload.outcome, status === "failed" ? "failed" : "interrupted");
	assert.equal(payload.remediationEvidence, undefined);
	assert.equal(typeof payload.evidenceRevision, status === "failed" ? "string" : "undefined");
	assert.deepEqual(payload.intendedUntracked, calls[0][1].intendedUntracked);
	assert.equal(payload.expectedUntrackedInventory, revision);
});
test("failure to retain settlement never mutates native; two lost replies retain uncertainty", async () => {
	const failed = await admissionFixture({}, async task => { if (task.sddRemediation.settle) throw new Error("disk failure"); });
	await assert.rejects(failed.admitted.finalizeRemediation(failed.task, { spawned: false, exited: false, cleanupConfirmed: true }), /disk failure/);
	assert.equal(failed.calls.length, 1);
	let replies = 0;
	const lost = await admissionFixture({ sddAttemptSettle: async () => { replies++; throw new Error("lost"); } });
	await lost.admitted.finalizeRemediation(lost.task, { spawned: false, exited: false, cleanupConfirmed: true });
	assert.equal(replies, 2); assert.equal(lost.task.sddRemediation.settlementUncertain, true);
	assert.equal(lost.task.sddRemediation.settle.outcome, "interrupted");
});
test("runtime harness requires its own observed command; malformed content cannot pass", () => {
	const s = state(); s.plan.runtimeHarness = { command: "pnpm run harness" };
	observed(s, "pnpm test", "test"); observed(s, "git diff --check", "rollback");
	assert.equal(remediationEvidence(s), undefined);
	observed(s, "pnpm run harness", "harness"); assert.equal(remediationEvidence(s).runtime_harness.status, "passed");
	const malformed = state();
	observeRemediationTool(malformed, { type: "tool_execution_start", toolName: "bash", toolCallId: "a", args: { command: "pnpm test" } });
	observeRemediationTool(malformed, { type: "tool_execution_end", toolName: "bash", toolCallId: "a", isError: false, result: { content: [null], details: { remediationCommand: { toolCallId: "a", command: "pnpm test", cwd: testCwd, exitCode: 0 } } } });
	observed(malformed, "git diff --check", "b"); assert.equal(remediationEvidence(malformed), undefined);
});


test("stock local shell wrapper observes real exit zero and preserves cancellation", async () => {
	const { remediationBash } = await import("../extensions/gentle-agents.ts");
	const { createBashToolDefinition } = await import("@earendil-works/pi-coding-agent");
	const shell = remediationBash(process.cwd(), undefined, shellScope(process.cwd(), ["printf wrapper-proof", "sleep 30"]));
	assert.deepEqual(shell.definition.parameters, createBashToolDefinition(process.cwd()).parameters);
	const result = await shell.definition.execute("real", { command: "printf wrapper-proof" }, undefined, undefined, undefined);
	const [content] = result.content;
	assert.ok(content?.type === "text");
	assert.equal(content.text, "wrapper-proof");
	assert.equal(shell.result({ toolCallId: "real", details: result.details }).details.remediationCommand.exitCode, 0);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30);
	try { await assert.rejects(shell.definition.execute("cancel", { command: "sleep 30" }, controller.signal, undefined, undefined), /aborted/); }
	finally { clearTimeout(timeout); controller.abort(); }
	assert.equal(shell.result({ toolCallId: "cancel" }), undefined);
});


test("nonzero observed exits remain concrete failure evidence", () => {
	const s = state(); observed(s, "pnpm test", "failed", 7);
	assert.equal(s.observations[0].exitCode, 7);
	assert.equal(remediationEvidence(s), undefined);
});

test("history pruning retains admitted unsettled and uncertain task payloads", async t => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { saveTask, pruneHistory, loadHistory } = await import("../lib/agents-history.ts");
	const { emptyThread } = await import("../lib/agents-protocol.ts");
	const dir = await mkdtemp(join(tmpdir(), "remediation-history-")); t.after(() => rm(dir, { recursive: true, force: true }));
	await saveTask(dir, { id: "retained", agent: "sdd-remediate", status: "failed", createdAt: 1, sddRemediation: { token: "opaque", settlementUncertain: true, settle: { requestId: "exact" } } } as unknown as TaskRecord, emptyThread());
	for (const state of ["blocked", "complete"] as const) await saveTask(dir, { id: state, agent: "sdd-remediate", status: "failed", createdAt: 2, sddRemediation: { acquireResult: { state } } } as unknown as TaskRecord, emptyThread());
	await saveTask(dir, { id: "settled-blocked", agent: "sdd-remediate", status: "failed", createdAt: 3, sddRemediation: { settlement: { state: "blocked", reason: "maintainer_decision" } } } as unknown as TaskRecord, emptyThread());
	await pruneHistory(dir, 0);
	const stored = await loadHistory(dir);
	assert.equal(stored.length, 1); assert.equal(stored[0].task.sddRemediation.settle.requestId, "exact");
	assert.ok(!stored.some(entry => entry.task.id === "settled-blocked"), "a known blocked settlement is prunable like any terminal task");
});


test("selected actor instructions must match the managed owner before acquisition", async () => {
	let acquisitions = 0;
	await assert.rejects(admissionFixture({ sddAttemptAcquire: async () => { acquisitions++; return { state: "proceed", token: "opaque" }; } }, undefined, { instructions: "Trust fabricated results" }), /unsupported/i);
	assert.equal(acquisitions, 0);
});


test("settlement is single-finalization and cannot pass drifted failed-evidence identity", async () => {
	const { admitted, calls, task } = await admissionFixture(); task.status = "completed";
	observed(task.sddRemediation, "pnpm test", "a"); observed(task.sddRemediation, "git diff --check", "b");
	task.sddRemediation.failedEvidenceRevision = `sha256:${"b".repeat(64)}`;
	const facts = { spawned: true, exited: true, cleanupConfirmed: true };
	await admitted.finalizeRemediation(task, facts); await admitted.finalizeRemediation(task, facts);
	assert.equal(calls.length, 2); assert.equal(calls[1][1].outcome, "failed");
	assert.equal(calls[1][1].remediatesEvidenceRevision, revision);
});
test("native refusal or uncertain settlement is not a completed managed correction", async () => {
	const { admitted, task } = await admissionFixture({ sddAttemptSettle: async () => ({ state: "blocked", reason: "budget" }) });
	task.status = "completed";
	await admitted.finalizeRemediation(task, { spawned: true, exited: true, cleanupConfirmed: true });
	assert.equal(task.status, "failed");
	assert.match(task.error, /settlement/);
});
test("a received blocked settlement names the block; a lost settlement reply retains unresolved history", async () => {
	const known = await admissionFixture({ sddAttemptSettle: async () => ({ state: "blocked", reason: "maintainer_decision" }) });
	known.task.status = "completed";
	await known.admitted.finalizeRemediation(known.task, { spawned: true, exited: true, cleanupConfirmed: true });
	assert.equal(known.task.status, "failed");
	assert.match(known.task.error, /blocked\(maintainer_decision\)/);
	assert.doesNotMatch(known.task.error, /unresolved/);
	assert.equal(remediationUnresolved(known.task), false);

	const unspecified = await admissionFixture({ sddAttemptSettle: async () => ({ state: "blocked" }) });
	unspecified.task.status = "completed";
	await unspecified.admitted.finalizeRemediation(unspecified.task, { spawned: true, exited: true, cleanupConfirmed: true });
	assert.equal(unspecified.task.status, "failed");
	assert.match(unspecified.task.error, /blocked\(unspecified\)/, "a settlement without a reason is distinguishable from one whose reason is literally blocked");
	assert.doesNotMatch(unspecified.task.error, /unresolved/);

	let attempts = 0;
	const uncertain = await admissionFixture({ sddAttemptSettle: async () => { attempts++; throw new Error("lost reply"); } });
	uncertain.task.status = "completed";
	await uncertain.admitted.finalizeRemediation(uncertain.task, { spawned: true, exited: true, cleanupConfirmed: true });
	assert.equal(attempts, 2);
	assert.equal(uncertain.task.status, "failed");
	assert.match(uncertain.task.error, /unresolved/);
	assert.equal(remediationUnresolved(uncertain.task), true);
});
test("remediationUnresolved treats a received settlement as terminal, regardless of state, unless uncertain", () => {
	// A terminal acquire result keeps the final branch false, so the token and
	// actor-claim assertions below discriminate on those fields alone.
	const base = { acquire: {}, acquireResult: { state: "complete" } } as unknown as TaskRecord["sddRemediation"];
	assert.equal(remediationUnresolved({ sddRemediation: { ...base } } as unknown as TaskRecord), false);
	assert.equal(remediationUnresolved({ sddRemediation: { ...base, settlement: { state: "blocked", reason: "maintainer_decision" } } } as unknown as TaskRecord), false);
	assert.equal(remediationUnresolved({ sddRemediation: { ...base, settlement: { state: "blocked", reason: "maintainer_decision" }, settlementUncertain: true } } as unknown as TaskRecord), true);
	assert.equal(remediationUnresolved({ sddRemediation: { ...base, actorClaimed: true } } as unknown as TaskRecord), true);
	assert.equal(remediationUnresolved({ sddRemediation: { ...base, token: "retained" } } as unknown as TaskRecord), true);
});


test("remediation actor preserves separately authorized memory artifact tools", async () => {
	const { parseAgentDefinition } = await import("../lib/agents-config.ts");
	const { readFileSync } = await import("node:fs");
	const agent = parseAgentDefinition(readFileSync("assets/agents/sdd-remediate.md", "utf8"), "/agents/sdd-remediate.md", "global");
	assert.ok("instructions" in agent);
	for (const tool of ["mem_search", "mem_get_observation", "mem_save", "mem_update"]) assert.ok(agent.tools.includes(tool), tool);
});


test("managed parent admission continues an explicitly retained token without a new acquire", async () => {
	const { calls } = await admissionFixture({}, undefined, {}, { token: "retained-parent-admission" });
	assert.equal(calls.length, 1);
	assert.equal(calls[0][1].token, "retained-parent-admission");
});


test("R3-duplicate-command-evidence requires a distinct execution for every indexed slot", () => {
	const s = state(); s.plan.commands = ["pnpm test", "pnpm test"];
	s.plan.runtimeHarness = { command: "pnpm test" }; s.plan.rollback.command = "pnpm test";
	for (let index = 0; index < 4; index++) {
		observed(s, "pnpm test", `slot-${index}`);
		assert.equal(remediationEvidence(s) === undefined, index < 3);
	}
	assert.deepEqual(s.observations.map(item => item.slot), [0, 1, 2, 3]);
	observed(s, "pnpm test", "slot-0");
	assert.equal(remediationEvidence(s), undefined, "reused call identity cannot produce evidence");
});


test("R1 confirms exact canonical paths and commands; data, denial and symlinks grant nothing", async t => {
	const { confirmRemediationScope, remediationToolAllowed } = await import("../extensions/gentle-agents.ts");
	const { mkdtempSync, writeFileSync, symlinkSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
	const cwd = mkdtempSync(join(tmpdir(), "remediation-scope-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const target = join(cwd, "allowed.ts"); writeFileSync(target, "original"); symlinkSync(target, join(cwd, "alias.ts"));
	const candidate = { ...plan, cwd, editPaths: [target] }, native = { mode: "repo-local", workspaceRoot: cwd, allowedEditRoots: [cwd] };
	let shown = "", confirmations = 0;
	const ui = { hasUI: true, ui: { confirm: async (_title: string, text: string) => { shown = text; confirmations++; return true; } } } as unknown as Pick<ExtensionContext, "hasUI" | "ui">;
	const scope = await confirmRemediationScope(candidate, native, ui);
	assert.match(shown, /pnpm test/); assert.ok(shown.includes(target)); assert.ok(shown.includes(cwd));
	assert.equal(remediationToolAllowed(scope, cwd, "write", { path: target }), true);
	for (const tool of ["mem_search", "mem_get_observation", "mem_save", "mem_update"]) assert.equal(remediationToolAllowed(scope, cwd, tool, { id: 7, project: "other", content: "outside" }), false);
	assert.equal(remediationToolAllowed(scope, cwd, "write", { path: join(cwd, "other.ts") }), false);
	assert.equal(remediationToolAllowed(scope, cwd, "bash", { command: "pnpm test; touch outside" }), false);
	for (const bad of [{ ...candidate, editPaths: [join(cwd, "alias.ts")] }, { ...candidate, editPaths: [cwd] }, { ...candidate, editPaths: [target, target] }]) await assert.rejects(confirmRemediationScope(bad, native, ui));
	assert.equal(confirmations, 1);
	for (const context of [undefined, { hasUI: false, ui: ui.ui }, { hasUI: true, ui: { confirm: async () => false } }, { hasUI: true, ui: { confirm: async () => undefined } }]) await assert.rejects(confirmRemediationScope(candidate, native, context as unknown as Pick<ExtensionContext, "hasUI" | "ui">), /authorization/);
});


test("R3/R4 acquire request is durable before mutation and token before actor admission", async () => {
	const records = [], calls = [];
	const { admitted } = await admissionFixture({ sddAttemptAcquire: async request => {
		assert.deepEqual(records.at(-1).sddRemediation.acquire, request);
		assert.equal(records.at(-1).sddRemediation.token, undefined);
		calls.push(structuredClone(request)); if (calls.length === 1) throw new Error("lost acquire reply");
		return { state: "proceed", token: "native-returned" };
	} }, async task => { records.push(structuredClone(task)); });
	assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
	assert.equal(records.at(-1).sddRemediation.token, "native-returned");
	assert.equal(admitted.sddRemediation.token, "native-returned");
});
test("R3/R4 acquire persistence failure refuses before native mutation", async () => {
	let mutations = 0;
	await assert.rejects(admissionFixture({ sddAttemptAcquire: async () => { mutations++; return { state: "proceed", token: "unsafe" }; } }, async () => { throw new Error("disk full"); }), /disk full/);
	assert.equal(mutations, 0);
});


test("R1 denial/headless/cancellation gives zero acquisition and durable mutation", async () => {
	for (const context of [{ hasUI: false }, { hasUI: true, ui: { confirm: async () => false } }, { hasUI: true, ui: { confirm: async () => undefined } }, { hasUI: true, ui: { confirm: async () => { throw new Error("cancelled"); } } }]) {
		let acquisitions = 0, persistence = 0;
		await assert.rejects(admissionFixture({ sddAttemptAcquire: async () => { acquisitions++; } }, async () => { persistence++; }, {}, {}, context as unknown as Pick<ExtensionContext, "hasUI" | "ui">));
		assert.equal(acquisitions, 0); assert.equal(persistence, 0);
	}
});
test("R1 child invokes only the exact confirmed command/cwd/count with distinct call IDs", async () => {
	const { remediationBash } = await import("../extensions/gentle-agents.ts");
	let executions = 0;
	const shell = remediationBash(testCwd, { exec: async () => { executions++; return { exitCode: 0 }; } }, shellScope(testCwd, ["pnpm test", "pnpm test"]));
	const execute = (id: string, command: string, cwd = testCwd) => shell.definition.execute(id, { command }, undefined, undefined, cwd === testCwd ? undefined : { cwd } as unknown as ExtensionContext);
	await assert.rejects(execute("outside", "pnpm test; touch outside"), /authorization/);
	await assert.rejects(execute("cwd", "pnpm test", "/other"), /authorization/);
	assert.equal(executions, 0);
	await execute("one", "pnpm test"); await assert.rejects(execute("one", "pnpm test"), /authorization/);
	await execute("two", "pnpm test"); await assert.rejects(execute("three", "pnpm test"), /authorization/);
	assert.equal(executions, 2);
});
test("R3/R4 known non-mutating acquire failures retain retryable blocked history while ambiguity remains unresolved", async () => {
	for (const error of [new TypeError("invalid acquire request"), new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, NATIVE_REVIEW_OPERATION.SDD_ATTEMPT, true, false, "native launch unavailable")]) {
		let calls = 0; const retained = [];
		await assert.rejects(admissionFixture({ sddAttemptAcquire: async () => { calls++; throw error; } }, async task => { retained.push(structuredClone(task)); }), error);
		assert.equal(calls, 1);
		assert.deepEqual(retained.at(-1).sddRemediation.acquireResult, { state: "blocked" });
		assert.equal(remediationUnresolved(retained.at(-1)), false);
	}
	let calls = 0; const retained = [];
	await assert.rejects(admissionFixture({ sddAttemptAcquire: async () => { calls++; throw new Error("lost reply"); } }, async task => { retained.push(structuredClone(task)); }), /Unknown acquire/);
	assert.equal(calls, 2); assert.equal(retained.at(-1).sddRemediation.acquireUncertain, true);
	assert.equal(remediationUnresolved(retained.at(-1)), true);
	assert.deepEqual(retained[0].sddRemediation.acquire, retained.at(-1).sddRemediation.acquire);
	calls = 0;
	await assert.rejects(admissionFixture({ sddAttemptAcquire: async () => { calls++; return { state: "proceed", token: "returned" }; } }, async task => { if (task.sddRemediation.token) throw new Error("token disk failure"); }), /token disk failure/);
	assert.equal(calls, 1);
});

test("uncertain acquire reconciliation terminalizes blocked/complete exact replays", async () => {
	const { reconcileManagedRemediation } = await import("../extensions/gentle-agents.ts");
	for (const nativeState of ["blocked", "complete"] as const) {
		const acquire = { workspaceRoot: testCwd, changeName: "fix", requestId: `reconcile-${nativeState}`, workUnit: "fix", evidenceGoal: "Observed correction", remediatesEvidenceRevision: revision };
		const task = { id: nativeState, agent: "sdd-remediate", cwd: testCwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireUncertain: true } } as unknown as TaskRecord;
		const calls = [], saved = [];
		const result = await reconcileManagedRemediation(task, { sddAttemptAcquire: async input => { calls.push(structuredClone(input)); return { state: nativeState }; } } as unknown as NativeReviewCli, async current => { saved.push(structuredClone(current)); });
		assert.deepEqual(calls, [acquire]);
		assert.equal(result.acquireState, nativeState);
		assert.equal(task.sddRemediation.acquireUncertain, undefined);
		assert.deepEqual(task.sddRemediation.acquireResult, { state: nativeState });
		assert.equal(remediationUnresolved(task), false);
		assert.ok(saved.length >= 1);
	}
});

test("recovered proceed is durably settled as interrupted without actor replay", async () => {
	const { reconcileManagedRemediation } = await import("../extensions/gentle-agents.ts");
	const acquire = { workspaceRoot: testCwd, changeName: "fix", requestId: "reconcile-proceed", workUnit: "fix", evidenceGoal: "Observed correction", remediatesEvidenceRevision: revision, untrackedScope: "exclude" as const };
	const task = { id: "proceed", agent: "sdd-remediate", cwd: testCwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireUncertain: true } } as unknown as TaskRecord;
	const saved = [], calls = [];
	const result = await reconcileManagedRemediation(task, {
		sddAttemptAcquire: async input => { calls.push(["acquire", structuredClone(input)]); return { state: "proceed", token: "secret-token" }; },
		sddAttemptSettle: async input => {
			calls.push(["settle", structuredClone(input)]);
			assert.deepEqual(saved.at(-1).sddRemediation.settle, input, "settle intent is durable before mutation");
			return { state: "complete" };
		},
	} as unknown as NativeReviewCli, async current => { saved.push(structuredClone(current)); });
	assert.equal(result.acquireState, "proceed"); assert.equal(result.settlementState, "complete");
	assert.deepEqual(calls[0], ["acquire", acquire]);
	assert.equal(calls[1][1].outcome, "interrupted");
	assert.equal(calls[1][1].token, "secret-token");
	assert.match(calls[1][1].requestId, /^reconcile-[a-f0-9]{32}$/);
	assert.equal(calls[1][1].remediatesEvidenceRevision, revision);
	assert.equal(calls[1][1].untrackedScope, "exclude");
	assert.ok(saved.filter(snapshot => snapshot.sddRemediation.token).every(snapshot => snapshot.sddRemediation.settle), "no durable checkpoint may retain recovered authority without its compensating settle request");
	assert.equal(task.sddRemediation.actorClaimed, undefined);
	assert.equal(task.sddRemediation.acquireUncertain, undefined);
	assert.equal(task.sddRemediation.settlementUncertain, undefined);
	assert.equal(remediationUnresolved(task), false);
	assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("reconciliation retries only exact pending mutations and preserves uncertainty", async () => {
	const { reconcileManagedRemediation } = await import("../extensions/gentle-agents.ts");
	const acquire = { workspaceRoot: testCwd, changeName: "fix", requestId: "reconcile-lost", workUnit: "fix", evidenceGoal: "Observed correction", remediatesEvidenceRevision: revision };
	const acquireTask = { id: "lost-acquire", agent: "sdd-remediate", cwd: testCwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireUncertain: true } } as unknown as TaskRecord;
	let acquireCalls = 0;
	await assert.rejects(reconcileManagedRemediation(acquireTask, { sddAttemptAcquire: async input => { acquireCalls++; assert.deepEqual(input, acquire); throw new Error("lost reply"); } } as unknown as NativeReviewCli, async () => {}), /acquire.*unresolved/i);
	assert.equal(acquireCalls, 2); assert.equal(acquireTask.sddRemediation.acquireUncertain, true);

	const settle = { workspaceRoot: testCwd, changeName: "fix", token: "retained", requestId: "settle-exact", outcome: "interrupted" as const, diagnosis: "Interrupted", harnessDisposition: "invalidated" as const, cleanupEvidence: "None", processEvidence: "None", remediatesEvidenceRevision: revision };
	const settleTask = { id: "lost-settle", agent: "sdd-remediate", cwd: testCwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireResult: { state: "proceed", token: "retained" }, token: "retained", settle, settlementUncertain: true } } as unknown as TaskRecord;
	const settleCalls = [];
	const result = await reconcileManagedRemediation(settleTask, { sddAttemptSettle: async input => { settleCalls.push(structuredClone(input)); return { state: "blocked", reason: "already_closed" }; } } as unknown as NativeReviewCli, async () => {});
	assert.deepEqual(settleCalls, [settle]); assert.equal(result.settlementState, "blocked");
	assert.equal(settleTask.sddRemediation.settlementUncertain, undefined);
	assert.equal(remediationUnresolved(settleTask), false);

	const ambiguousSettle = { id: "ambiguous-settle", agent: "sdd-remediate", cwd: testCwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireResult: { state: "proceed", token: "retained" }, token: "retained", settle, settlementUncertain: true } } as unknown as TaskRecord;
	let ambiguousCalls = 0; const ambiguousSaved = [];
	await assert.rejects(reconcileManagedRemediation(ambiguousSettle, { sddAttemptSettle: async input => { ambiguousCalls++; assert.deepEqual(input, settle); throw new Error("lost settle reply"); } } as unknown as NativeReviewCli, async current => { ambiguousSaved.push(structuredClone(current)); }), /settlement.*unresolved/i);
	assert.equal(ambiguousCalls, 2);
	assert.equal(ambiguousSettle.sddRemediation.settlementUncertain, true);
	assert.deepEqual(ambiguousSaved.at(-1).sddRemediation.settle, settle);
	assert.equal(remediationUnresolved(ambiguousSettle), true);

	const actorTask = { id: "actor", agent: "sdd-remediate", cwd: testCwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireUncertain: true, actorClaimed: true } } as unknown as TaskRecord;
	await assert.rejects(reconcileManagedRemediation(actorTask, {} as NativeReviewCli, async () => {}), /actor.*uncertain/i);
	const mismatchedSettle = structuredClone(settle); mismatchedSettle.changeName = "other";
	const corruptTask = { id: "corrupt", agent: "sdd-remediate", cwd: testCwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireResult: { state: "proceed", token: "retained" }, token: "retained", settle: mismatchedSettle, settlementUncertain: true } } as unknown as TaskRecord;
	await assert.rejects(reconcileManagedRemediation(corruptTask, { sddAttemptSettle: async () => { throw new Error("must not call"); } } as unknown as NativeReviewCli, async () => {}), /does not match/);
});


test("remediation actor explains one-launch human authority and indexed command evidence", async () => {
	const { readFileSync } = await import("node:fs");
	const text = readFileSync("assets/agents/sdd-remediate.md", "utf8");
	assert.match(text, /fresh host UI confirmation/); assert.match(text, /each repeated command.*separate execution/);
	assert.match(text, /reconcile.*without.*another actor/);
});
