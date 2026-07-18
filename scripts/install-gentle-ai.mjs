#!/usr/bin/env node
import { installGentleAi } from "./gentle-ai-installer.mjs";

if (process.env.GENTLE_PI_SKIP_GENTLE_AI_INSTALL === "1") {
	console.warn("GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1: skipped package-local Gentle AI installation; native review operations will fail with package-local-binary-missing until gentle-pi is reinstalled.");
} else {
	try {
		const result = await installGentleAi();
		console.log(`Gentle AI v2.1.7 ${result.installed ? "installed" : "integrity-verified"} at ${result.binaryPath}`);
	} catch (error) {
		console.error(`gentle-pi could not install its package-local Gentle AI v2.1.7 binary: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
