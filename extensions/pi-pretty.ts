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

type PiPrettyExtensionFn = (pi: unknown, deps?: unknown) => unknown;

function unwrapPiPrettyModule(piPrettyModule: unknown): PiPrettyExtensionFn {
	const extension =
		typeof piPrettyModule === "function"
			? piPrettyModule
			: (piPrettyModule as { default: unknown }).default;
	if (typeof extension !== "function") {
		throw new Error("pi-pretty did not export a usable extension function");
	}
	return extension as PiPrettyExtensionFn;
}

async function loadPiPrettyExtension(): Promise<PiPrettyExtensionFn> {
	try {
		return unwrapPiPrettyModule(requireFromRealPackage("@heyhuynhgiabuu/pi-pretty"));
	} catch {
		// Compiled Pi binaries intercept createRequire, so the package-name
		// require fails even when the dependency is installed (gentle-pi#238).
		// ESM import uses filesystem resolution and loads the same module.
		return unwrapPiPrettyModule(await import("@heyhuynhgiabuu/pi-pretty"));
	}
}

export default async function gentlePiPrettyExtension(pi: unknown, deps?: unknown): Promise<unknown> {
	if (quietToolsEnabled()) {
		process.env.PRETTY_DISABLE_TOOLS = mergeDisabledTools(
			process.env.PRETTY_DISABLE_TOOLS,
			PI_PRETTY_SUPPRESSED_TOOL_NAMES,
		);
	}
	const piPrettyExtension = await loadPiPrettyExtension();
	return piPrettyExtension(pi, deps);
}
