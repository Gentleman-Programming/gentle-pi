import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	renderSddPreflightPrompt,
	type SddPreflightPreferences,
} from "../lib/sdd-preflight.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEXT_EXTENSIONS = new Set([".md", ".ts", ".mjs", ".json"]);

async function collectTextFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectTextFiles(path)));
			continue;
		}
		if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))) {
			files.push(path);
		}
	}
	return files;
}

const SPANISH_PREFLIGHT_COPY = [
	/Antes de continuar con SDD/i,
	/Antes de seguir con SDD/i,
	/una opci[oó]n por grupo/i,
	/usar recomendad[oa]/i,
	/\bRitmo\b/i,
	/\bArtefactos\b/i,
	/\bPreguntarme\b/i,
	/l[ií]neas cambiadas/i,
	/\bhacelo\b/i,
	/\bSoy el Gentleman\b/i,
];

test("orchestrator keeps conversation language separate from generated artifact language", async () => {
	const orchestrator = await readFile(join(ROOT, "assets/orchestrator.md"), "utf8");

	// persona-single-channel: the conversation-language rule (previously a duplicated
	// LB1 sentence here) now lives once, in the wrapper block (gentle-ai.ts), and this
	// section only carries a one-line pointer back to it.
	assert.match(
		orchestrator,
		/Reply-language style and the active persona's Spanish variant are defined once in the identity\/harness section above/,
	);
	assert.match(
		orchestrator,
		/Generated technical artifacts[\s\S]*default to English, regardless of the user's conversation language or active persona/,
	);
	for (const artifactScope of ["code comments", "tests", "fixtures", "delegated phase outputs"]) {
		assert.match(orchestrator, new RegExp(artifactScope));
	}
	assert.match(
		orchestrator,
		/Public\/contextual comments and replies[\s\S]*target context language by default/,
	);
});

test("rendered SDD preflight prompt is English artifact copy", () => {
	const prefs: SddPreflightPreferences = {
		executionMode: "interactive",
		artifactStore: "openspec",
		chainedPrStrategy: "ask-always",
		reviewBudgetLines: 400,
		engramAvailable: false,
		prompted: true,
	};
	const prompt = renderSddPreflightPrompt(prefs);

	assert.match(prompt, /The user already chose these SDD preferences/);
	assert.match(prompt, /Review budget: 400 changed lines/);
	assert.match(prompt, /complete only the current SDD phase/i);
	assert.match(prompt, /Do not start the next SDD phase/i);
	assert.match(prompt, /approve only the immediate next phase/i);
	assert.match(prompt, /offer the user a proposal question round/i);
	assert.match(prompt, /business rules, implications, impact, edge cases/i);
	assert.match(prompt, /second question round/i);
	for (const pattern of SPANISH_PREFLIGHT_COPY) {
		assert.doesNotMatch(prompt, pattern);
	}
});

test("orchestrator Memory Contract carries the Engram memory lifecycle rule", async () => {
	// orchestrator-lazy-diet: the lifecycle rule moved verbatim to
	// assets/orchestrator-memory.md; core keeps only the intro + pointer.
	// Union read so this assertion is repointed, not weakened.
	const orchestrator =
		(await readFile(join(ROOT, "assets/orchestrator.md"), "utf8")) +
		(await readFile(join(ROOT, "assets/orchestrator-memory.md"), "utf8"));

	// Mirrors gentle-ai's engram-protocol/engram-convention lifecycle rule (PRs #842 + #844),
	// in its final availability-gated form: agents must treat needs_review memories as stale,
	// use the memory-provider-injected lifecycle tool when present, fall back safely when it is not,
	// and never auto-mark reviewed.
	for (const required of [
		"when Engram exposes lifecycle metadata/tooling",
		"At session start or before architecture-sensitive work",
		"call the injected Engram review tool with action `list`",
		"for the current project when the tool is available",
		"If the injected Engram review tool is unavailable, do not fail the task",
		"Continue with the injected Engram context/search tools",
		"still apply lifecycle metadata from any returned observations when present",
		"`active` memories may be used normally",
		"`needs_review` memories are stale context, not trusted facts",
		"verify it against current evidence before relying on it",
		"Do NOT call the injected Engram review tool with action `mark_reviewed` automatically",
		"Only call `mark_reviewed` after explicit user confirmation or through a dedicated memory maintenance command",
	]) {
		assert.ok(
			orchestrator.includes(required),
			`orchestrator.md missing memory lifecycle rule: ${required}`,
		);
	}
});

