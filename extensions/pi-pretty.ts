import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
	mergeDisabledTools,
	PI_PRETTY_SUPPRESSED_TOOL_NAMES,
	quietToolsEnabled,
} from "../lib/quiet-tools-config.ts";

const packageJsonPath = realpathSync(
	fileURLToPath(new URL("../package.json", import.meta.url)),
);
const requireFromRealPackage = createRequire(packageJsonPath);
const piPrettyModule = requireFromRealPackage("@heyhuynhgiabuu/pi-pretty");

const piPrettyExtension =
	typeof piPrettyModule === "function"
		? piPrettyModule
		: piPrettyModule.default;

export default async function gentlePiPrettyExtension(pi: unknown, deps?: unknown): Promise<unknown> {
	if (quietToolsEnabled()) {
		process.env.PRETTY_DISABLE_TOOLS = mergeDisabledTools(
			process.env.PRETTY_DISABLE_TOOLS,
			PI_PRETTY_SUPPRESSED_TOOL_NAMES,
		);
	}
	return piPrettyExtension(pi, deps);
}
