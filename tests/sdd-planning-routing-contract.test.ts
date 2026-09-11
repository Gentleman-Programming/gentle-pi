import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paths = [
	"assets/sdd-orchestrator-workflow.md",
	"assets/support/sdd-status-contract.md",
];
const documents = paths.map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

function routingContract(document: string): string {
	const section = document.match(/## Bounded Planning Routing\n([\s\S]*?)(?=\n## |$)/);
	assert.ok(section, "explicit bounded planning routing contract is required");
	return section[1].trim();
}

for (const [index, path] of paths.entries()) {
	test(`${path}: missing apply artifacts do not block bounded planning routes`, () => {
		const contract = routingContract(documents[index]);
		for (const [token, phase] of [
			["sdd-propose", "sdd-proposal"],
			["sdd-spec", "sdd-spec"],
			["sdd-design", "sdd-design"],
			["sdd-tasks", "sdd-tasks"],
		]) {
			assert.ok(contract.includes(`| \`${token}\` | \`${phase}\` |`));
		}
		assert.match(contract, /missing planning artifacts leave `dependencies\.apply: blocked`/);
		assert.match(contract, /do not require apply readiness to produce those artifacts/);
	});

	test(`${path}: native Gentle AI planning tokens map to executable Pi phases`, () => {
		const contract = routingContract(documents[index]);
		for (const [token, phase] of [
			["propose", "sdd-proposal"],
			["spec", "sdd-spec"],
			["design", "sdd-design"],
			["tasks", "sdd-tasks"],
		]) {
			assert.ok(contract.includes(`| \`${token}\` | \`${phase}\` |`));
		}
		assert.match(contract, /unprefixed tokens come from the native Gentle AI v2 status contract/);
	});

	test(`${path}: planning does not weaken stop conditions or diagnostic ownership`, () => {
		const contract = routingContract(documents[index]);
		for (const guard of [
			"stop for ambiguous change selection, unresolved session preflight, or unsafe action context",
			"prove planned writes are within the authoritative workspace or allowed edit roots",
			"workspace-planning without allowed edit roots remains read-only",
			"Planning does not bypass the init guard, pre-proposal gate, or phase approval requirements",
			"For non-planning phases, stop when that phase's dependency is `blocked`",
			"When `nextRecommended` is `blocked` or `resolve-blockers`, report `blockedReasons` and stop",
			"Unknown tokens do not authorize a launch",
			"Non-empty `blockedReasons` forbid apply, sync, and archive work",
			"`sdd-verify` may run only when `nextRecommended` is `sdd-verify` and its dependency permits it",
			"never infer a route from prose",
			"Keep human diagnostics in `blockedReasons`, not in `nextRecommended`",
			"report them without discarding them to enable a route",
			"store carve-out remains separate; it does not bypass preflight, selection, or action-context safety",
		]) {
			assert.ok(contract.includes(guard), `missing guard: ${guard}`);
		}
		assert.doesNotMatch(documents[index], /Do not launch a phase when native status marks that dependency `blocked`/);
		assert.doesNotMatch(documents[index], /stop unless `nextRecommended` is `verify`/);
	});
}

test("workflow and support contract agree on bounded planning routing", () => {
	assert.equal(routingContract(documents[0]), routingContract(documents[1]));
});
