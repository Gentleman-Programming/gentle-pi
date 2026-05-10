import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../../../src/core/agent-session.js";
import { createAgentSessionServices } from "../../../src/core/agent-session-services.js";
import {
	deriveEngramBridgeState,
	detectEngramBridgeConfigEvidence,
	normalizeEngramToolName,
} from "../../../src/core/gentle-pi/engram-bridge.js";
import {
	createGentlePiIdentityMemoryServices,
	detectGentlePiMemoryCapability,
	detectGentlePiMemoryConfigSignals,
	renderGentlePiIdentityPrompt,
} from "../../../src/core/gentle-pi/identity-memory.js";
import { createHarness } from "../harness.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(testDir, "../../../../..");

const CHAIN_EXPECTED_STEPS: Record<string, readonly string[]> = {
	"sdd-full.chain.md": [
		"sdd-explore",
		"sdd-proposal",
		"sdd-spec",
		"sdd-design",
		"sdd-tasks",
		"sdd-apply",
		"sdd-verify",
		"sdd-archive",
	],
	"sdd-plan.chain.md": ["sdd-proposal", "sdd-spec", "sdd-design", "sdd-tasks"],
	"sdd-verify.chain.md": ["sdd-apply", "sdd-verify", "sdd-archive"],
};

const CHAIN_CONFIG_LINE_PATTERN = /^(output|outputMode|reads|model|skills|progress):\s*.+$/;
const CHAIN_STEP_PATTERN =
	/^## (sdd-[a-z-]+)\n((?:(?:output|outputMode|reads|model|skills|progress):[^\n]*\n)*)\n([\s\S]*?)(?=\n## |$)/gm;
const DIRECT_CHAIN_COMMAND_PATTERN = /^\s*\/(?:run|chain|parallel)\b/m;

const REQUIRED_ENGRAM_TOOL_NAMES = ["mem_search", "mem_save", "mem_context", "mem_get_observation"] as const;

interface ChainStep {
	agent: string;
	config: readonly string[];
	task: string;
}

function withTempProject(run: (paths: { projectRoot: string; agentDir: string }) => void): void {
	const projectRoot = mkdtempSync(join(tmpdir(), "gentle-pi-engram-project-"));
	const agentDir = mkdtempSync(join(tmpdir(), "gentle-pi-engram-agent-"));
	try {
		run({ projectRoot, agentDir });
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
}

function parseSavedChainSteps(content: string): ChainStep[] {
	const steps: ChainStep[] = [];
	for (const match of content.matchAll(CHAIN_STEP_PATTERN)) {
		const agent = match[1];
		const configBlock = match[2] ?? "";
		const task = match[3]?.trim() ?? "";
		if (agent === undefined) {
			continue;
		}

		steps.push({
			agent,
			config: configBlock
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0),
			task,
		});
	}

	return steps;
}

