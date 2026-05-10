import { describe, expect, it } from "vitest";
import { resolveGentlePiPhaseRoute, validateGentlePiRoutingPolicy } from "../../../src/core/gentle-pi/model-routing.js";
import type { ModelRegistry } from "../../../src/core/model-registry.js";
import { findInitialModel } from "../../../src/core/model-resolver.js";

describe("gentle pi model routing", () => {
	const routes = {
		proposal: { provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "medium" },
		apply: { provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "high" },
	} as const;

	it("selects deterministic phase-specific routes", () => {
		const proposal = resolveGentlePiPhaseRoute({ phase: "proposal", routes });
		const apply = resolveGentlePiPhaseRoute({ phase: "apply", routes });

		expect(proposal).toEqual({ status: "success", route: routes.proposal });
		expect(apply).toEqual({ status: "success", route: routes.apply });
		expect(resolveGentlePiPhaseRoute({ phase: "apply", routes })).toEqual(apply);
	});

	it("blocks when a phase has no route policy", () => {
		expect(resolveGentlePiPhaseRoute({ phase: "verify", routes })).toEqual({
			status: "blocked",
			reason: "routing-policy-missing",
			phase: "verify",
		});
	});

	it("accepts only Pi-scoped route fields", () => {
		expect(validateGentlePiRoutingPolicy(routes)).toEqual({ status: "success", invalidRoutes: [] });
		expect(
			validateGentlePiRoutingPolicy({
				apply: { provider: "openai-codex", model: "gpt-5.5", temperature: 0.2 },
			}),
		).toEqual({
			status: "blocked",
			invalidRoutes: ["apply.temperature"],
			reason: "unsupported-pi-route-field",
		});
	});

	it("wires phase route policy into initial model resolution", async () => {
		const routedModel = {
			id: "gpt-5.5",
			name: "gpt-5.5",
			provider: "openai-codex",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		} as const;
		const fallbackModel = { ...routedModel, id: "gpt-5.4", name: "gpt-5.4" };
		const modelRegistry = {
			find: (provider: string, modelId: string) =>
				provider === routedModel.provider && modelId === routedModel.id ? routedModel : undefined,
			getAvailable: async () => [fallbackModel],
		} as unknown as ModelRegistry;

		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			modelRegistry,
			gentlePiRoute: { phase: "apply", routes },
		});

		expect(result).toEqual({ model: routedModel, thinkingLevel: "high", fallbackMessage: undefined });
	});

	it("blocks initial model resolution when an active phase has no route policy", async () => {
		const modelRegistry = {
			find: () => undefined,
			getAvailable: async () => [],
		} as unknown as ModelRegistry;

		await expect(
			findInitialModel({
				scopedModels: [],
				isContinuing: false,
				modelRegistry,
				gentlePiRoute: { phase: "verify", routes },
			}),
		).rejects.toThrow("routing-policy-missing:verify");
	});
});
