// Real-binary proof: committed-range START → CRITICAL finalize → workspace correction → targeted validation finalize.
// This test does NOT mock the native binary. It uses the actual v2.1.8 binary in the package-local slot
// and the actual controller in extensions/gentle-ai.ts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { createNativeReviewCli, type NativeTargetStatusRequest, type ReviewStatusV1 } from "../lib/native-review-cli.ts";

interface RegisteredTool {
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	) => Promise<{ details?: unknown }>;
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join("/tmp/opencode", "gentle-pi-runtime-e2e-"));
	t.diagnostic(`test repo cwd: ${cwd}`);
	return cwd;
}

function addBareRemote(t: test.TestContext, cwd: string, name: string): string {
	const parent = mkdtempSync(join("/tmp/opencode", "gentle-pi-runtime-e2e-remote-"));
	const remote = join(parent, `${name}.git`);
	execFileSync("git", ["clone", "--bare", cwd, remote], { cwd: parent, stdio: "ignore" });
	git(cwd, "remote", "add", name, remote);
	git(cwd, "fetch", name);
	return remote;
}

function controllerFor(nativeReviewCli: ReturnType<typeof createNativeReviewCli>, candidateViews = new CandidateViewRegistry()): {
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		ctx: ExtensionContext,
	) => Promise<{ details?: unknown }>;
} {
	const tools = new Map<string, RegisteredTool>();
	createGentleAiExtension({ nativeReviewCli, candidateViews })({
		on() {},
		registerTool(definition: RegisteredTool & { name: string }) {
			tools.set(definition.name, definition);
		},
		registerCommand() {},
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	return { execute: (id, params, ctx) => controller!.execute(id, params, undefined, undefined, ctx) };
}

function context(cwd: string): ExtensionContext {
	return { cwd, hasUI: false, signal: undefined, ui: { confirm: async () => true } } as unknown as ExtensionContext;
}

test("real binary: committed-range START with <remote>/<branch> selector → CRITICAL → correction_required → workspace correction → validation finalize", async (t) => {
	// 1. Build a disposable repo with a real bare remote.
	const cwd = repository(t);
	git(cwd, "init", "-b", "main");
	execFileSync("git", ["config", "user.email", "proof@example.invalid"], { cwd });
	execFileSync("git", ["config", "user.name", "Proof"], { cwd });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["commit", "-m", "initial"], { cwd });
	addBareRemote(t, cwd, "origin");
	git(cwd, "push", "origin", "main");
	// 2. Make a committed candidate change so the committed range is non-empty.
	writeFileSync(join(cwd, "app.ts"), [
		"export const value = 2;",
		"export const candidateA = true;",
		"export const candidateB = true;",
		"export const candidateC = true;",
		"export const candidateD = true;",
		"export const candidateE = true;",
		"",
	].join("\n"));
	git(cwd, "add", "app.ts");
	git(cwd, "commit", "-m", "candidate: bump value to 2");
	// 3. Use a unique lineage so we never collide with any existing authority.
	const lineageId = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const nativeReviewCli = createNativeReviewCli();
	const candidateViews = new CandidateViewRegistry();
	const { execute } = controllerFor(nativeReviewCli, candidateViews);
	// 4. START with the unique <remote>/<branch> selector.
	const startResult = await execute(
		"proof-start",
		{
			operation: "start",
			input: JSON.stringify({
				mode: "ordinary",
				baseRef: "origin/main",
				committedOnly: true,
			}),
			lineageId,
		},
		context(cwd),
	);
	const startDetails = (startResult.details ?? {}) as { result?: { lineage_id: string; state: string; correction_budget: number }; operation: string; status?: string; lineage_created?: boolean };
	t.diagnostic(`startDetails: ${JSON.stringify(startDetails)}`);
	assert.equal(startDetails.operation, "start");
	assert.equal(startDetails.result?.lineage_id, lineageId);
	assert.equal(startDetails.result?.state, "reviewing");
	// 5. Submit a deterministic CRITICAL finding → state must reach correction_required.
	const criticalFinding = {
		id: "RELIABILITY-001",
		lens: "review-reliability",
		location: "app.ts:1",
		severity: "CRITICAL",
		claim: "The committed candidate value=2 breaks the documented invariant.",
		evidence_class: "deterministic",
		causal_disposition: "introduced",
		proof_refs: ["changed-hunk:app.ts:1"],
	};
	const frozenCandidate = candidateViews.resolveForFinalize(lineageId);
	const finalizeDetails = await nativeReviewCli.finalize({
		cwd: frozenCandidate.root,
		lineageId,
		lensResults: [{
			lens: "review-reliability",
			document: {
				lens: "reliability",
				findings: [{ ...criticalFinding, lens: "reliability" }],
				evidence: ["changed-hunk:app.ts:1 changes value from 1 to 2."],
			},
		}],
	});
	t.diagnostic(`finalizeDetails: ${JSON.stringify(finalizeDetails)}`);
	assert.equal(finalizeDetails.state, "correction_required");
	assert.ok(startDetails.result!.correction_budget >= 2);
	const forecastDetails = await nativeReviewCli.finalize({ cwd: frozenCandidate.root, lineageId, correctionLines: 2 });
	assert.equal(forecastDetails.state, "correction_required");
	frozenCandidate.cleanup();

	// Simulate a controller reload, then apply the correction only in the contributor workspace.
	writeFileSync(join(cwd, "app.ts"), [
		"export const value = 1;",
		"export const candidateA = true;",
		"export const candidateB = true;",
		"export const candidateC = true;",
		"export const candidateD = true;",
		"export const candidateE = true;",
		"",
	].join("\n"));
	const statePath = join(cwd, ".git", "gentle-ai", "review-transactions", "v2", lineageId, "review-state.json");
	const stateAfterFinding = JSON.parse(readFileSync(statePath, "utf8")) as { state: { state: string; initial_snapshot: { base_tree: string; candidate_tree: string }; current_snapshot: { base_tree: string; candidate_tree: string }; fix_finding_ids: string[] } };
	const statusRequests: NativeTargetStatusRequest[] = [];
	const statusResponses: ReviewStatusV1[] = [];
	const reloadedNative = createNativeReviewCli();
	const realTargetStatus = reloadedNative.targetStatus!.bind(reloadedNative);
	reloadedNative.targetStatus = async (request) => {
		statusRequests.push(request);
		const response = await realTargetStatus(request);
		statusResponses.push(response);
		return response;
	};
	const reloaded = controllerFor(reloadedNative, new CandidateViewRegistry());
	const finalResult = await reloaded.execute(
		"proof-finalize-validation",
		{
			operation: "finalize",
			lineageId,
			input: JSON.stringify({
				validation: {
					request_hash: "a".repeat(64),
					correction_ids: ["RELIABILITY-001"],
					original_criteria: { passed: true, evidence: ["The corrected value restores the documented invariant."] },
					correction_regression: { passed: true, evidence: ["The committed candidate additions remain present."] },
					fix_caused_findings: [],
					follow_ups: [],
				},
				final_evidence: "Focused correction verification passed.",
				final_verification_passed: true,
			}),
		},
		context(cwd),
	);
	const finalDetails = (finalResult.details ?? {}) as { result?: { state?: string; action?: string } };
	t.diagnostic(`finalDetails: ${JSON.stringify(finalDetails)}`);
	assert.equal(finalDetails.result?.state, "approved");
	assert.equal(finalDetails.result?.action, "validate delivery with gentle-ai review validate --gate <gate>");
	assert.equal(statusRequests.length, 1);
	assert.equal(statusRequests[0]?.baseRef, "origin/main");
	assert.notEqual(statusRequests[0]?.baseRef, git(cwd, "rev-parse", "origin/main"));
	assert.equal(statusResponses[0]?.applicability, "current_target");
	assert.equal(statusResponses[0]?.projection.baseTree, stateAfterFinding.state.initial_snapshot.base_tree);
	assert.equal(stateAfterFinding.state.initial_snapshot.base_tree, git(cwd, "rev-parse", "origin/main^{tree}"));
	assert.equal(statusResponses[0]?.projection.currentCandidateTree, stateAfterFinding.state.initial_snapshot.candidate_tree);
	const stateAfterApproval = JSON.parse(readFileSync(statePath, "utf8")) as { state: { state: string; initial_snapshot: { base_tree: string; candidate_tree: string }; current_snapshot: { base_tree: string; candidate_tree: string } } };
	assert.equal(stateAfterApproval.state.state, "approved");
	assert.deepEqual(stateAfterApproval.state.initial_snapshot, stateAfterFinding.state.initial_snapshot);
	assert.equal(stateAfterApproval.state.current_snapshot.base_tree, stateAfterFinding.state.initial_snapshot.candidate_tree);
	assert.notEqual(stateAfterApproval.state.current_snapshot.candidate_tree, stateAfterFinding.state.initial_snapshot.candidate_tree);
	const correctedCandidateTree = stateAfterApproval.state.current_snapshot.candidate_tree;

	const proofPath = join(cwd, "e2e-proof.json");
	writeFileSync(proofPath, `${JSON.stringify({
		repository: cwd,
		remote: git(cwd, "remote", "get-url", "origin"),
		lineage: lineageId,
		selector: statusRequests[0]?.baseRef,
		selector_is_raw_sha: statusRequests[0]?.baseRef === git(cwd, "rev-parse", "origin/main"),
		frozen_base_tree: stateAfterFinding.state.initial_snapshot.base_tree,
		remote_base_tree: git(cwd, "rev-parse", "origin/main^{tree}"),
		initial_candidate_tree: stateAfterFinding.state.initial_snapshot.candidate_tree,
		corrected_candidate_tree: correctedCandidateTree,
		transitions: ["reviewing", finalizeDetails.state, forecastDetails.state, finalDetails.result?.state],
		final_action: finalDetails.result?.action,
		fix_finding_ids: stateAfterFinding.state.fix_finding_ids,
	}, null, 2)}\n`);
	t.diagnostic(`proof artifact: ${proofPath}`);
});
