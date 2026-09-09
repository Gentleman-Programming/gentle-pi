export const CHILD_MESSAGE_MAX_BYTES = 8 * 1024;
export const CHILD_ACK_ERROR_MAX_BYTES = 256;
export const CHILD_MESSAGE_MAX_INFLIGHT = 8;
export const CHILD_MESSAGE_TIMEOUT_MS = 2_000;

export interface NotificationFrame {
	id: string;
	kind: "notification";
	message: string;
}

interface AckFrame {
	id: string;
	accepted: boolean;
	error?: string;
}

export interface IpcEndpoint {
	connected?: boolean;
	send(message: unknown, callback?: (error: Error | null) => void): boolean;
	on(event: "message" | "disconnect", listener: (...args: unknown[]) => void): unknown;
}

type Cancel = () => void;
type Schedule = (fn: () => void, ms: number) => Cancel;
type Pending = { resolve: () => void; reject: (error: Error) => void; cancel: Cancel };

function record(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

function wellFormedUnicode(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xD800 && code <= 0xDBFF) {
			const next = value.charCodeAt(index + 1);
			if (index + 1 >= value.length || next < 0xDC00 || next > 0xDFFF) return false;
			index += 1;
		} else if (code >= 0xDC00 && code <= 0xDFFF) return false;
	}
	return true;
}

function boundedText(value: unknown, maxBytes: number): value is string {
	return typeof value === "string" && wellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= maxBytes;
}

export function validChildId(value: unknown): value is string {
	if (typeof value !== "string" || !/^n[1-9]\d{0,15}$/.test(value)) return false;
	const counter = Number(value.slice(1));
	return Number.isSafeInteger(counter) && counter > 0;
}

export function validChildMessage(value: unknown): value is string {
	return boundedText(value, CHILD_MESSAGE_MAX_BYTES);
}

export function parseChildFrame(value: unknown): { frame?: NotificationFrame; id?: string; error?: string } {
	if (!record(value)) return { error: "invalid child IPC frame" };
	const id = validChildId(value.id) ? value.id : undefined;
	if (!exact(value, ["id", "kind", "message"])) return { ...(id === undefined ? {} : { id }), error: "invalid child IPC frame" };
	if (id === undefined) return { error: "invalid child IPC correlation" };
	if (value.kind !== "notification") return { id, error: "unsupported child IPC kind" };
	if (!validChildMessage(value.message)) return { id, error: "invalid child IPC message" };
	return { frame: { id, kind: "notification", message: value.message } };
}

function parseAck(value: unknown): AckFrame | undefined {
	if (!record(value) || !exact(value, ["id", "kind", "accepted", "error"]) || !validChildId(value.id) || value.kind !== "ack" || typeof value.accepted !== "boolean") return undefined;
	if (value.accepted && value.error !== undefined) return undefined;
	if (value.error !== undefined && !boundedText(value.error, CHILD_ACK_ERROR_MAX_BYTES)) return undefined;
	return { id: value.id, accepted: value.accepted, ...(value.error === undefined ? {} : { error: value.error }) };
}

// Child-side admissions make acceptance explicit, but do not imply the parent
// model read the message or that any later delivery is guaranteed.
export class ChildMessenger {
	private readonly pending = new Map<string, Pending>();
	private readonly endpoint: IpcEndpoint;
	private readonly schedule: Schedule;
	private nextId = 0;
	private closed = false;

	constructor(endpoint: IpcEndpoint, schedule: Schedule = (fn, ms) => {
		const timer = setTimeout(fn, ms);
		timer.unref?.();
		return () => clearTimeout(timer);
	}) {
		this.endpoint = endpoint;
		this.schedule = schedule;
		endpoint.on("message", (value) => this.receive(value));
		endpoint.on("disconnect", () => this.close("parent notification channel closed"));
	}

	notify(message: string): Promise<void> {
		if (this.closed || this.endpoint.connected === false) {
			this.close("parent notification channel closed");
			return Promise.reject(new Error("parent notification channel closed"));
		}
		if (!validChildMessage(message)) return Promise.reject(new Error("message is not well-formed UTF-16 or exceeds 8KiB"));
		if (this.pending.size >= CHILD_MESSAGE_MAX_INFLIGHT) return Promise.reject(new Error("too many pending parent-message admissions"));
		if (this.nextId >= Number.MAX_SAFE_INTEGER) return Promise.reject(new Error("parent-message correlation exhausted"));
		const id = `n${++this.nextId}`;
		return new Promise((resolve, reject) => {
			const settle = (error?: Error) => this.settle(id, error);
			const cancel = this.schedule(() => settle(new Error("parent-message admission timed out")), CHILD_MESSAGE_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, cancel });
			try {
				this.endpoint.send({ id, kind: "notification", message }, (error) => { if (error) settle(error); });
			} catch (error) {
				settle(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	close(reason = "parent notification channel closed"): void {
		if (this.closed) return;
		this.closed = true;
		for (const id of [...this.pending.keys()]) this.settle(id, new Error(reason));
	}

	private receive(value: unknown): void {
		const ack = parseAck(value);
		if (!ack) return;
		this.settle(ack.id, ack.accepted ? undefined : new Error(ack.error || "parent rejected notification"));
	}

	private settle(id: string, error?: Error): void {
		const entry = this.pending.get(id);
		if (!entry) return;
		this.pending.delete(id);
		entry.cancel();
		if (error) entry.reject(error);
		else entry.resolve();
	}
}
