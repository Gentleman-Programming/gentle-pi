import assert from "node:assert/strict";
import test from "node:test";
import {
	admitDelegation,
	type DelegationAdmissionCollaborators,
} from "../lib/agent-runtime/delegation-admission.ts";

const candidateViews = { registry: "existing-candidate-views" };

function admission(
	injectReviewCandidateView: DelegationAdmissionCollaborators["injectReviewCandidateView"],
	toolName = "subagent_run",
	input: unknown = { agent: "worker", task: "inspect", mode: "task" },
) {
	return admitDelegation({ toolName, input, candidateViews, injectReviewCandidateView });
}

test("non-target tools are not applicable", () => {
	let injected = false;
	const result = admission(() => { injected = true; }, "bash", { command: "echo safe" });
	assert.deepEqual(result, { kind: "not-applicable" });
	assert.equal(injected, false);
});

test("ordinary single-agent input is returned unchanged", () => {
	const input = { agent: "worker", task: "inspect", mode: "task", context: "unchanged" };
	const before = JSON.stringify(input);
	const result = admission(() => {}, "subagent_run", input);
	assert.deepEqual(result, { kind: "allow", input });
	assert.equal(result.kind === "allow" ? result.input : undefined, input);
	assert.equal(JSON.stringify(input), before);
});

test("ordinary parallel agents input is returned unchanged", () => {
	const input = { agents: ["worker-a", "worker-b"], task: "inspect", mode: "task" };
	const before = JSON.stringify(input);
	const result = admission(() => {}, "subagent_run", input);
	assert.deepEqual(result, { kind: "allow", input });
	assert.equal(JSON.stringify(input), before);
});

test("ordinary foreground and background modes remain unchanged", () => {
	for (const mode of ["task", "background"] as const) {
		const input = { agent: "worker", task: "inspect", mode };
		const result = admission(() => {}, "subagent_run", input);
		assert.equal(result.kind, "allow");
		assert.equal(input.mode, mode);
	}
});

test("review task-mode uses the existing candidate/workspace augmentation", () => {
	const input = { agent: "review-reliability", task: "inspect", mode: "task" };
	let received: unknown;
	const result = admission((actualInput, actualViews) => {
		received = { input: actualInput, candidateViews: actualViews };
		(input as { task: string }).task += "\n[existing frozen candidate context]";
	}, "subagent_run", input);
	assert.equal(result.kind, "allow");
	assert.deepEqual(received, { input, candidateViews });
	assert.equal(input.task, "inspect\n[existing frozen candidate context]");
});

test("malformed and background review dispatches preserve existing public reasons", () => {
	for (const reason of [
		"review subagent dispatch must use exactly one non-duplicate agent shape",
		"review subagent dispatch requires mode task",
	]) {
		const result = admission(() => { throw new Error(reason); });
		assert.deepEqual(result, { kind: "block", reason });
	}
});

test("missing or invalid candidate context remains fail closed", () => {
	for (const reason of [
		"review subagent dispatch has no controller-owned candidate view registry",
		"review subagent dispatch does not resolve one exact frozen candidate view",
	]) {
		const result = admission(() => { throw new Error(reason); });
		assert.deepEqual(result, { kind: "block", reason });
	}
});

test("non-Error candidate failures retain the current generic public reason", () => {
	const result = admission(() => { throw "invalid"; });
	assert.deepEqual(result, { kind: "block", reason: "review subagent dispatch is invalid" });
});
