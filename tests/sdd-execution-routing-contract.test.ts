import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routingPaths = [
	"assets/sdd-orchestrator-workflow.md",
	"assets/support/sdd-status-contract.md",
];
const routingDocuments = routingPaths.map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const applyAgent = readFileSync(new URL("../assets/agents/sdd-apply.md", import.meta.url), "utf8");

function executionRoutingContract(document: string): string {
	const section = document.match(/## Bounded Execution Routing\n([\s\S]*?)(?=\n## |$)/);
	assert.ok(section, "explicit bounded execution routing contract is required");
	return section[1].trim();
}

for (const [index, path] of routingPaths.entries()) {
	test(`${path}: native and local execution tokens map to executable Pi phases`, () => {
		const contract = executionRoutingContract(routingDocuments[index]);
		for (const [token, phase] of [
			["apply", "sdd-apply"],
			["sdd-apply", "sdd-apply"],
			["verify", "sdd-verify"],
			["sdd-verify", "sdd-verify"],
			["archive", "sdd-archive"],
			["sdd-archive", "sdd-archive"],
			["sdd-sync", "sdd-sync"],
			["remediate", "sdd-apply"],
		]) {
			assert.ok(contract.includes(`| \`${token}\` | \`${phase}\` |`));
		}
	});

	test(`${path}: execution aliases preserve dependency and blocker gates`, () => {
		const contract = executionRoutingContract(routingDocuments[index]);
		for (const guard of [
			"For ordinary non-planning phases, stop when that phase's dependency is `blocked`",
			"The `remediate` route is the only dependency-blocked exception",
			"remediation requires the sole blocker to equal `remediationState.reason`",
			"When `nextRecommended` is `blocked` or `resolve-blockers`, report `blockedReasons` and stop",
			"Unknown tokens do not authorize a launch",
			"Non-empty `blockedReasons` forbid ordinary apply, sync, and archive work",
			"does not bypass preflight, selection, action-context, or runtime-attempt authority",
			"store carve-out remains separate and does not bypass those gates",
		]) {
			assert.ok(contract.includes(guard), `missing guard: ${guard}`);
		}
	});
}

test("workflow and support contract agree on bounded execution routing", () => {
	assert.equal(executionRoutingContract(routingDocuments[0]), executionRoutingContract(routingDocuments[1]));
});

test("sdd-apply defines a fail-closed native remediation mode", () => {
	for (const requirement of [
		'nextRecommended: "remediate"',
		"remediationState.required: true",
		"failedEvidenceRevision",
		"applyState: all_done",
		"dependencies.apply: all_done",
		"dependencies.verify: blocked",
		"`blockedReasons` contains exactly one entry and it exactly equals `remediationState.reason`",
		"phaseInstructions.remediate",
		"Do not reopen, add, or check off implementation task rows",
		"Native Remediation Mode instead re-reads the tasks artifact and confirms that every task row is unchanged",
		"During Native Remediation Mode, update only apply-progress and preserve the tasks artifact unchanged",
		"return `next_recommended: \"sdd-verify\"`",
		"--remediates-evidence-revision",
	]) {
		assert.ok(applyAgent.includes(requirement), `missing remediation requirement: ${requirement}`);
	}
	assert.match(applyAgent, /If native remediation metadata is missing or contradictory, stop with `blocked` before editing\./);
	assert.doesNotMatch(applyAgent, /In all modes, including strict TDD/);
	assert.doesNotMatch(applyAgent, /`openspec`: write\/update the apply-progress and tasks files/);
	assert.doesNotMatch(applyAgent, /If strict TDD is not active, implement assigned tasks/);
	assert.doesNotMatch(applyAgent, /applyState: blocked.*Native Remediation Mode is not active/);
});