describe("Gentle Pi identity and memory harness", () => {
	it("detects Engram config shape from approved project MCP files without exposing secrets", () => {
		withTempProject(({ projectRoot, agentDir }) => {
			writeFileSync(
				join(projectRoot, ".mcp.json"),
				JSON.stringify({
					mcpServers: {
						engram: {
							command: "engram-mcp",
							env: { ENGRAM_TOKEN: "literal-token-should-not-leak" },
							headers: { Authorization: "Bearer secret-value" },
						},
					},
				}),
			);

			const evidence = detectEngramBridgeConfigEvidence({ projectRoot, agentDir });

			expect(evidence).toEqual([
				{
					sourcePath: join(projectRoot, ".mcp.json"),
					serverName: "engram",
					transport: "command",
				},
			]);
			expect(JSON.stringify(evidence)).not.toContain("literal-token-should-not-leak");
			expect(JSON.stringify(evidence)).not.toContain("secret-value");
		});
	});

	it("detects Engram config shape from .pi/mcp.json servers entries", () => {
		withTempProject(({ projectRoot, agentDir }) => {
			const piDir = join(projectRoot, ".pi");
			mkdirSync(piDir);
			writeFileSync(
				join(piDir, "mcp.json"),
				JSON.stringify({
					servers: {
						memory: {
							url: "https://example.invalid/engram/mcp",
							headers: { Authorization: "Bearer should-stay-private" },
						},
					},
				}),
			);

			const evidence = detectEngramBridgeConfigEvidence({ projectRoot, agentDir });

			expect(evidence).toEqual([
				{
					sourcePath: join(projectRoot, ".pi", "mcp.json"),
					serverName: "memory",
					transport: "url",
				},
			]);
			expect(JSON.stringify(evidence)).not.toContain("should-stay-private");
		});
	});

	it("detects Engram config shape from server object name metadata without exposing secrets", () => {
		withTempProject(({ projectRoot, agentDir }) => {
			writeFileSync(
				join(projectRoot, ".mcp.json"),
				JSON.stringify({
					mcpServers: {
						memory: {
							name: "engram",
							command: "node",
							args: ["--token", "secret-arg-should-not-leak"],
							env: { ENGRAM_TOKEN: "literal-token-should-not-leak" },
						},
					},
				}),
			);

			const evidence = detectEngramBridgeConfigEvidence({ projectRoot, agentDir });

			expect(evidence).toEqual([
				{
					sourcePath: join(projectRoot, ".mcp.json"),
					serverName: "memory",
					transport: "command",
				},
			]);
			expect(JSON.stringify(evidence)).not.toContain("secret-arg-should-not-leak");
			expect(JSON.stringify(evidence)).not.toContain("literal-token-should-not-leak");
		});
	});

	it("normalizes direct, prefixed, dotted, and MCP proxy Engram tool names", () => {
		const aliases: Record<string, string> = {
			mem_search: "mem_search",
			engram_mem_save: "mem_save",
			"engram.mem_context": "mem_context",
			mcp__engram__mem_get_observation: "mem_get_observation",
			mcp_engram_mem_session_summary: "mem_session_summary",
		};

		for (const [toolName, operation] of Object.entries(aliases)) {
			expect(normalizeEngramToolName(toolName)).toBe(operation);
		}
		expect(normalizeEngramToolName("read")).toBeUndefined();
	});

	it("rejects non-Engram tool names that merely end with memory operation suffixes", () => {
		const nonEngramToolNames = [
			"mcp__not_engram__mem_search",
			"other_mem_save",
			"proxy_mem_context",
			"arbitrary_mem_get_observation",
		] as const;

		for (const toolName of nonEngramToolNames) {
			expect(normalizeEngramToolName(toolName)).toBeUndefined();
		}
		expect(deriveEngramBridgeState({ activeToolNames: nonEngramToolNames }).status).toBe("unavailable");
	});

	it("derives available only when required Engram operations are callable", () => {
		const available = deriveEngramBridgeState({
			activeToolNames: REQUIRED_ENGRAM_TOOL_NAMES,
			configEvidence: [{ sourcePath: "/project/.mcp.json", serverName: "engram", transport: "command" }],
		});
		const missingGetObservation = deriveEngramBridgeState({
			activeToolNames: ["mem_search", "mem_save", "mem_context"],
			configEvidence: [{ sourcePath: "/project/.mcp.json", serverName: "engram", transport: "command" }],
		});

		expect(available.status).toBe("available");
		expect(available.canonicalOperations).toEqual(["mem_context", "mem_get_observation", "mem_save", "mem_search"]);
		expect(missingGetObservation.status).toBe("unreachable");
	});

	it("derives configured, unreachable, unavailable, and unknown from inspected evidence", () => {
		const configEvidence = [{ sourcePath: "/project/.pi/mcp.json", serverName: "engram", transport: "url" }] as const;

		expect(deriveEngramBridgeState({ configEvidence }).status).toBe("configured");
		expect(deriveEngramBridgeState({ activeToolNames: [], configEvidence }).status).toBe("unreachable");
		expect(deriveEngramBridgeState({ activeToolNames: [] }).status).toBe("unavailable");
		expect(deriveEngramBridgeState({}).status).toBe("unknown");
	});

	it("detects Engram available from callable tools with evidence", () => {
		const capability = detectGentlePiMemoryCapability({
			activeToolNames: [
				"read",
				"engram_mem_search",
				"engram_mem_save",
				"engram_mem_context",
				"engram_mem_get_observation",
			],
			configuredSignals: ["mcp:engram"],
		});

		expect(capability.status).toBe("available");
		expect(capability.callableTools).toEqual([
			"engram_mem_context",
			"engram_mem_get_observation",
			"engram_mem_save",
			"engram_mem_search",
		]);
		expect(capability.evidence).toContain("callable tool: engram_mem_search");
		expect(capability.fallback).toBe("openspec-artifacts");
	});

	it("reports configured Engram without claiming callable persistence", () => {
		const capability = detectGentlePiMemoryCapability({
			activeToolNames: ["read", "bash"],
			configuredSignals: ["mcp config: engram"],
		});

		expect(capability.status).toBe("unreachable");
		expect(capability.callableTools).toEqual([]);
		expect(capability.evidence).toEqual(["mcp config: engram"]);
	});

	it("detects Engram config signals from project configuration files", () => {
		const signals = detectGentlePiMemoryConfigSignals(projectRoot);

		expect(signals).not.toContain(join(projectRoot, ".pi", "settings.json"));
	});

	it("distinguishes unavailable from unknown Engram state", () => {
		expect(detectGentlePiMemoryCapability({ activeToolNames: [] }).status).toBe("unavailable");
		expect(detectGentlePiMemoryCapability({}).status).toBe("unknown");
	});

	it("renders truthful identity, self-description, persona, and memory protocol", () => {
		const availablePrompt = renderGentlePiIdentityPrompt({
			capability: detectGentlePiMemoryCapability({
				activeToolNames: [
					"engram_mem_search",
					"engram_mem_save",
					"engram_mem_context",
					"engram_mem_get_observation",
				],
			}),
		});
		const unavailablePrompt = renderGentlePiIdentityPrompt({
			capability: detectGentlePiMemoryCapability({ activeToolNames: [] }),
		});

		expect(availablePrompt).toContain("Gentle Pi");
		expect(availablePrompt).toContain("Pi-specific coding-agent harness");
		expect(availablePrompt).toContain("SDD/OpenSpec");
		expect(availablePrompt).toContain("subagents");
		expect(availablePrompt).toContain("Rioplatense");
		expect(availablePrompt).toContain("concepts before code");
		expect(availablePrompt).toContain("When asked who or what you are");
		expect(availablePrompt).toContain("senior architect");
		expect(availablePrompt).toContain("Engram persistence is available");
		expect(availablePrompt).toContain("recall/search");
		expect(availablePrompt).toContain("Engram-first memory harness");
		expect(availablePrompt).toContain("decisions, bug fixes, and non-obvious discoveries");
		expect(availablePrompt).not.toContain("generic assistant");
		expect(availablePrompt).not.toContain("portable Gentle AI framework");
		expect(unavailablePrompt).toContain("Engram is not available");
		expect(unavailablePrompt).toContain("degraded memory");
		expect(unavailablePrompt).not.toContain("Engram persistence is available");
	});

	it("injects identity into normal interactive sessions, not only phase runs", async () => {
		const previousPhase = process.env.PI_GENTLE_PI_PHASE;
		delete process.env.PI_GENTLE_PI_PHASE;
		const harness = await createHarness({
			tools: [],
			withConfiguredAuth: false,
		});
		try {
			const session = new AgentSession({
				agent: harness.session.agent,
				sessionManager: harness.sessionManager,
				settingsManager: harness.settingsManager,
				cwd: harness.tempDir,
				modelRegistry: harness.session.modelRegistry,
				resourceLoader: harness.session.resourceLoader,
				baseToolsOverride: {},
				gentlePi: {
					enabled: true,
					identityMemory: createGentlePiIdentityMemoryServices({ configuredSignals: [] }),
				},
			});

			expect(process.env.PI_GENTLE_PI_PHASE).toBeUndefined();
			expect(session.systemPrompt).toContain("Gentle Pi");
			expect(session.systemPrompt).toContain("Rioplatense Spanish with voseo");
			expect(session.systemPrompt).toContain("senior architect");
			expect(session.systemPrompt).toContain("Engram is not available");
			session.dispose();
		} finally {
			harness.cleanup();
			if (previousPhase !== undefined) {
				process.env.PI_GENTLE_PI_PHASE = previousPhase;
			}
		}
	});

	it("keeps non-Gentle sessions unchanged when disabled", async () => {
		const services = await createAgentSessionServices({
			cwd: projectRoot,
			agentDir: projectRoot,
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
	});

	it("defines native SDD agents and chains using pi-subagents project conventions", () => {
		const agentsDir = join(projectRoot, ".pi", "agents");
		const chainsDir = join(projectRoot, ".pi", "chains");
		const phases = ["explore", "proposal", "spec", "design", "tasks", "apply", "verify", "archive"];

		for (const phase of phases) {
			const filePath = join(agentsDir, `sdd-${phase}.md`);
			expect(existsSync(filePath)).toBe(true);
			const content = readFileSync(filePath, "utf-8");
			expect(content).toMatch(/^---\n[\s\S]*name: sdd-/);
			expect(content).toContain("tools:");
			expect(content).toContain("inheritProjectContext: true");
			expect(content).toContain("Do NOT launch child subagents");
		}

		const chainFiles = readdirSync(chainsDir).filter((fileName) => fileName.endsWith(".chain.md"));
		expect(chainFiles.sort()).toEqual(["sdd-full.chain.md", "sdd-plan.chain.md", "sdd-verify.chain.md"]);
		for (const fileName of chainFiles) {
			const content = readFileSync(join(chainsDir, fileName), "utf-8");
			const steps = parseSavedChainSteps(content);
			const expectedSteps = CHAIN_EXPECTED_STEPS[fileName];

			expect(expectedSteps).toBeDefined();
			expect(content).toMatch(/^---\n[\s\S]*name:/);
			expect(content).toMatch(/description:/);
			expect(content).not.toMatch(DIRECT_CHAIN_COMMAND_PATTERN);
			expect(steps.map((step) => step.agent)).toEqual(expectedSteps);
			expect(steps.every((step) => step.task.length > 0)).toBe(true);
			expect(steps.every((step) => step.config.every((line) => CHAIN_CONFIG_LINE_PATTERN.test(line)))).toBe(true);
		}
	});
});
