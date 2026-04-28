import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamSimple } from "../src/stream.js";
import type { Context, Model } from "../src/types.js";

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: unknown) => {
					mockState.lastParams = params;
					const response = {
						id: "chatcmpl-image-1",
						usage: {
							prompt_tokens: 12,
							completion_tokens: 34,
							prompt_tokens_details: { cached_tokens: 0 },
						},
						choices: [
							{
								finish_reason: "stop",
								message: {
									role: "assistant",
									content: "Here is your image.",
									images: [
										{
											image_url: "data:image/png;base64,ZmFrZS1wbmc=",
										},
									],
								},
							},
						],
					};
					const promise = Promise.resolve(response) as Promise<typeof response> & {
						withResponse: () => Promise<{
							data: typeof response;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: response,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

describe("openai-completions image output", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
	});

	it("switches OpenRouter image generation models to non-streaming and emits image events", async () => {
		const model: Model<"openai-completions"> = {
			id: "black-forest-labs/flux.2-pro",
			name: "Black Forest Labs: FLUX.2 Pro",
			api: "openai-completions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			compat: { openRouterImageGeneration: true },
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100000,
			maxTokens: 100000,
		};
		const context: Context = {
			messages: [{ role: "user", content: "Generate a cat", timestamp: Date.now() }],
		};

		const result = streamSimple(model, context, { apiKey: "test" });
		const eventTypes: string[] = [];
		for await (const event of result) {
			eventTypes.push(event.type);
		}

		const message = await result.result();
		expect(eventTypes).toEqual(["start", "text_start", "text_delta", "text_end", "image_start", "image_end", "done"]);
		expect(message.responseId).toBe("chatcmpl-image-1");
		expect(message.content[0]).toMatchObject({ type: "text", text: "Here is your image." });
		expect(message.content[1]).toMatchObject({
			type: "image",
			mimeType: "image/png",
			data: "ZmFrZS1wbmc=",
		});

		const params = mockState.lastParams as { stream?: boolean; stream_options?: unknown };
		expect(params.stream).toBe(false);
		expect("stream_options" in (params as object)).toBe(false);
	});
});
