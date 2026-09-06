import { Container, type Component } from "@earendil-works/pi-tui";

export interface NativeFullscreenInteractionOptions {
	keyboardTarget: Component;
	requestRender(): void;
}

export class NativeFullscreenInteraction extends Container {
	private readonly options: NativeFullscreenInteractionOptions;

	constructor(options: NativeFullscreenInteractionOptions) {
		super();
		this.options = options;
	}

	handleInput(data: string): void {
		if (!this.options.keyboardTarget.handleInput) return;
		this.options.keyboardTarget.handleInput(data);
		this.options.requestRender();
	}
}

/**
 * Compose native Container mouse dispatch with one keyboard-owning control.
 * The returned root intentionally inherits Container.handleMouse unchanged so
 * native layout, targeting, focus, wheel, and click semantics stay intact.
 */
export function createNativeFullscreenInteraction(
	options: NativeFullscreenInteractionOptions,
): NativeFullscreenInteraction {
	return new NativeFullscreenInteraction(options);
}
