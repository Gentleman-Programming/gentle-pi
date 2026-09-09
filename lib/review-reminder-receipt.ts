import { isAbsolute } from "node:path";

// Reminder bookkeeping only: these entries neither define review scope nor grant
// authority. Both extensions append to the parent's active Pi session branch.
export const REVIEW_REMINDER_RECEIPT = "gentle-pi.review-reminder-receipt/v1";
export interface ReceiptSession {
	getSessionId(): string;
	getBranch(): readonly { type: string; customType?: string; data?: unknown }[];
}
interface ReceiptHost { appendEntry(type: string, data: unknown): void }
export interface MutationEvidence {
	source: "direct" | "subagent";
	toolName: "write" | "edit";
	toolCallId: string;
	taskId?: string;
}
type Mutation = MutationEvidence & { kind: "mutation"; sessionId: string; root: string; id: string };
type Consumption = { kind: "nudged" | "acknowledged"; sessionId: string; root: string; through: string; targetIdentity: string };
type Receipt = Mutation | Consumption;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function valid(value: unknown): value is Receipt {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const data = value as Record<string, unknown>;
	if (!text(data.sessionId) || !text(data.root) || !isAbsolute(data.root)) return false;
	let fields: string[];
	if (data.kind === "mutation") {
		if (!text(data.id) || !text(data.toolCallId) || (data.toolName !== "write" && data.toolName !== "edit")) return false;
		if (data.source !== "direct" && data.source !== "subagent") return false;
		if (data.source === "subagent" ? !text(data.taskId) : data.taskId !== undefined) return false;
		if (data.id !== JSON.stringify([data.source, data.taskId ?? "", data.toolCallId])) return false;
		fields = ["kind", "sessionId", "root", "id", "source", "toolName", "toolCallId", ...(data.source === "subagent" ? ["taskId"] : [])];
	} else {
		if (data.kind !== "nudged" && data.kind !== "acknowledged") return false;
		if (!text(data.through) || !text(data.targetIdentity)) return false;
		fields = ["kind", "sessionId", "root", "through", "targetIdentity"];
	}
	return Object.keys(data).length === fields.length && fields.every((field) => Object.hasOwn(data, field));
}

function receipts(session: ReceiptSession, root: string): Receipt[] {
	const sessionId = session.getSessionId();
	return session.getBranch().flatMap((entry) => entry.type === "custom" && entry.customType === REVIEW_REMINDER_RECEIPT &&
		valid(entry.data) && entry.data.sessionId === sessionId && entry.data.root === root ? [entry.data] : []);
}

export function pendingReviewMutation(session: ReceiptSession, root: string, captured?: string): string | undefined {
	const mutations: string[] = [];
	let consumed = -1;
	for (const receipt of receipts(session, root)) {
		if (receipt.kind === "mutation") {
			if (!mutations.includes(receipt.id)) mutations.push(receipt.id);
		} else {
			// Only consume the captured prefix, not writes arriving while native
			// STATUS/ACK was awaited. Unknown or off-branch watermarks do nothing.
			consumed = Math.max(consumed, mutations.indexOf(receipt.through));
		}
	}
	if (captured !== undefined) return mutations.indexOf(captured) > consumed ? captured : undefined;
	return mutations.length - 1 > consumed ? mutations.at(-1) : undefined;
}

export function recordReviewMutation(host: ReceiptHost, session: ReceiptSession, root: string, evidence: MutationEvidence): void {
	const id = JSON.stringify([evidence.source, evidence.taskId ?? "", evidence.toolCallId]);
	const receipt: Mutation = { kind: "mutation", sessionId: session.getSessionId(), root, id, ...evidence };
	if (!valid(receipt) || receipts(session, root).some((entry) => entry.kind === "mutation" && entry.id === id)) return;
	host.appendEntry(REVIEW_REMINDER_RECEIPT, receipt);
}

export function consumeReviewMutation(host: ReceiptHost, session: ReceiptSession, root: string, through: string | undefined, kind: Consumption["kind"], targetIdentity: string): void {
	if (through === undefined) return;
	const receipt: Consumption = { kind, sessionId: session.getSessionId(), root, through, targetIdentity };
	if (valid(receipt)) host.appendEntry(REVIEW_REMINDER_RECEIPT, receipt);
}
