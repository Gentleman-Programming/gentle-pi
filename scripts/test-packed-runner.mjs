#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "gentle-pi-packed-runner-"));
const packDirectory = join(temporary, "pack");
const installDirectory = join(temporary, "install");

try {
	mkdirSync(packDirectory);
	mkdirSync(installDirectory);
	const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	}));
	if (packed.length !== 1 || typeof packed[0]?.filename !== "string") throw new Error("npm pack did not return one tarball");
	const tarball = join(packDirectory, packed[0].filename);
	writeFileSync(join(installDirectory, "package.json"), JSON.stringify({ name: "gentle-pi-packed-runner-test", private: true }), "utf8");
	execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--omit=dev", "--legacy-peer-deps", tarball], {
		cwd: installDirectory,
		stdio: "inherit",
	});
	const runner = join(installDirectory, "node_modules", "gentle-pi", "scripts", "run-git-commit-transaction.mjs");
	const result = JSON.parse(execFileSync(process.execPath, [runner, "self-test"], { cwd: installDirectory, encoding: "utf8" }));
	if (result.schema !== "gentle-pi.git-commit-transaction-runner-self-test/v1" || !Array.isArray(result.states) || !result.states.includes("prepared") || !result.states.includes("committed")) {
		throw new Error("installed transaction runner self-test returned an incompatible result");
	}
	const packageManifest = JSON.parse(readFileSync(join(installDirectory, "node_modules", "gentle-pi", "package.json"), "utf8"));
	process.stdout.write(`packed runner E2E passed (gentle-pi ${packageManifest.version ?? "unknown"}; ${result.states.length} states)\n`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
