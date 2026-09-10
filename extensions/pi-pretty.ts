import {
	mergeDisabledTools,
	PI_PRETTY_SUPPRESSED_TOOL_NAMES,
	quietToolsEnabled,
} from "../lib/quiet-tools-config.ts";

// Cached dynamic import: compiled Pi (Bun) createRequire ignores package `main`/`exports`
// (pi-pretty uses main: dist/index.js). ESM import resolves correctly. See #238.
let piPrettyModulePromise: Promise<typeof import("@heyhuynhgiabuu/pi-pretty")> | undefined;

export default async function gentlePiPrettyExtension(pi: unknown, deps?: unknown): Promise<unknown> {
	if (quietToolsEnabled()) {
		process.env.PRETTY_DISABLE_TOOLS = mergeDisabledTools(
			process.env.PRETTY_DISABLE_TOOLS,
			PI_PRETTY_SUPPRESSED_TOOL_NAMES,
		);
	}

	let piPrettyModule;
	try {
		piPrettyModule = await (piPrettyModulePromise ??= import("@heyhuynhgiabuu/pi-pretty"));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		console.error(
			`[gentle-pi] @heyhuynhgiabuu/pi-pretty could not be loaded (${detail}); pretty output formatting disabled.`,
		);
		return undefined;
	}

	const piPrettyExtension =
		typeof piPrettyModule === "function"
			? piPrettyModule
			: (piPrettyModule as { default?: unknown }).default;

	if (typeof piPrettyExtension !== "function") {
		console.error(
			"[gentle-pi] @heyhuynhgiabuu/pi-pretty loaded but did not export an extension function; pretty output formatting disabled.",
		);
		return undefined;
	}

	return piPrettyExtension(pi, deps);
}
