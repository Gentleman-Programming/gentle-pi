import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG_REL_PATH = "openspec/config.yaml";

function escapeBlockScalar(value: string): string {
	return value
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}

function renderConfig(strictTdd: boolean, testCommand: string, context: string): string {
	const lines = [
		`strict_tdd: ${strictTdd}`,
		"context: |",
		escapeBlockScalar(context.trimEnd()),
		"rules:",
		"  apply:",
		`    test_command: ${testCommand}`,
		"testing:",
		"  runner:",
		`    command: ${testCommand}`,
		"",
	];
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("sdd-init", {
		description: "Bootstrap openspec/config.yaml for SDD workflow (one-time per project).",
		handler: async (_args, ctx) => {
			const configPath = join(ctx.cwd, CONFIG_REL_PATH);
			if (existsSync(configPath)) {
				ctx.ui.notify(
					`${CONFIG_REL_PATH} already exists. Edit it manually or remove it before re-running /sdd-init.`,
					"warning",
				);
				return;
			}

			const TDD_YES = "Yes — tests must run before each change";
			const TDD_NO = "No — TDD is opt-in per task";
			const TDD_CANCEL = "Cancel";
			const tddChoice = await ctx.ui.select("Enable strict TDD for this project?", [
				TDD_YES,
				TDD_NO,
				TDD_CANCEL,
			]);
			if (!tddChoice || tddChoice === TDD_CANCEL) {
				ctx.ui.notify("sdd-init cancelled.", "info");
				return;
			}
			const strictTdd = tddChoice === TDD_YES;

			const testCommand = await ctx.ui.input(
				"Test command",
				"e.g. npm test, pnpm vitest, cargo test",
			);
			if (!testCommand) {
				ctx.ui.notify("sdd-init cancelled (no test command).", "info");
				return;
			}

			const context = await ctx.ui.input(
				"Project context (one paragraph)",
				"Describe the project, stack, and constraints.",
			);
			if (!context) {
				ctx.ui.notify("sdd-init cancelled (no context).", "info");
				return;
			}

			mkdirSync(dirname(configPath), { recursive: true });
			writeFileSync(configPath, renderConfig(strictTdd, testCommand.trim(), context));
			ctx.ui.notify(
				`Wrote ${CONFIG_REL_PATH}. Run /skill-registry:refresh once skills with '## Compact Rules' are available.`,
				"info",
			);
		},
	});
}
