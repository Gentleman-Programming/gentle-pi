import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/auth-storage.js", () => ({
	AuthStorage: {
		create: () => ({}),
	},
}));

vi.mock("../../../src/core/model-registry.js", () => ({
	ModelRegistry: class MockModelRegistry {
		static create(): MockModelRegistry {
			return new MockModelRegistry();
		}

		registerProvider(): void {}
	},
}));

vi.mock("../../../src/core/settings-manager.js", () => ({
	SettingsManager: {
		create: () => ({}),
	},
}));

vi.mock("../../../src/core/resource-loader.js", () => ({
	DefaultResourceLoader: class {
		async reload(): Promise<void> {}

		getExtensions() {
			return {
				extensions: [],
				errors: [],
				runtime: {
					flagValues: new Map(),
					pendingProviderRegistrations: [],
				},
			};
		}
	},
}));

vi.mock("../../../src/core/sdk.js", () => ({
	createAgentSession: vi.fn(),
}));

import { createAgentSessionServices } from "../../../src/core/agent-session-services.js";
import { createOpenSpecStore, initializeGentlePiContext } from "../../../src/core/gentle-pi/openspec-store.js";
import { resolveGentlePiProjectStandards } from "../../../src/core/gentle-pi/project-standards.js";

describe("gentle pi context harness", () => {
	let tempRoot: string;

	beforeEach(() => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-gentle-context-"));
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	function writeConfig(): void {
		mkdirSync(join(tempRoot, "openspec"), { recursive: true });
		mkdirSync(join(tempRoot, ".atl"), { recursive: true });
		writeFileSync(
			join(tempRoot, "openspec", "config.yaml"),
			[
				"schema: spec-driven",
				"strict_tdd: true",
				"context: |",
				"  Project: gentle-pi",
				"  Focus: packages/coding-agent",
				"testing:",
				"  runner:",
				"    available: true",
				"    command: npm --prefix packages/coding-agent run test",
			].join("\n"),
		);
		writeFileSync(
			join(tempRoot, ".atl", "skill-registry.md"),
			["## Selected skills and compact rules", "### typescript", "- Rules:", "  - Preserve strict TypeScript"].join(
				"\n",
			),
		);
	}

	it("blocks phase context initialization when openspec config is missing", () => {
		const result = initializeGentlePiContext({
			projectRoot: tempRoot,
			changeName: "gentle-pi-agent",
			phase: "apply",
		});

		expect(result).toEqual({
			status: "blocked",
			executive_summary: "OpenSpec config is missing.",
			artifacts: [],
			next_recommended: "sdd-init",
			risks: "openspec/config.yaml is required before phase execution",
			reason: "openspec-config-missing",
		});
	});

	it("blocks phase context initialization when openspec config is invalid yaml", () => {
		mkdirSync(join(tempRoot, "openspec"), { recursive: true });
		writeFileSync(join(tempRoot, "openspec", "config.yaml"), "rules:\n  apply:\n    tdd: true\n    - invalid\n");

		const result = initializeGentlePiContext({
			projectRoot: tempRoot,
			changeName: "gentle-pi-agent",
			phase: "apply",
		});

		expect(result).toMatchObject({
			status: "blocked",
			executive_summary: "OpenSpec config is invalid.",
			next_recommended: "sdd-init",
			reason: "openspec-config-invalid",
		});
	});

	it("resolves paths, existing artifacts, and execution metadata for a continued change", () => {
		writeConfig();
		mkdirSync(join(tempRoot, "openspec", "changes", "gentle-pi-agent"), { recursive: true });
		writeFileSync(join(tempRoot, "openspec", "changes", "gentle-pi-agent", "proposal.md"), "# Proposal\n");

		const result = initializeGentlePiContext({
			projectRoot: tempRoot,
			changeName: "gentle-pi-agent",
			phase: "design",
		});

		expect(result.status).toBe("success");
		if (result.status !== "success") throw new Error("expected success");
		expect(result.context.paths.config).toBe(join(tempRoot, "openspec", "config.yaml"));
		expect(result.context.changeName).toBe("gentle-pi-agent");
		expect(result.context.metadata.phase).toBe("design");
		expect(result.context.existingArtifacts).toContain("proposal.md");
	});

	it("reads an existing artifact before replacing it and reports continuity", () => {
		writeConfig();
		const store = createOpenSpecStore(tempRoot);
		store.writeChangeArtifact("gentle-pi-agent", "design.md", "# Old design\n");

		const result = store.writeChangeArtifact("gentle-pi-agent", "design.md", "# New design\n");

		expect(result).toEqual({
			artifactPath: join(tempRoot, "openspec", "changes", "gentle-pi-agent", "design.md"),
			previousContent: "# Old design\n",
			writtenContent: "# New design\n",
			continued: true,
		});
	});

	it("normalizes compact project standards from config and registry content", () => {
		writeConfig();
		const standards = resolveGentlePiProjectStandards({
			projectRoot: tempRoot,
			registryMarkdown: "## Compact Rules\n- Preserve strict TypeScript\n- Use local faux provider tests",
		});

		expect(standards.status).toBe("success");
		if (standards.status !== "success") throw new Error("expected standards");
		expect(standards.standards.strictTdd).toBe(true);
		expect(standards.standards.promptBlock).toContain("## Project Standards (auto-resolved)");
		expect(standards.standards.promptBlock).toContain("Preserve strict TypeScript");
		expect(standards.standards.promptBlock).toContain("npm --prefix packages/coding-agent run test");
	});

	it("reports invalid standards config as unavailable instead of throwing parser errors", () => {
		mkdirSync(join(tempRoot, "openspec"), { recursive: true });
		writeFileSync(join(tempRoot, "openspec", "config.yaml"), "rules:\n  apply:\n    tdd: true\n    - invalid\n");

		const standards = resolveGentlePiProjectStandards({ projectRoot: tempRoot });

		expect(standards).toMatchObject({
			status: "blocked",
			reason: "project-standards-invalid",
		});
	});

	it("blocks active Gentle Pi phase runtime when standards cannot resolve", async () => {
		const previousPhase = process.env.PI_GENTLE_PI_PHASE;
		process.env.PI_GENTLE_PI_PHASE = "apply";
		try {
			await expect(
				createAgentSessionServices({
					cwd: tempRoot,
					agentDir: tempRoot,
					gentlePiEnabled: true,
					resourceLoaderOptions: {
						noContextFiles: true,
						noExtensions: true,
						noPromptTemplates: true,
						noSkills: true,
						noThemes: true,
					},
				}),
			).rejects.toMatchObject({
				name: "GentlePiPhaseBlockedError",
				blocker: {
					status: "blocked",
					reason: "project-standards-unavailable",
					next_recommended: "sdd-init",
				},
			});
		} finally {
			if (previousPhase === undefined) {
				delete process.env.PI_GENTLE_PI_PHASE;
			} else {
				process.env.PI_GENTLE_PI_PHASE = previousPhase;
			}
		}
	});

	it("blocks active Gentle Pi phase runtime when standards config is incomplete", async () => {
		mkdirSync(join(tempRoot, "openspec"), { recursive: true });
		writeFileSync(join(tempRoot, "openspec", "config.yaml"), "schema: spec-driven\n");

		const previousPhase = process.env.PI_GENTLE_PI_PHASE;
		process.env.PI_GENTLE_PI_PHASE = "apply";
		try {
			await expect(
				createAgentSessionServices({
					cwd: tempRoot,
					agentDir: tempRoot,
					gentlePiEnabled: true,
					resourceLoaderOptions: {
						noContextFiles: true,
						noExtensions: true,
						noPromptTemplates: true,
						noSkills: true,
						noThemes: true,
					},
				}),
			).rejects.toMatchObject({
				name: "GentlePiPhaseBlockedError",
				blocker: {
					status: "blocked",
					reason: "project-standards-incomplete",
					next_recommended: "sdd-init",
					missing: [
						"openspec/config.yaml strict_tdd",
						"openspec/config.yaml context",
						"openspec/config.yaml rules.apply.test_command or testing.runner.command",
						".atl/skill-registry.md compact rules",
					],
				},
			});
		} finally {
			if (previousPhase === undefined) {
				delete process.env.PI_GENTLE_PI_PHASE;
			} else {
				process.env.PI_GENTLE_PI_PHASE = previousPhase;
			}
		}
	});

	it("creates cwd-bound default Gentle Pi services without leaking setup scope", async () => {
		writeConfig();

		const services = await createAgentSessionServices({
			cwd: tempRoot,
			agentDir: tempRoot,
			gentlePiEnabled: true,
			resourceLoaderOptions: {
				noContextFiles: true,
				noExtensions: true,
				noPromptTemplates: true,
				noSkills: true,
				noThemes: true,
			},
		});

		expect(services.gentlePi).toMatchObject({ enabled: true });
		expect(services.gentlePi?.standardsPrompt).toContain("## Project Standards (auto-resolved)");
		expect(services.diagnostics).toEqual([]);
	});

	it("skips Gentle Pi service creation when the profile is explicitly disabled", async () => {
		const services = await createAgentSessionServices({
			cwd: tempRoot,
			agentDir: tempRoot,
			gentlePiEnabled: false,
			resourceLoaderOptions: {
				noContextFiles: true,
				noExtensions: true,
				noPromptTemplates: true,
				noSkills: true,
				noThemes: true,
			},
		});

		expect(services.gentlePi).toBeUndefined();
		expect(services.diagnostics).toEqual([]);
	});
});
