import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

export interface GentlePiProjectStandards {
	strictTdd: boolean;
	testCommand: string | undefined;
	promptBlock: string;
}

export type GentlePiProjectStandardsResult =
	| { status: "success"; standards: GentlePiProjectStandards }
	| {
			status: "blocked";
			reason: "project-standards-unavailable" | "project-standards-invalid" | "project-standards-incomplete";
			missing: string[];
	  };

interface ConfigShape {
	strict_tdd?: boolean;
	context?: string;
	testing?: {
		runner?: {
			command?: string;
		};
	};
	rules?: {
		apply?: unknown;
	};
}

function extractCompactRules(registryMarkdown: string | undefined): string[] {
	if (!registryMarkdown) return [];
	const marker = registryMarkdown.includes("## Compact Rules")
		? "## Compact Rules"
		: "## Selected skills and compact rules";
	const start = registryMarkdown.indexOf(marker);
	if (start === -1) return [];
	return registryMarkdown
		.slice(start + marker.length)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim())
		.filter((line) => line !== "Rules:" && !line.startsWith("Path:") && !line.startsWith("Trigger:"))
		.filter((line) => line.length > 0);
}

function validateRequiredStandards(
	config: ConfigShape,
	rules: readonly string[],
	testCommand: string | undefined,
): string[] {
	const missing: string[] = [];
	if (typeof config.strict_tdd !== "boolean") {
		missing.push("openspec/config.yaml strict_tdd");
	}
	if (typeof config.context !== "string" || config.context.trim().length === 0) {
		missing.push("openspec/config.yaml context");
	}
	if (!testCommand) {
		missing.push("openspec/config.yaml rules.apply.test_command or testing.runner.command");
	}
	if (rules.length === 0) {
		missing.push(".atl/skill-registry.md compact rules");
	}
	return missing;
}

function readRegistry(projectRoot: string, registryMarkdown: string | undefined): string | undefined {
	if (registryMarkdown !== undefined) return registryMarkdown;
	const registryPath = join(projectRoot, ".atl", "skill-registry.md");
	return existsSync(registryPath) ? readFileSync(registryPath, "utf8") : undefined;
}

function parseApplyTestCommand(config: ConfigShape): string | undefined {
	const apply = config.rules?.apply;
	if (apply && typeof apply === "object" && !Array.isArray(apply) && "test_command" in apply) {
		const value = (apply as Record<string, unknown>).test_command;
		return typeof value === "string" ? value : undefined;
	}
	return config.testing?.runner?.command;
}

export function resolveGentlePiProjectStandards(options: {
	projectRoot: string;
	registryMarkdown?: string;
}): GentlePiProjectStandardsResult {
	const configPath = join(options.projectRoot, "openspec", "config.yaml");
	if (!existsSync(configPath)) {
		return { status: "blocked", reason: "project-standards-unavailable", missing: ["openspec/config.yaml"] };
	}
	let config: ConfigShape;
	try {
		config = YAML.parse(readFileSync(configPath, "utf8")) as ConfigShape;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: "blocked",
			reason: "project-standards-invalid",
			missing: [`openspec/config.yaml: ${message}`],
		};
	}
	const strictTdd = config.strict_tdd === true;
	const testCommand = parseApplyTestCommand(config);
	const rules = extractCompactRules(readRegistry(options.projectRoot, options.registryMarkdown));
	const missing = validateRequiredStandards(config, rules, testCommand);
	if (missing.length > 0) {
		return { status: "blocked", reason: "project-standards-incomplete", missing };
	}
	const lines = [
		"## Project Standards (auto-resolved)",
		...(config.context
			? config.context
					.split("\n")
					.map((line) => `- ${line.trim()}`)
					.filter((line) => line !== "- ")
			: []),
		`- Strict TDD: ${strictTdd ? "enabled" : "disabled"}`,
		...(testCommand ? [`- Test command: ${testCommand}`] : []),
		...rules.map((rule) => `- ${rule}`),
	];
	return { status: "success", standards: { strictTdd, testCommand, promptBlock: lines.join("\n") } };
}
