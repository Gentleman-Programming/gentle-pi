import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../../src/core/agent-session-runtime.js";
import { AuthStorage } from "../../../src/core/auth-storage.js";
import { ModelRegistry } from "../../../src/core/model-registry.js";
import { SessionManager } from "../../../src/core/session-manager.js";

describe("gentle pi integrated runtime flow", () => {
	let tempRoot: string;
	let previousPhase: string | undefined;
	let previousChange: string | undefined;

	beforeEach(() => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-gentle-runtime-"));
		previousPhase = process.env.PI_GENTLE_PI_PHASE;
		previousChange = process.env.PI_GENTLE_PI_CHANGE;
		process.env.PI_GENTLE_PI_PHASE = "apply";
		process.env.PI_GENTLE_PI_CHANGE = "gentle-pi-agent";
	});

	afterEach(() => {
		if (previousPhase === undefined) {
			delete process.env.PI_GENTLE_PI_PHASE;
		} else {
			process.env.PI_GENTLE_PI_PHASE = previousPhase;
		}
		if (previousChange === undefined) {
			delete process.env.PI_GENTLE_PI_CHANGE;
		} else {
			process.env.PI_GENTLE_PI_CHANGE = previousChange;
		}
		rmSync(tempRoot, { recursive: true, force: true });
	});

	function writeOpenSpecContext(): void {
		mkdirSync(join(tempRoot, "openspec", "changes", "gentle-pi-agent"), { recursive: true });
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
		writeFileSync(join(tempRoot, "openspec", "changes", "gentle-pi-agent", "tasks.md"), "# Tasks\n");
		writeFileSync(join(tempRoot, "openspec", "changes", "gentle-pi-agent", "apply-progress.md"), "# Apply\n");
	}

	async function createIntegratedRuntime() {
		const authStorage = AuthStorage.inMemory();
		const modelRegistry = ModelRegistry.inMemory(authStorage);
		const faux = registerFauxProvider({
			provider: "openai-codex",
			models: [{ id: "gpt-5.5", reasoning: true }],
		});
		authStorage.setRuntimeApiKey("openai-codex", "faux-key");
		modelRegistry.registerProvider("openai-codex", {
			api: faux.api,
			baseUrl: faux.getModel().baseUrl,
			apiKey: "faux-key",
			models: faux.models.map((model) => ({
				id: model.id,
				name: model.name,
				api: model.api,
				baseUrl: model.baseUrl,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
			})),
		});
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			agentDir,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				authStorage,
				modelRegistry,
				resourceLoaderOptions: {
					noContextFiles: true,
					noExtensions: true,
					noPromptTemplates: true,
					noSkills: true,
					noThemes: true,
				},
			});
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempRoot,
			agentDir: tempRoot,
			sessionManager: SessionManager.inMemory(tempRoot),
		});
		await runtime.session.bindExtensions({});
		return { runtime, faux };
	}

	it("runs the default-on apply profile through standards, routing, and checkpointed bash", async () => {
		writeOpenSpecContext();
		const execObservations: string[] = [];
		const { runtime, faux } = await createIntegratedRuntime();

		try {
			expect(runtime.services.gentlePi?.enabled).toBe(true);
			expect(runtime.session.model?.provider).toBe("openai-codex");
			expect(runtime.session.model?.id).toBe("gpt-5.5");
			expect(runtime.session.thinkingLevel).toBe("high");
			expect(runtime.session.systemPrompt).toContain("## Project Standards (auto-resolved)");

			await runtime.session.executeBash("npx biome check --write .", undefined, {
				operations: {
					exec: async (_command, _cwd, options) => {
						const checkpointRoot = join(
							tempRoot,
							"openspec",
							"changes",
							"gentle-pi-agent",
							"rollback-checkpoints",
						);
						execObservations.push(existsSync(checkpointRoot) ? "checkpoint-before-exec" : "missing-checkpoint");
						options.onData(Buffer.from("formatted"));
						return { exitCode: 0 };
					},
				},
			});

			expect(execObservations).toEqual(["checkpoint-before-exec"]);
			expect(runtime.session.messages[runtime.session.messages.length - 1]?.role).toBe("bashExecution");
		} finally {
			await runtime.dispose();
			faux.unregister();
		}
	});

	it("denies destructive direct bash through the integrated apply profile", async () => {
		writeOpenSpecContext();
		const { runtime, faux } = await createIntegratedRuntime();
		let executed = false;

		try {
			await expect(
				runtime.session.executeBash("git reset --hard", undefined, {
					operations: {
						exec: async () => {
							executed = true;
							return { exitCode: 0 };
						},
					},
				}),
			).rejects.toThrow("destructive git command is forbidden");
			expect(executed).toBe(false);
		} finally {
			await runtime.dispose();
			faux.unregister();
		}
	});
});
