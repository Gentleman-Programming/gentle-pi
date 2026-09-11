import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routingPaths = [
	"assets/sdd-orchestrator-workflow.md",
	"assets/support/sdd-status-contract.md",
];
const routingDocuments = routingPaths.map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

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
		]) {
			assert.ok(contract.includes(`| \`${token}\` | \`${phase}\` |`));
		}
	});

	test(`${path}: execution aliases preserve dependency and blocker gates`, () => {
		const contract = executionRoutingContract(routingDocuments[index]);
		for (const guard of [
			"For non-planning phases, stop when that phase's dependency is `blocked`",
			"When `nextRecommended` is `blocked` or `resolve-blockers`, report `blockedReasons` and stop",
			"Unknown tokens, including native `remediate`, do not authorize a launch until Pi has an explicit typed remediation transport and executor contract",
			"Non-empty `blockedReasons` forbid apply, sync, and archive work",
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
