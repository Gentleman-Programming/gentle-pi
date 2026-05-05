import "./providers/images/register-builtins.js";

import { getImagesApiProvider } from "./images-api-registry.js";
import type {
	AssistantImages,
	AssistantImagesEventStream,
	ImagesApi,
	ImagesContext,
	ImagesModel,
	ImagesOptions,
	ProviderImagesOptions,
} from "./types.js";

function resolveImagesApiProvider(api: ImagesApi) {
	const provider = getImagesApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

export function images<TApi extends ImagesApi>(
	model: ImagesModel<TApi>,
	context: ImagesContext,
	options?: ProviderImagesOptions,
): AssistantImagesEventStream {
	const provider = resolveImagesApiProvider(model.api);
	return provider.images(model, context, options as ImagesOptions);
}

export async function generateImages<TApi extends ImagesApi>(
	model: ImagesModel<TApi>,
	context: ImagesContext,
	options?: ProviderImagesOptions,
): Promise<AssistantImages> {
	const s = images(model, context, options);
	return s.result();
}
