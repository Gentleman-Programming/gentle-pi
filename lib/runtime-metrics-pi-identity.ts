import { findPackageJSON } from "node:module";

// Catalog-name privacy classification ONLY. No identity issuance, route evidence,
// registry reads, SDK hooks, auth resolution, network, or injected catalogs.
export interface PiCatalogName {
	readonly classification: "catalog_public" | "custom" | "unknown";
	readonly modelId: string;
}

const UNKNOWN: PiCatalogName = Object.freeze({ classification: "unknown", modelId: "unknown" });
const CUSTOM: PiCatalogName = Object.freeze({ classification: "custom", modelId: "custom" });
// Initial provider coverage matches the accumulator. Other providers are custom;
// additions require deliberate review. These are providers, not model-ID lists.
const CATALOGS = ["anthropic", "openai", "openai-codex", "google", "google-vertex", "amazon-bedrock", "openrouter"] as const;
const MAX_MODELS = 4096;
const MAX_LOAD_ATTEMPTS = 3;

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

function key(provider: string, modelId: string): string {
	return JSON.stringify([provider, modelId]);
}

async function loadCatalog(): Promise<ReadonlyMap<string, PiCatalogName>> {
	// Node >=22.19 supports findPackageJSON. Verify ESM lookup from this module
	// selects Pi's own pi-ai package; fail rather than silently use another copy.
	const pi = import.meta.resolve("@earendil-works/pi-coding-agent");
	const ownPackage = findPackageJSON("@earendil-works/pi-ai", import.meta.url);
	if (!ownPackage || ownPackage !== findPackageJSON("@earendil-works/pi-ai", pi)) {
		throw new Error("Pi catalog dependency mismatch");
	}
	const entries = new Map<string, PiCatalogName>();
	let count = 0;
	for (const provider of CATALOGS) {
		// pi-ai 0.85.1 providers/* has an import-only export condition: use ESM,
		// never require.resolve. Generated modules load packaged JSON, not registry
		// overrides. Specifiers and export names come only from the fixed list.
		const module = await import(`@earendil-works/pi-ai/providers/${provider}.models`);
		const models: unknown = module[`${provider.replaceAll("-", "_").toUpperCase()}_MODELS`];
		if (!object(models)) throw new Error("Invalid packaged model catalog");
		for (const model of Object.values(models)) {
			if (++count > MAX_MODELS) throw new RangeError("Packaged model catalog exceeds capacity");
			if (!object(model) || model.provider !== provider || !text(model.id, 128)) {
				throw new Error("Invalid packaged model name");
			}
			entries.set(key(provider, model.id), Object.freeze({ classification: "catalog_public", modelId: model.id }));
		}
	}
	return entries;
}

export function createPiCatalogNameLookup(
	load: () => Promise<ReadonlyMap<string, PiCatalogName>> = loadCatalog,
	maxAttempts = MAX_LOAD_ATTEMPTS,
): { lookup(input: unknown): Promise<PiCatalogName>; classify(input: unknown): PiCatalogName } {
	let catalogPromise: Promise<ReadonlyMap<string, PiCatalogName>> | undefined;
	let loadedCatalog: ReadonlyMap<string, PiCatalogName> | undefined;
	let attempts = 0;
	const classify = (input: unknown): PiCatalogName => {
		if (!object(input) || !text(input.provider, 32) || !text(input.modelId, 128)) return UNKNOWN;
		if (!CATALOGS.includes(input.provider as typeof CATALOGS[number])) return CUSTOM;
		return loadedCatalog ? loadedCatalog.get(key(input.provider, input.modelId)) ?? CUSTOM : UNKNOWN;
	};
	const lookup = async (input: unknown): Promise<PiCatalogName> => {
		if (!object(input) || !text(input.provider, 32) || !text(input.modelId, 128)) return UNKNOWN;
		if (!CATALOGS.includes(input.provider as typeof CATALOGS[number])) return CUSTOM;
		if (!loadedCatalog) {
			if (!catalogPromise) {
				if (attempts >= maxAttempts) throw new Error("Pi catalog load attempts exhausted");
				attempts++;
				catalogPromise = load().then(catalog => {
					loadedCatalog = catalog;
					return catalog;
				}, error => {
					catalogPromise = undefined;
					throw error;
				});
			}
			await catalogPromise;
		}
		return classify(input);
	};
	return { lookup, classify };
}

const catalogLookup = createPiCatalogNameLookup();

/**
 * Returns only a privacy-safe catalog name, NOT the model actually dispatched.
 * Matching a public ID remains a public-name fact even on a custom endpoint;
 * origin/API/endpoint strings are ignored, never treated as provenance evidence.
 * Missing/malformed names are unknown; non-catalog names/aliases are custom.
 * No modelVersion is invented. This labels a caller-observed selection only;
 * actual dispatch/response identity requires separate future host evidence.
 * One cached snapshot retains <=4096 names of <=128 code units; no input is kept.
 * Missing/incompatible dependencies and catalog overflow reject, never skip.
 */
export async function lookupPiCatalogName(input: unknown): Promise<PiCatalogName> {
	return catalogLookup.lookup(input);
}

/** Pure lookup after async catalog loading; unknown until initialization succeeds.
 * Always recheck membership, never trust a caller's classification/public label.
 */
export function classifyPiCatalogName(input: unknown): PiCatalogName {
	return catalogLookup.classify(input);
}
