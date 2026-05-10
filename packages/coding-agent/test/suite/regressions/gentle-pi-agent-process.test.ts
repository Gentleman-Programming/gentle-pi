import { describe, expect, it } from "vitest";
import {
	createGentlePiPhaseBundle,
	mergeApplyProgress,
	validateGentlePiDeliveryDecision,
	validateGentlePiPhaseReadiness,
	validateGentlePiResultEnvelope,
} from "../../../src/core/gentle-pi/orchestrator.js";

describe("gentle pi process harness", () => {
	it("allows valid phase progression when required artifacts exist", () => {
		const result = validateGentlePiPhaseReadiness({
			phase: "design",
			availableArtifacts: ["proposal.md", "specs/gentle-pi-context-harness/spec.md"],
		});

		expect(result).toEqual({ status: "success", missingArtifacts: [] });
	});

	it("blocks phases when predecessor artifacts are missing", () => {
		const result = validateGentlePiPhaseReadiness({ phase: "spec", availableArtifacts: [] });

		expect(result).toEqual({
			status: "blocked",
			missingArtifacts: ["proposal.md"],
			reason: "missing-artifact:proposal.md",
		});
	});

	it("creates isolated phase bundles with standards and scoped artifact content", () => {
		const bundle = createGentlePiPhaseBundle({
			changeName: "gentle-pi-agent",
			phase: "apply",
			standardsPrompt: "## Project Standards\n- Strict TDD",
			artifacts: { "tasks.md": "# Tasks", "design.md": "# Design" },
			deliveryStrategy: "exception-ok",
			chainStrategy: "size-exception",
		});

		expect(bundle.phase).toBe("apply");
		expect(bundle.isolated).toBe(true);
		expect(bundle.prompt).toContain("change `gentle-pi-agent`");
		expect(bundle.prompt).toContain("## Project Standards");
		expect(bundle.prompt).toContain("Artifact: tasks.md");
		expect(bundle.delivery.strategy).toBe("exception-ok");
	});

	it("validates result envelope compliance with required fields", () => {
		expect(
			validateGentlePiResultEnvelope({
				status: "success",
				executive_summary: "Applied tasks.",
				artifacts: ["openspec/changes/gentle-pi-agent/apply-progress.md"],
				next_recommended: "sdd-verify",
				risks: "None",
			}),
		).toEqual({ status: "success", missingFields: [] });

		expect(validateGentlePiResultEnvelope({ status: "success", artifacts: [] })).toEqual({
			status: "blocked",
			missingFields: ["executive_summary", "next_recommended", "risks"],
			reason: "invalid-result-envelope",
		});
	});

	it("merges apply progress checkpoints in completion order", () => {
		const merged = mergeApplyProgress({
			previous: [{ task: "1.1", status: "complete", evidence: "RED" }],
			next: [
				{ task: "1.2", status: "complete", evidence: "GREEN" },
				{ task: "1.1", status: "complete", evidence: "RED/GREEN" },
			],
		});

		expect(merged).toEqual([
			{ task: "1.1", status: "complete", evidence: "RED/GREEN" },
			{ task: "1.2", status: "complete", evidence: "GREEN" },
		]);
	});

	it("blocks high-risk apply delivery when no strategy decision exists", () => {
		expect(
			validateGentlePiDeliveryDecision({
				reviewRisk: "High",
				chainedRecommended: true,
			}),
		).toEqual({
			status: "blocked",
			reason: "delivery-decision-required",
			risks: "High review workload requires an explicit delivery strategy before apply",
		});

		expect(
			validateGentlePiDeliveryDecision({
				reviewRisk: "High",
				chainedRecommended: true,
				deliveryStrategy: "exception-ok",
				chainStrategy: "size-exception",
			}),
		).toEqual({ status: "success" });
	});
});
