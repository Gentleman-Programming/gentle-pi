import assert from "node:assert/strict";
import test from "node:test";
import { findPackageJSON } from "node:module";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { classifyPiCatalogName, lookupPiCatalogName } from "../lib/runtime-metrics-pi-identity.ts";
import { RuntimeMetrics, type FinalResponse } from "../lib/runtime-metrics.ts";

const model = Object.values(OPENAI_CODEX_MODELS)[0];
const name = { provider: model.provider, modelId: model.id };

test("uninitialized synchronous classification fails closed", () => {
	assert.deepEqual(classifyPiCatalogName(name), { classification: "unknown", modelId: "unknown" });
});

test("missing catalog name remains unknown; no route evidence is invented", async () => {
	for (const input of [undefined, null, {}, { provider: model.provider }, { modelId: model.id }]) {
		assert.deepEqual(await lookupPiCatalogName(input), { classification: "unknown", modelId: "unknown" });
	}
});

test("custom aliases never export supplied strings", async () => {
	for (const input of [{ ...name, modelId: "private-alias" }, { ...name, provider: "private-provider" }]) {
		const result = await lookupPiCatalogName(input);
		assert.deepEqual(result, { classification: "custom", modelId: "custom" });
		assert.ok(Object.isFrozen(result));
	}
});

test("caller-created public identities cannot bypass the catalog boundary", async () => {
	for (const input of [{ modelId: "private-model", classification: "catalog_public" },
		{ ...name, modelId: "private-model", origin: "builtin" }]) {
		assert.notEqual((await lookupPiCatalogName(input)).classification, "catalog_public");
	}
});

test("malformed or oversized name metadata fails closed", async () => {
	for (const patch of [{ modelId: "" }, { modelId: "x".repeat(129) }, { provider: 12 },
		{ modelId: null }, { provider: "x".repeat(33) }]) {
		assert.deepEqual(await lookupPiCatalogName({ ...name, ...patch }), { classification: "unknown", modelId: "unknown" });
	}
});

test("actual installed ESM catalog supplies immutable public names, not route claims", async () => {
	const pi = import.meta.resolve("@earendil-works/pi-coding-agent");
	assert.equal(findPackageJSON("@earendil-works/pi-ai", import.meta.url), findPackageJSON("@earendil-works/pi-ai", pi));
	assert.ok(model);
	const result = await lookupPiCatalogName(name);
	assert.deepEqual(result, { classification: "catalog_public", modelId: model.id });
	assert.ok(Object.isFrozen(result));
	assert.strictEqual(await lookupPiCatalogName(name), result);
	// Origin/endpoint assertions do not change privacy classification of a name.
	// Neither a real catalog entry nor matching route strings establish dispatch.
	for (const patch of [{ origin: "builtin" }, { origin: "unknown" }, { origin: "custom" },
		{ baseUrl: "https://private.invalid" }, { api: "custom-api" }]) {
		assert.strictEqual(await lookupPiCatalogName({ ...name, ...patch }), result);
	}
	assert.deepEqual(Object.keys(result), ["classification", "modelId"]);
	assert.ok(!("modelVersion" in result));
});

test("catalog-public selections are counted without claiming actual route identity", async () => {
	const catalogName = await lookupPiCatalogName(name);
	const metrics = new RuntimeMetrics();
	const missing = { state: "unavailable" } as const;
	for (const [index, identity] of [catalogName, { ...name, origin: "builtin", api: model.api, baseUrl: model.baseUrl }].entries()) {
		const record = {
			kind: "final_assistant_response", responseId: String(index), identity, selectedModelId: model.id,
			executor: "worker", provider: model.provider, modelFamily: "gpt", effort: "high", error: "none",
			tokens: { input: missing, output: missing, cacheRead: missing, cacheWrite: missing },
			responseHeadersMs: missing, fullResponseMs: missing,
		};
		assert.equal(metrics.record(record as FinalResponse), "recorded");
	}
	const [bucket] = metrics.snapshot();
	assert.equal(bucket.selectedModelId, model.id);
	assert.ok(!("modelId" in bucket));
	assert.ok(!("route" in bucket));
	assert.equal(bucket.responses, 2);
	assert.equal(bucket.hostAgent, "pi");
});

test("selection classification rejects fabricated public labels and private IDs", async () => {
	await lookupPiCatalogName(name);
	assert.equal(classifyPiCatalogName({ ...name, modelId: "private-id", classification: "catalog_public" }).modelId, "custom");
	assert.equal(classifyPiCatalogName({ ...name, provider: "anthropic" }).modelId, "custom");
});
