import { domainHashV1 } from "./review-canonical.ts";

const DIGEST = /^[0-9a-f]{64}$/;
const LINEAGE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const REDUCER_TRANSITIONS = new Set([
	"start",
	"operation-prepared",
	"gate",
	"ordinary-discovery",
	"ordinary-evidence",
	"ordinary-fix",
	"ordinary-no-fix",
	"ordinary-validation",
	"ordinary-final-verification",
	"judgment-day-discovery",
	"judgment-day-fix",
	"judgment-day-rejudgment",
	"judgment-day-final-verification",
]);

export class ReviewGraphSchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReviewGraphSchemaError";
	}
}

export const REVIEW_EVENT_KIND_V1 = {
	LINEAGE_CREATED: "lineage-created",
	OPERATION_PREPARED: "operation-prepared",
	OPERATION_COMPLETED: "operation-completed",
	GATE_EVALUATED: "gate-evaluated",
} as const;

export type ReviewEventKindV1 = (typeof REVIEW_EVENT_KIND_V1)[keyof typeof REVIEW_EVENT_KIND_V1];

export interface ReviewEventBodyV1 {
	schema: "gentle-ai.review-event/v1";
	store_epoch?: string;
	authority_incarnation_id?: string;
	initialized_by_reset_id?: string | null;
	lineage_id: string;
	sequence: number;
	predecessor_event_id: string | null;
	kind: ReviewEventKindV1;
	reducer_transition?: string;
	reducer_input?: unknown;
	payload: unknown;
	reduced_state_hash: string;
}

export interface ReviewEventEnvelopeV1 {
	body: ReviewEventBodyV1;
	event_id: string;
}

export type CreateReviewEventInputV1 = Omit<ReviewEventBodyV1, "schema"> & { schema?: ReviewEventBodyV1["schema"] };

function assertDigest(value: string, label: string): void {
	if (!DIGEST.test(value)) throw new ReviewGraphSchemaError(`${label} must be a lowercase SHA-256 digest`);
}

function assertBody(body: ReviewEventBodyV1): void {
	const allowed = new Set(["schema", "store_epoch", "authority_incarnation_id", "initialized_by_reset_id", "lineage_id", "sequence", "predecessor_event_id", "kind", "reducer_transition", "reducer_input", "payload", "reduced_state_hash"]);
	if (Object.keys(body).some((key) => !allowed.has(key))) throw new ReviewGraphSchemaError("Review event contains unknown properties");
	if (body.schema !== "gentle-ai.review-event/v1") throw new ReviewGraphSchemaError("Unsupported review event schema");
	if ((body.store_epoch !== undefined && !DIGEST.test(body.store_epoch)) || (body.authority_incarnation_id !== undefined && !DIGEST.test(body.authority_incarnation_id)) || (body.initialized_by_reset_id !== undefined && body.initialized_by_reset_id !== null && !DIGEST.test(body.initialized_by_reset_id))) throw new ReviewGraphSchemaError("Review event incarnation is invalid");
	if (!LINEAGE.test(body.lineage_id)) throw new ReviewGraphSchemaError("Review event lineage ID is invalid");
	if (!Number.isSafeInteger(body.sequence) || body.sequence < 0) throw new ReviewGraphSchemaError("Review event sequence is invalid");
	if (!Object.values(REVIEW_EVENT_KIND_V1).includes(body.kind)) throw new ReviewGraphSchemaError("Review event kind is invalid");
	if ((body.reducer_transition === undefined) !== (body.reducer_input === undefined) || (body.reducer_transition !== undefined && (typeof body.reducer_transition !== "string" || !REDUCER_TRANSITIONS.has(body.reducer_transition)))) throw new ReviewGraphSchemaError("Review event reducer transition/input is invalid");
	if (body.kind === REVIEW_EVENT_KIND_V1.GATE_EVALUATED && body.reducer_transition !== "gate") throw new ReviewGraphSchemaError("Gate event must use the gate replay transition");
	if (body.reducer_transition === "gate" && body.kind !== REVIEW_EVENT_KIND_V1.GATE_EVALUATED) throw new ReviewGraphSchemaError("Gate replay transition requires a gate event");
	assertDigest(body.reduced_state_hash, "Review event state hash");
	if (body.sequence === 0) {
		if (body.predecessor_event_id !== null || body.kind !== REVIEW_EVENT_KIND_V1.LINEAGE_CREATED) {
			throw new ReviewGraphSchemaError("Genesis event must have sequence zero, no predecessor, and lineage-created kind");
		}
	} else if (body.predecessor_event_id === null) {
		throw new ReviewGraphSchemaError("Non-genesis event requires a predecessor");
	} else {
		assertDigest(body.predecessor_event_id, "Review event predecessor");
	}
}

export function createReviewEventV1(input: CreateReviewEventInputV1): ReviewEventEnvelopeV1 {
	const body: ReviewEventBodyV1 = { ...input, schema: "gentle-ai.review-event/v1" };
	assertBody(body);
	return { body, event_id: domainHashV1("event", body) };
}

export function validateReviewEventV1(value: ReviewEventEnvelopeV1): ReviewEventEnvelopeV1 {
	assertBody(value.body);
	assertDigest(value.event_id, "Review event identity");
	if (domainHashV1("event", value.body) !== value.event_id) throw new ReviewGraphSchemaError("Review event identity does not match canonical body");
	return value;
}