test("SDD proposal questions focus on business and PRD gaps", async () => {
	const proposalAgent = await readFile(join(ROOT, "assets/agents/sdd-proposal.md"), "utf8");

	assert.match(proposalAgent, /offer the user a proposal question round/i);
	assert.match(proposalAgent, /second question round/i);
	assert.match(proposalAgent, /business problem/i);
	assert.match(proposalAgent, /business rules/i);
	assert.match(proposalAgent, /implications and impact/i);
	assert.match(proposalAgent, /edge cases/i);
	assert.match(proposalAgent, /target users/i);
	assert.match(proposalAgent, /product outcome/i);
	assert.match(proposalAgent, /decision gaps/i);
	// Proposal-shaping questions must stay on business/product ground: the agent is
	// explicitly told to keep harness mechanics out of the proposal question round
	// unless the user opts into discussing delivery. Removing this guard is the most
	// likely way harness mechanics would leak back into proposal questions.
	assert.match(
		proposalAgent,
		/Do not ask about test commands, PR shape, changed-line budget, or other harness decisions unless the user explicitly asks to discuss delivery/i,
	);
});

test("SDD chain assets distinguish interactive gates from auto execution", async () => {
	const planChain = await readFile(join(ROOT, "assets/chains/sdd-plan.chain.md"), "utf8");
	const fullChain = await readFile(join(ROOT, "assets/chains/sdd-full.chain.md"), "utf8");

	assert.match(planChain, /auto mode or explicit all-planning approval/i);
	assert.match(planChain, /interactive mode/i);
	assert.match(planChain, /must stop after sdd-proposal/i);
	assert.match(fullChain, /auto mode or explicit full-lifecycle approval/i);
	assert.match(fullChain, /interactive mode/i);
	assert.match(fullChain, /must stop at each phase boundary/i);
});

test("orchestrator lazy-loads detailed SDD workflow", async () => {
	const orchestrator = await readFile(join(ROOT, "assets/orchestrator.md"), "utf8");
	const workflow = await readFile(join(ROOT, "assets/sdd-orchestrator-workflow.md"), "utf8");

	assert.match(orchestrator, /## SDD Workflow \(lazy-loaded\)/);
	assert.match(orchestrator, /\{\{GENTLE_PI_SDD_WORKFLOW_PATH\}\}/);
	assert.doesNotMatch(orchestrator, /## Native SDD Dispatcher/);
	assert.match(workflow, /## Native SDD Dispatcher/);
	assert.match(workflow, /## SDD Status Contract/);
	assert.match(workflow, /## Execution Mode/);
	assert.match(workflow, /## Strict TDD Forwarding/);
	assert.match(workflow, /## Review Workload Guard/);
	assert.match(workflow, /## Result Contract/);
});

test("persistent harness prompt assets do not hardcode Spanish SDD artifact copy", async () => {
	const files = [
		...(await collectTextFiles(join(ROOT, "assets"))),
		...(await collectTextFiles(join(ROOT, "prompts"))),
	];
	const failures: string[] = [];

	for (const file of files) {
		const text = await readFile(file, "utf8");
		for (const pattern of SPANISH_PREFLIGHT_COPY) {
			if (pattern.test(text)) {
				failures.push(`${relative(ROOT, file)} matched ${pattern}`);
			}
		}
	}

	assert.deepEqual(failures, []);
});

test("SDD assets define ownership markers and yield post-apply lifecycle to the parent", async () => {
	const [tasks, apply, status, contract, chain] = await Promise.all([
		readFile(join(ROOT, "assets/agents/sdd-tasks.md"), "utf8"),
		readFile(join(ROOT, "assets/agents/sdd-apply.md"), "utf8"),
		readFile(join(ROOT, "assets/agents/sdd-status.md"), "utf8"),
		readFile(join(ROOT, "assets/support/sdd-status-contract.md"), "utf8"),
		readFile(join(ROOT, "assets/chains/sdd-full.chain.md"), "utf8"),
	]);

	assert.match(tasks, /<!-- sdd-owner: implementation -->/);
	assert.match(tasks, /<!-- sdd-owner: parent -->/);
	assert.match(apply, /only implementation-owned/);
	assert.match(apply, /MUST NOT start bounded-review/);
	assert.match(status, /malformed/i);
	assert.match(contract, /deferredParentActions/);
	assert.match(contract, /parent-lifecycle/);
	assert.match(chain, /parent.lifecycle/i);
	assert.doesNotMatch(chain, /## sdd-review/);
});

test("comment-writer is context-reactive and neutral by default for Spanish comments", async () => {
	const skill = await readFile(join(ROOT, "skills/comment-writer/SKILL.md"), "utf8");

	for (const required of [
		"target context language",
		"explicitly requests a language",
		"neutral/professional Spanish by default",
	]) {
		assert.match(skill, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}

	for (const regionalDefault of [
		/\bAcá\b/,
		/\bagregá\b/,
		/\bpodés\b/,
		/\btenés\b/,
		/\bfijate\b/,
		/\bdale\b/,
		/\bquerés\b/i,
	]) {
		assert.doesNotMatch(skill, regionalDefault);
	}

	for (const englishExample of [
		"Good approach overall",
		"Approved. The scope is clear",
		"This PR exceeds the 400-line budget",
	]) {
		assert.match(skill, new RegExp(englishExample.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
});
