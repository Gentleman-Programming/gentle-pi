import { type ReviewEventEnvelopeV1, validateReviewEventV1 } from "./review-graph-schema.ts";

export class ReviewGraphIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReviewGraphIntegrityError";
	}
}

export interface ReducedReviewGraphV1<TState> {
	state: TState;
	state_hash: string;
	sequence: number;
	lineage_id: string;
	event_ids: readonly string[];
}

export type ReviewGraphStepV1<TState> = (previous: TState | undefined, event: ReviewEventEnvelopeV1) => { state: TState; state_hash: string };

export function reduceReviewGraphV1<TState>(headEventId: string, events: ReadonlyMap<string, ReviewEventEnvelopeV1>, step: ReviewGraphStepV1<TState>, maxEvents = 10_000): ReducedReviewGraphV1<TState> {
	if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new ReviewGraphIntegrityError("Graph event limit is invalid");
	const reversed: ReviewEventEnvelopeV1[] = [];
	const seen = new Set<string>();
	let currentId: string | null = headEventId;
	while (currentId !== null) {
		if (seen.has(currentId)) throw new ReviewGraphIntegrityError("Review graph contains a cycle");
		if (reversed.length >= maxEvents) throw new ReviewGraphIntegrityError("Review graph exceeds the configured event limit");
		const event = events.get(currentId);
		if (!event) throw new ReviewGraphIntegrityError("Review graph has a missing predecessor");
		try {
			validateReviewEventV1(event);
		} catch (error) {
			throw new ReviewGraphIntegrityError(`Review graph event is invalid: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (event.event_id !== currentId) throw new ReviewGraphIntegrityError("Review graph object key does not match event identity");
		seen.add(currentId);
		reversed.push(event);
		currentId = event.body.predecessor_event_id;
	}
	const chain = reversed.reverse();
	if (chain.length === 0 || chain[0]!.body.sequence !== 0 || chain[0]!.body.kind !== "lineage-created") throw new ReviewGraphIntegrityError("Review graph requires an explicit genesis event");
	let state: TState | undefined;
	let stateHash = "";
	const lineageId = chain[0]!.body.lineage_id;
	for (let index = 0; index < chain.length; index += 1) {
		const event = chain[index]!;
		if (event.body.lineage_id !== lineageId) throw new ReviewGraphIntegrityError("Review graph predecessor lineage does not match");
		if (event.body.sequence !== index) throw new ReviewGraphIntegrityError("Review graph sequence is not contiguous");
		const next = step(state, event);
		if (next.state_hash !== event.body.reduced_state_hash) throw new ReviewGraphIntegrityError("Review graph reduced state hash does not match event");
		state = next.state;
		stateHash = next.state_hash;
	}
	return { state: state as TState, state_hash: stateHash, sequence: chain.length - 1, lineage_id: lineageId, event_ids: Object.freeze(chain.map((event) => event.event_id)) };
}
