import { describe, expect, test } from "vitest";
import { detectGentlePiMemoryCapability, renderGentlePiIdentityPrompt } from "../src/core/gentle-pi/identity-memory.js";
import { buildSystemPrompt } from "../src/core/system-prompt.js";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("prompt guidelines", () => {
		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});

	describe("Gentle Pi identity prompt", () => {
		test("uses Gentle Pi as the primary runtime identity when identity prompt is present", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				gentlePiIdentityPrompt: "## Gentle Pi Identity\nUse direct technical tone.",
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toMatch(/^You are Gentle Pi, a Pi-specific coding-agent harness\./);
			expect(prompt).not.toContain("You are an expert coding assistant operating inside pi");
		});

		test("appends identity and memory contract before project context", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				gentlePiIdentityPrompt: "## Gentle Pi Identity\nEngram status is unavailable.",
				contextFiles: [{ path: "AGENTS.md", content: "Project rules" }],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("## Gentle Pi Identity");
			expect(prompt.indexOf("## Gentle Pi Identity")).toBeLessThan(prompt.indexOf("# Project Context"));
		});

		test("includes identity prompt when a custom system prompt replaces the default", () => {
			const prompt = buildSystemPrompt({
				customPrompt: "Custom base prompt.",
				selectedTools: ["read"],
				gentlePiIdentityPrompt: "## Gentle Pi Identity\nUse direct technical tone.",
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Custom base prompt.");
			expect(prompt).toContain("## Gentle Pi Identity");
		});

		test("keeps configured Engram wording degraded in the full system prompt", () => {
			const identityPrompt = renderGentlePiIdentityPrompt({
				capability: detectGentlePiMemoryCapability({ configuredSignals: ["mcp config: engram"] }),
			});
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				gentlePiIdentityPrompt: identityPrompt,
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Engram configuration signals are detected");
			expect(prompt).toContain("Do not claim usable persistent memory");
			expect(prompt).not.toContain("Engram persistence is available");
		});

		test("keeps unreachable Engram wording degraded in the full system prompt", () => {
			const identityPrompt = renderGentlePiIdentityPrompt({
				capability: detectGentlePiMemoryCapability({
					activeToolNames: ["read"],
					configuredSignals: ["mcp config: engram"],
				}),
			});
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				gentlePiIdentityPrompt: identityPrompt,
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("required callable Engram tools are unreachable");
			expect(prompt).toContain("Do not claim usable persistent memory");
			expect(prompt).not.toContain("Engram persistence is available");
		});
	});
});
