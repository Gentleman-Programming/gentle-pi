import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readModelConfig, readModelConfigAsync } from "../extensions/gentle-ai.ts";

test("model routing authority normalizes and preserves sync/async source status", async (t) => {
	const loaded = await import("../lib/model-routing-authority.ts").then(
		(module) => ({ module, error: undefined }),
		(error) => ({ module: undefined, error }),
	);
	assert.ok(
		loaded.module,
		`shared model routing authority must load: ${String(loaded.error)}`,
	);
	const authority = loaded.module;
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-model-routing-authority-"));
	const globalDir = join(root, "global");
	const projectDir = join(root, "project");
	const projectConfigDir = join(projectDir, ".pi", "gentle-ai");
	const agentsDir = join(root, "agents");
	mkdirSync(globalDir, { recursive: true });
	mkdirSync(projectConfigDir, { recursive: true });
	mkdirSync(agentsDir, { recursive: true });
	t.after(() => rmSync(root, { recursive: true, force: true }));

	assert.equal(authority.normalizeModelId(" openai/gpt-5 "), "openai/gpt-5");
	assert.equal(authority.normalizeModelId("bad model"), undefined);
	assert.deepEqual(authority.normalizeRoutingEntry(" inherit "), { model: "inherit" });
	assert.deepEqual(
		authority.normalizeRoutingEntry({ model: " anthropic/opus ", thinking: "high" }),
		{ model: "anthropic/opus", thinking: "high" },
	);
	assert.deepEqual(authority.normalizeRoutingEntry(null), undefined);
	assert.deepEqual(
		authority.normalizeModelConfig({
			worker: " openai/gpt-5 ",
			clear: {},
			"not valid": "ignored",
			nullValue: null,
		}),
		{ worker: { model: "openai/gpt-5" }, clear: {} },
	);

	const missingPath = join(globalDir, "missing.json");
	assert.deepEqual(authority.readModelConfigFile(missingPath), { status: "missing" });
	assert.deepEqual(await authority.readModelConfigFileAsync(missingPath), { status: "missing" });

	const validGlobalPath = join(globalDir, "valid.json");
	writeFileSync(
		validGlobalPath,
		JSON.stringify({ worker: "openai/gpt-5", reviewer: { thinking: "medium" }, "not valid": "openai/gpt-4" }),
	);
	const validSync = authority.readModelConfigFile(validGlobalPath);
	const validAsync = await authority.readModelConfigFileAsync(validGlobalPath);
	assert.deepEqual(validSync, {
		status: "valid",
		config: {
			worker: { model: "openai/gpt-5" },
			reviewer: { model: undefined, thinking: "medium" },
			"not valid": { model: "openai/gpt-4" },
		},
	});
	assert.deepEqual(validAsync, validSync);

	const invalidGlobalPath = join(globalDir, "invalid.json");
	writeFileSync(invalidGlobalPath, "[]");
	assert.deepEqual(authority.readModelConfigFile(invalidGlobalPath), {
		status: "invalid",
		path: invalidGlobalPath,
	});
	assert.deepEqual(await authority.readModelConfigFileAsync(invalidGlobalPath), {
		status: "invalid",
		path: invalidGlobalPath,
	});

	const projectPath = join(projectConfigDir, "models.json");
	writeFileSync(projectPath, JSON.stringify({ project: "google/gemini" }));
	assert.deepEqual(
		authority.readSavedModelConfig(missingPath, projectPath),
		{ status: "valid", config: { project: { model: "google/gemini" } } },
	);
	assert.deepEqual(
		await authority.readSavedModelConfigAsync(missingPath, projectPath),
		await authority.readSavedModelConfig(missingPath, projectPath),
	);
	assert.deepEqual(authority.readSavedModelConfig(invalidGlobalPath, projectPath), {
		status: "invalid",
		path: invalidGlobalPath,
	});
	assert.deepEqual(await authority.readSavedModelConfigAsync(invalidGlobalPath, projectPath), {
		status: "invalid",
		path: invalidGlobalPath,
	});

	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	process.env.GENTLE_PI_CONFIG_HOME = globalDir;
	t.after(() => {
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
	});
	writeFileSync(projectPath, JSON.stringify({ project: "google/gemini" }));
	assert.deepEqual(readModelConfig(projectDir), { project: { model: "google/gemini" } });
	assert.deepEqual(await readModelConfigAsync(projectDir), readModelConfig(projectDir));

	writeFileSync(projectPath, "[]");
	assert.deepEqual(authority.readModelConfigFile(projectPath), { status: "invalid", path: projectPath });
	assert.deepEqual(await authority.readModelConfigFileAsync(projectPath), { status: "invalid", path: projectPath });
	assert.deepEqual(readModelConfig(projectDir), {});
	assert.deepEqual(await readModelConfigAsync(projectDir), {});

	writeFileSync(join(globalDir, "models.json"), JSON.stringify({ global: "openai/gpt-5" }));
	assert.deepEqual(readModelConfig(projectDir), { global: { model: "openai/gpt-5" } });
	assert.deepEqual(await readModelConfigAsync(projectDir), readModelConfig(projectDir));

	writeFileSync(join(globalDir, "models.json"), "[]");
	assert.deepEqual(readModelConfig(projectDir), {});
	assert.deepEqual(await readModelConfigAsync(projectDir), {});
});
