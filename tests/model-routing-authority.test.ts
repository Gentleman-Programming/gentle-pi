import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicSync, modelConfigPath, normalizeModelConfig, normalizeRoutingEntry, readModelConfigFile, resolveModelRoutingTarget, writeModelConfigFile } from "../lib/model-routing-authority.ts";
function withScratch(run: (cwd: string) => void): void {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-routing-authority-"));
	try { run(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}
test("normalizes legacy values and inherit omission without dropping unknown agents", () => {
	assert.deepEqual(normalizeRoutingEntry("openai/gpt-5"), { model: "openai/gpt-5" });
	assert.deepEqual(normalizeRoutingEntry({ model: "inherit", effort: "high" }), { thinking: "high" });
	assert.deepEqual(normalizeModelConfig({ unknown: { model: "other/provider" }, known: { thinking: "low" } }), { unknown: { model: "other/provider" }, known: { thinking: "low" } });
	assert.equal(normalizeModelConfig({ known: { thinking: "invalid" } }), undefined);
});
test("resolves isolated targets and updates only the explicit document", () => withScratch((cwd) => {
	const roots = { configHome: join(cwd, "home", "gentle-ai"), agentHome: join(cwd, "home", "pi") };
	const global = resolveModelRoutingTarget(cwd, "global", roots), project = resolveModelRoutingTarget(cwd, "project", roots);
	assert.equal(global.configPath, join(roots.configHome, "models.json"));
	assert.equal(project.configPath, join(cwd, ".pi", "gentle-ai", "models.json"));
	assert.equal(global.profilePath, join(roots.agentHome, "subagents.json"));
	assert.equal(project.profilePath, join(cwd, ".pi", "subagents.json"));
	writeModelConfigFile(global.configPath, { global: { model: "global/provider" } });
	writeModelConfigFile(project.configPath, { project: { model: "project/provider" } });
	const globalBytes = readFileSync(global.configPath, "utf8"), projectBytes = readFileSync(project.configPath, "utf8");
	writeModelConfigFile(project.configPath, { project: { model: "updated/provider" } });
	assert.equal(readFileSync(global.configPath, "utf8"), globalBytes);
	assert.notEqual(readFileSync(project.configPath, "utf8"), projectBytes);
}));
test("fails closed on malformed existing config and cleans failed replacements", () => withScratch((cwd) => {
	const path = modelConfigPath(cwd, "project");
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(path, "{ malformed", "utf8");
	assert.deepEqual(readModelConfigFile(path), { status: "invalid", path });
	assert.throws(() => writeModelConfigFile(path, { known: { model: "safe/provider" } }), /invalid/i);
	assert.equal(readFileSync(path, "utf8"), "{ malformed");
	const blockedPath = join(cwd, "blocked-models.json");
	mkdirSync(blockedPath);
	assert.throws(() => atomicSync(blockedPath, "{}\n"), /failed to replace/i);
	assert.deepEqual(readdirSync(cwd).filter((entry) => entry.startsWith("blocked-models.json.") && entry.endsWith(".tmp")), []);
}));
test("atomically round-trips unrelated assignment keys", () => withScratch((cwd) => {
	const path = join(cwd, "models.json");
	writeFileSync(path, JSON.stringify({ known: { model: "old/provider" }, unknown: { model: "keep/provider" } }));
	const saved = readModelConfigFile(path);
	assert.equal(saved.status, "valid");
	if (saved.status !== "valid") return;
	saved.config.known = { model: "new/provider" };
	writeModelConfigFile(path, saved.config);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { known: { model: "new/provider" }, unknown: { model: "keep/provider" } });
}));
