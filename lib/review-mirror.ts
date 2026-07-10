import { canonicalJsonV1, parseCanonicalJsonV1 } from "./review-canonical.ts";
import { type ReviewEventEnvelopeV1, validateReviewEventV1 } from "./review-graph-schema.ts";

export interface VerifiedGraphObject {
	readonly eventId: string;
	readonly canonicalBytes: Uint8Array;
}

export interface MirrorCompletenessV1 {
	readonly declaredRoots: readonly string[];
	readonly complete: boolean;
	readonly missingObjectIds: readonly string[];
}

/** A non-authoritative object cache. It deliberately has no mutation, receipt, or gate API. */
export class ReviewMirrorStore {
	readonly #objects = new Map<string, VerifiedGraphObject>();

	getVerifiedObject(eventId: string): VerifiedGraphObject | undefined {
		return this.#objects.get(eventId);
	}

	putVerifiedObject(bytes: Uint8Array): VerifiedGraphObject {
		let event: ReviewEventEnvelopeV1;
		try {
			event = parseCanonicalJsonV1(bytes) as ReviewEventEnvelopeV1;
			validateReviewEventV1(event);
		} catch (error) {
			throw new Error(`Mirror object identity is invalid: ${error instanceof Error ? error.message : String(error)}`);
		}
		const canonical = new TextEncoder().encode(canonicalJsonV1(event));
		const existing = this.#objects.get(event.event_id);
		if (existing && !Buffer.from(existing.canonicalBytes).equals(Buffer.from(canonical))) {
			throw new Error("Mirror object identity conflicts with cached bytes");
		}
		const object = existing ?? Object.freeze({ eventId: event.event_id, canonicalBytes: canonical });
		this.#objects.set(event.event_id, object);
		return object;
	}

	inspectCompleteness(roots: readonly string[]): MirrorCompletenessV1 {
		const declaredRoots = [...roots].toSorted();
		const missingObjectIds = declaredRoots.filter((root) => !this.#objects.has(root));
		return Object.freeze({ declaredRoots, complete: missingObjectIds.length === 0, missingObjectIds });
	}
}
