import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import {
	ActiveSessionClientError,
	FrameDecoder,
	SessionPresenceError,
	TransportProtocolError,
	encodeAckFrame,
	encodeNotificationFrame,
	type AckFrame,
	type PresenceRecord,
	type ReceivedNotification,
	type SessionPresenceCandidate,
	type SentNotification,
	type NotificationFrame,
} from "./agents-session-transport.ts";

export const FIXED_WINDOWS_POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const MAX_CONTROL_BYTES = 16_384;
// The native helper caps one raw pipe request at MaxPipeBytes = 65,536. Its event
// carries that request as canonical base64, so this private envelope is bounded by
// ceil(raw / 3) * 4 plus the largest fixed, ASCII-only control fields below.
const NATIVE_PIPE_MAX_BYTES = 65_536;
const MAX_PRIVATE_WIRE_BASE64_BYTES = Math.ceil(NATIVE_PIPE_MAX_BYTES / 3) * 4;
const MAX_PRIVATE_EVENT_FIXED_BYTES = Buffer.byteLength('{"event":"notification","connectionId":"","generation":2147483647,"wire":""}', "utf8") + 128;
const MAX_PRIVATE_EVENT_BYTES = MAX_PRIVATE_WIRE_BASE64_BYTES + MAX_PRIVATE_EVENT_FIXED_BYTES;
const MAX_PENDING = 8;
const MAX_PENDING_ACK = 8;
const RPC_DEADLINE_MS = 2_000;
const CALLBACK_DEADLINE_MS = 2_000;
const SHUTDOWN_GRACE_MS = 500;
const PIPE = /^\\\\\.\\pipe\\gentle-pi-[A-Za-z0-9-]{1,96}$/;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

type HostState = Readonly<{ state: "partial" }> | Readonly<{ state: "initialized"; bootstrap: "complete" }> | Readonly<{ state: "initialized"; bootstrap: "complete"; entries: number }>;
type HostReply = Readonly<{ requestId: string; ok: boolean; result?: HostState | WindowsRecord | Readonly<{ records: readonly WindowsRecord[] }>; error?: "unavailable" | "unsafe" | "busy" | "not_found" | "invalid" }>;
type HostEvent = Readonly<{ event: "notification"; connectionId: string; generation: number; frame: NotificationFrame }> | Readonly<{ event: "listener-failed"; generation: number; error: "unavailable" }>;
type Pending = { kind: "rpc" | "ack"; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type WindowsHostFailureCallback = (generation: number) => void;
type SpawnedHost = ChildProcessWithoutNullStreams;
export type WindowsHostCallback = (notification: Readonly<{ connectionId: string; id: string; senderSessionId: string; recipientSessionId: string; message: string }>) => Promise<boolean>;
export type WindowsSessionTransportHostOptions = Readonly<{
	runtimeScript?: string;
	spawnProcess?: typeof spawn;
	callback?: WindowsHostCallback;
	rpcDeadlineMs?: number;
}>;
export type WindowsSessionRegistryPhase = "start" | "initialize" | "cleanup";
export type WindowsSessionRegistryPhaseErrorCode = "spawn" | "stream" | "process" | "exit" | "write" | "deadline" | "protocol" | "start-reply" | "stopped" | "unwritable" | "unknown";
export type WindowsSessionRegistryPhaseError = Readonly<{ class: "timed-out" | "rejected" | "unknown"; code: WindowsSessionRegistryPhaseErrorCode }>;
/** Receives one fixed, synchronous result event for an operation on this registry's own host. */
export type WindowsSessionRegistryPhaseEvent = Readonly<{ phase: WindowsSessionRegistryPhase; status: "succeeded" | "failed"; error: WindowsSessionRegistryPhaseError | null }>;
export type WindowsSessionRegistryPhaseObserver = (event: WindowsSessionRegistryPhaseEvent) => undefined;
export type WindowsSessionRegistryObservation = Readonly<{
	availability: "unavailable" | "observed";
	provenance: "unavailable" | "ambiguous" | "owned-instance";
	restoration: "not-required";
	startCalls: number | null;
	initializeCalls: number | null;
	cleanupCalls: number | null;
	firstFailurePhase: WindowsSessionRegistryPhase | null;
	firstFailureClass: WindowsSessionRegistryPhaseError["class"] | null;
	firstFailureCode: WindowsSessionRegistryPhaseError["code"] | null;
}>;

/** Pure probe-side reducer for fixed events emitted by one registry's lexical owner. */
export class WindowsSessionRegistryPhaseSequence {
	private expected: WindowsSessionRegistryPhase | "complete" = "start";
	private invalid = false;
	private startStatus?: WindowsSessionRegistryPhaseEvent["status"];
	private initializeStatus?: WindowsSessionRegistryPhaseEvent["status"];
	private cleanupStatus?: WindowsSessionRegistryPhaseEvent["status"];
	private firstFailure?: Readonly<{ phase: WindowsSessionRegistryPhase; class: WindowsSessionRegistryPhaseError["class"]; code: WindowsSessionRegistryPhaseError["code"] }>;
	observe(event: unknown): undefined {
		if (this.invalid || !this.validEvent(event) || event.phase !== this.expected) { this.invalid = true; return undefined; }
		if (event.phase === "start") this.startStatus = event.status;
		else if (event.phase === "initialize") this.initializeStatus = event.status;
		else this.cleanupStatus = event.status;
		if (event.status === "failed" && this.firstFailure === undefined) this.firstFailure = Object.freeze({ phase: event.phase, class: event.error!.class, code: event.error!.code });
		if (event.phase === "start") this.expected = event.status === "succeeded" ? "initialize" : "cleanup";
		else if (event.phase === "initialize") this.expected = "cleanup";
		else this.expected = "complete";
		return undefined;
	}
	get operationSucceeded() { return this.startStatus === "succeeded" && this.initializeStatus === "succeeded"; }
	get terminalSequenceValid() { return !this.invalid && this.expected === "complete"; }
	get cleanupComplete() { return this.terminalSequenceValid && this.cleanupStatus === "succeeded"; }
	get admitsFullSuccess() { return this.operationSucceeded && this.cleanupComplete; }
	get startupSucceeded() { return !this.invalid && this.expected === "cleanup" && this.operationSucceeded; }
	snapshot(): WindowsSessionRegistryObservation {
		if (!this.terminalSequenceValid) return Object.freeze({ availability: "unavailable", provenance: this.invalid ? "ambiguous" : "unavailable", restoration: "not-required", startCalls: null, initializeCalls: null, cleanupCalls: null, firstFailurePhase: null, firstFailureClass: null, firstFailureCode: null });
		return Object.freeze({ availability: "observed", provenance: "owned-instance", restoration: "not-required", startCalls: this.startStatus === undefined ? 0 : 1, initializeCalls: this.initializeStatus === undefined ? 0 : 1, cleanupCalls: this.cleanupStatus === undefined ? 0 : 1, firstFailurePhase: this.firstFailure?.phase ?? null, firstFailureClass: this.firstFailure?.class ?? null, firstFailureCode: this.firstFailure?.code ?? null });
	}
	private validEvent(event: unknown): event is WindowsSessionRegistryPhaseEvent {
		if (!event || typeof event !== "object" || Array.isArray(event) || Object.getPrototypeOf(event) !== Object.prototype || Object.keys(event).length !== 3) return false;
		const value = event as Record<string, unknown>;
		if (!(["start", "initialize", "cleanup"] as const).includes(value.phase as WindowsSessionRegistryPhase) || !(["succeeded", "failed"] as const).includes(value.status as WindowsSessionRegistryPhaseEvent["status"])) return false;
		if (value.status === "succeeded") return value.error === null;
		if (!value.error || typeof value.error !== "object" || Array.isArray(value.error) || Object.getPrototypeOf(value.error) !== Object.prototype || Object.keys(value.error).length !== 2) return false;
		const error = value.error as Record<string, unknown>;
		return (["timed-out", "rejected", "unknown"] as const).includes(error.class as WindowsSessionRegistryPhaseError["class"]) && (["spawn", "stream", "process", "exit", "write", "deadline", "protocol", "start-reply", "stopped", "unwritable", "unknown"] as const).includes(error.code as WindowsSessionRegistryPhaseErrorCode) && ((error.class === "timed-out") === (error.code === "deadline"));
	}
}

const defaultRuntimeScript = fileURLToPath(new URL("../runtime/windows-session-transport.ps1", import.meta.url));
const safeError = (message: string) => new Error(message);
// Diagnostics are source-defined and remain private to the phase observer: no native
// error object, message, property, or stderr is copied into the event.
const transportFailureCodes = new WeakMap<Error, WindowsSessionRegistryPhaseErrorCode>();
const transportError = (message: string, code: WindowsSessionRegistryPhaseErrorCode) => {
	const error = safeError(message);
	transportFailureCodes.set(error, code);
	return error;
};
// This sink intentionally captures no host state. It prevents a late stream error from
// becoming unhandled after bounded cleanup times out but before the child confirms close.
const lateChildErrorSink = () => {};
type DetachedChildCleanup = Readonly<{ closed: () => boolean; install: () => void; close: () => void }>;
/**
 * This state is handed to the child only after host cleanup times out. Its callbacks
 * retain the child streams and their own exact callback references, never the host.
 */
const createDetachedChildCleanup = (child: SpawnedHost): DetachedChildCleanup => {
	let closed = false;
	const removeGuards = () => {
		child.removeListener("error", lateChildErrorSink);
		child.stdin.removeListener("error", lateChildErrorSink);
		child.stdout.removeListener("error", lateChildErrorSink);
		child.stderr.removeListener("error", lateChildErrorSink);
	};
	const close = () => {
		if (closed) return;
		closed = true;
		child.removeListener("close", close);
		removeGuards();
	};
	const addGuard = (emitter: NodeJS.EventEmitter) => {
		if (closed) return;
		emitter.on("error", lateChildErrorSink);
		// An external newListener hook can synchronously close the child before on()
		// returns; remove this just-added guard rather than leaving it after close.
		if (closed) emitter.removeListener("error", lateChildErrorSink);
	};
	const install = () => {
		if (closed) return;
		child.once("close", close);
		if (closed) { child.removeListener("close", close); return; }
		addGuard(child); addGuard(child.stdin); addGuard(child.stdout); addGuard(child.stderr);
	};
	return Object.freeze({ closed: () => closed, install, close });
};
/** A syntactically valid private envelope can contain one untrusted pipe frame. */
class InvalidClientWireError extends Error {}
const controlId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value);
const hasPrivateData = (value: unknown): boolean => {
	if (!value || typeof value !== "object") return false;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (/(path|sid|exception|stack|detail)/i.test(key) || hasPrivateData(child)) return true;
	}
	return false;
};
const validNotification = (value: unknown): value is NotificationFrame => {
	try { encodeNotificationFrame(value as NotificationFrame); return true; } catch { return false; }
};

/** Parse one public JSONL frame. The helper never exposes a host path, SID, or exception. */
export function parseWindowsHostFrame(line: string): HostReply {
	if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > MAX_CONTROL_BYTES) throw safeError("invalid Windows transport frame");
	let value: unknown;
	try { value = JSON.parse(line); } catch { throw safeError("invalid Windows transport frame"); }
	if (!value || typeof value !== "object" || Array.isArray(value) || hasPrivateData(value)) throw safeError("invalid Windows transport frame");
	const frame = value as Record<string, unknown>;
	if (!controlId(frame.requestId) || typeof frame.ok !== "boolean") throw safeError("invalid Windows transport frame");
	const keys = Object.keys(frame);
	if (frame.ok) {
		if (keys.length !== 3 || !keys.includes("result") || !frame.result || typeof frame.result !== "object" || Array.isArray(frame.result)) throw safeError("invalid Windows transport frame");
		const result = frame.result as Record<string, unknown>;
		const partial = Object.keys(result).length === 1 && result.state === "partial";
		const initialized = Object.keys(result).length === 2 && result.state === "initialized" && result.bootstrap === "complete";
		const enumerated = Object.keys(result).length === 3 && result.state === "initialized" && result.bootstrap === "complete" && Number.isSafeInteger(result.entries) && (result.entries as number) >= 0 && (result.entries as number) <= 64;
		let publicResult: HostReply["result"];
		if (partial || initialized || enumerated) publicResult = Object.freeze({ ...result }) as HostState;
		else {
			try {
				if (Object.keys(result).length === 4) publicResult = validRecord(result);
				else if (Object.keys(result).length === 1 && Array.isArray(result.records) && result.records.length <= 64) publicResult = Object.freeze({ records: Object.freeze(result.records.map((record) => validRecord(record as Record<string, unknown>))) });
				else throw new Error();
			} catch { throw safeError("invalid Windows transport frame"); }
		}
		return Object.freeze({ requestId: frame.requestId, ok: true, result: publicResult! });
	}
	if (keys.length !== 3 || typeof frame.error !== "string" || !["unavailable", "unsafe", "busy", "not_found", "invalid"].includes(frame.error)) throw safeError("invalid Windows transport frame");
	return Object.freeze({ requestId: frame.requestId, ok: false, error: frame.error as HostReply["error"] });
}

/** Decode the helper's bounded private events before allowing application acknowledgement. */
function parseWindowsHostEvent(line: string): HostEvent | undefined {
	if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > MAX_PRIVATE_EVENT_BYTES) throw safeError("invalid Windows transport frame");
	let value: unknown;
	try { value = JSON.parse(line); } catch { throw safeError("invalid Windows transport frame"); }
	if (!value || typeof value !== "object" || Array.isArray(value) || hasPrivateData(value)) throw safeError("invalid Windows transport frame");
	const event = value as Record<string, unknown>;
	if (event.event === "listener-failed") {
		if (Object.keys(event).length !== 3 || !Number.isSafeInteger(event.generation) || (event.generation as number) < 1 || (event.generation as number) > 0x7fffffff || event.error !== "unavailable") throw safeError("invalid Windows transport frame");
		return Object.freeze({ event: "listener-failed", generation: event.generation as number, error: "unavailable" });
	}
	if (event.event !== "notification") return undefined;
	if (Object.keys(event).length !== 4 || !controlId(event.connectionId) || !Number.isSafeInteger(event.generation) || (event.generation as number) < 1 || (event.generation as number) > 0x7fffffff || typeof event.wire !== "string" || event.wire.length > MAX_PRIVATE_WIRE_BASE64_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.wire)) throw safeError("invalid Windows transport frame");
	let bytes: Buffer;
	try {
		bytes = Buffer.from(event.wire, "base64");
		if (bytes.length > NATIVE_PIPE_MAX_BYTES || bytes.toString("base64") !== event.wire) throw new Error();
	} catch { throw safeError("invalid Windows transport frame"); }
	try {
		const decoder = new FrameDecoder(); decoder.push(bytes);
		const frame = decoder.finish();
		if (frame.kind !== "notification") throw new Error();
		return Object.freeze({ event: "notification", connectionId: event.connectionId as string, generation: event.generation as number, frame });
	} catch { throw new InvalidClientWireError("invalid client wire frame"); }
}

/** Decode a notification event while preserving the existing public notification parser. */
export function parseWindowsHostNotification(line: string): Extract<HostEvent, { event: "notification" }> | undefined {
	const event = parseWindowsHostEvent(line);
	return event?.event === "notification" ? event : undefined;
}

export class WindowsSessionTransportHost {
	private readonly runtimeScript: string;
	private readonly spawnProcess: typeof spawn;
	private readonly callback?: WindowsHostCallback;
	private readonly deadline: number;
	private child?: SpawnedHost;
	private started?: Promise<void>;
	private sequence = 0;
	private output = Buffer.alloc(0);
	private readonly pending = new Map<string, Pending>();
	private pendingRpcs = 0;
	private pendingAcks = 0;
	private listenerGeneration = 0;
	private listenerActive = false;
	private listenerFailure?: WindowsHostFailureCallback;
	private stopped = false;
	private childClosed = false;
	private inputClosed = false;
	private childKillRequested = false;
	private cleanup?: Promise<void>;
	private resolveCleanup?: () => void;
	private rejectCleanup?: (error: Error) => void;
	private cleanupTimer?: ReturnType<typeof setTimeout>;
	private readonly onStdoutData = (chunk: Buffer) => this.onOutput(chunk);
	private readonly onStdoutError = () => this.abort("Windows transport host unavailable", true, "stream");
	private readonly onStdinError = () => this.abort("Windows transport host unavailable", true, "stream");
	private readonly onStderrError = () => this.abort("Windows transport host unavailable", true, "stream");
	private readonly onChildError = () => this.abort("Windows transport host unavailable", true, "process");
	private readonly onChildExit = () => this.abort("Windows transport host exited", false, "exit");
	private readonly onChildClose = () => this.handleChildClose();
	// Set only while handing close ownership from the host observer to detached state.
	private handoffCloseState?: DetachedChildCleanup;

	constructor(options: WindowsSessionTransportHostOptions = {}) {
		this.runtimeScript = options.runtimeScript ?? defaultRuntimeScript;
		this.spawnProcess = options.spawnProcess ?? spawn;
		this.callback = options.callback;
		this.deadline = options.rpcDeadlineMs ?? RPC_DEADLINE_MS;
		if (!Number.isInteger(this.deadline) || this.deadline < 1 || this.deadline > RPC_DEADLINE_MS) throw new RangeError("invalid Windows transport deadline");
	}

	start(): Promise<void> {
		if (this.started) return this.started;
		if (this.stopped) return Promise.reject(transportError("Windows transport host exited", "stopped"));
		try {
			this.child = this.spawnProcess(FIXED_WINDOWS_POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", this.runtimeScript], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }) as SpawnedHost;
		} catch { return Promise.reject(transportError("Windows transport host unavailable", "spawn")); }
		this.child.stdout.on("data", this.onStdoutData);
		this.child.stdout.on("error", this.onStdoutError);
		this.child.stdin.on("error", this.onStdinError);
		this.child.stderr.on("error", this.onStderrError);
		this.child.stderr.resume?.();
		this.child.once("error", this.onChildError);
		this.child.once("exit", this.onChildExit);
		this.child.once("close", this.onChildClose);
		this.started = this.request("start", {}).then((result) => {
			if (result.state !== "partial") throw transportError("Windows transport host unavailable", "start-reply");
		});
		return this.started;
	}

	request(operation: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
		const kind = operation === "ack" ? "ack" : "rpc";
		if (!/^[a-z-]{1,32}$/.test(operation) || hasPrivateData(values) || (kind === "rpc" ? this.pendingRpcs >= MAX_PENDING : this.pendingAcks >= MAX_PENDING_ACK)) return Promise.reject(safeError("Windows transport request unavailable"));
		const child = this.child;
		if (!child || this.stopped) return Promise.reject(transportError("Windows transport host exited", "stopped"));
		if (!child.stdin.writable) return Promise.reject(transportError("Windows transport host exited", "unwritable"));
		const requestId = `${operation}-${++this.sequence}`;
		const line = JSON.stringify({ requestId, operation, ...values });
		if (Buffer.byteLength(line, "utf8") > MAX_CONTROL_BYTES) return Promise.reject(safeError("Windows transport request unavailable"));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => this.settle(requestId, transportError("Windows transport request timed out", "deadline")), kind === "ack" ? CALLBACK_DEADLINE_MS : this.deadline);
			this.pending.set(requestId, { kind, resolve, reject, timer });
			if (kind === "ack") this.pendingAcks++; else this.pendingRpcs++;
			try { child.stdin.write(`${line}\n`, (error) => { if (error) this.settle(requestId, transportError("Windows transport host exited", "write")); }); }
			catch { this.settle(requestId, transportError("Windows transport host exited", "write")); }
		});
	}

	setListenerFailure(callback?: WindowsHostFailureCallback) { this.listenerFailure = callback; }

	async listen(sessionId: string, createdAt = Date.now()): Promise<WindowsRecord> {
		const generation = ++this.listenerGeneration;
		this.listenerActive = true;
		try {
			const result = validRecord(await this.request("listen", { sessionId, createdAt }));
			if (!this.listenerActive || this.listenerGeneration !== generation) throw safeError("Windows transport listener failed");
			return result;
		} catch (error) {
			if (this.listenerGeneration === generation) this.listenerActive = false;
			throw error;
		}
	}

	async stopListener(record: PresenceRecord) {
		this.listenerActive = false;
		await this.request("stop-listener", { record: validRecord(record as unknown as Record<string, unknown>) });
	}

	async close() {
		this.listenerActive = false;
		if (this.cleanup) return this.cleanup;
		const child = this.child;
		if (!child) { this.stopped = true; return; }
		if (!this.stopped) {
			await this.request("shutdown", {}).catch(() => {});
			this.stopped = true;
		}
		await this.releaseOwnedChild(false);
	}

	private onOutput(chunk: Buffer) {
		if (!Buffer.isBuffer(chunk)) { this.abort("Windows transport host unavailable", true, "protocol"); return; }
		const output = this.output.length === 0 ? chunk : Buffer.concat([this.output, chunk]);
		let offset = 0;
		for (;;) {
			const newline = output.indexOf(10, offset);
			if (newline < 0) {
				const partial = output.subarray(offset);
				if (partial.length > MAX_PRIVATE_EVENT_BYTES) this.abort("Windows transport host unavailable", true, "protocol");
				else this.output = Buffer.from(partial);
				return;
			}
			const bytes = output.subarray(offset, newline);
			offset = newline + 1;
			if (bytes.length > MAX_PRIVATE_EVENT_BYTES) { this.abort("Windows transport host unavailable", true, "protocol"); return; }
			let line: string;
			try {
				// Newlines are single UTF-8 bytes, so retaining only an unterminated byte
				// suffix preserves split code points without decoding partial chunks.
				line = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch { this.abort("Windows transport host unavailable", true, "protocol"); return; }
			try {
				const event = parseWindowsHostEvent(line);
				if (event) {
					if (event.event === "notification") void this.acknowledge(event);
					else this.failListener(event.generation);
					continue;
				}
				const reply = parseWindowsHostFrame(line);
				this.settle(reply.requestId, reply.ok ? undefined : transportError("Windows transport request unavailable", "protocol"), reply.result);
			} catch (error) {
				// Only a schema-validated private event can isolate its embedded client wire.
				if (error instanceof InvalidClientWireError) continue;
				this.abort("Windows transport host unavailable", true, "protocol");
				return;
			}
		}
	}

	private async acknowledge(event: Extract<HostEvent, { event: "notification" }>) {
		if (this.stopped || !this.listenerActive || event.generation !== this.listenerGeneration) return;
		const callback = this.callback;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), CALLBACK_DEADLINE_MS); });
		const accepted = await Promise.race([
			Promise.resolve(callback?.(Object.freeze({ connectionId: event.connectionId, id: event.frame.id, senderSessionId: event.frame.senderSessionId, recipientSessionId: event.frame.recipientSessionId, message: event.frame.message }))).then((value) => value === true, () => false),
			deadline,
		]);
		if (timer) clearTimeout(timer);
		if (this.stopped || !this.listenerActive || event.generation !== this.listenerGeneration) return;
		// This is the sole path that lets PowerShell reply on its retained server handle.
		void this.request("ack", { connectionId: event.connectionId, generation: event.generation, id: event.frame.id, accepted }).catch(() => {});
	}
	private settle(requestId: string, error?: Error, result?: Record<string, unknown>) {
		const pending = this.pending.get(requestId);
		if (!pending) return;
		this.pending.delete(requestId); clearTimeout(pending.timer);
		if (pending.kind === "ack") this.pendingAcks--; else this.pendingRpcs--;
		if (error) pending.reject(error); else pending.resolve(result ?? {});
	}
	private failListener(generation: number) {
		if (this.stopped || !this.listenerActive || generation !== this.listenerGeneration) return;
		this.listenerActive = false;
		for (const [id, pending] of [...this.pending]) if (pending.kind === "ack") this.settle(id, safeError("Windows transport listener failed"));
		try { this.listenerFailure?.(generation); } catch {}
	}
	private detachOwnedListeners(keepClose: boolean) {
		const child = this.child;
		if (!child) return;
		child.stdout.removeListener("data", this.onStdoutData);
		child.stdout.removeListener("error", this.onStdoutError);
		child.stdin.removeListener("error", this.onStdinError);
		child.stderr.removeListener("error", this.onStderrError);
		child.removeListener("error", this.onChildError);
		child.removeListener("exit", this.onChildExit);
		if (!keepClose) child.removeListener("close", this.onChildClose);
	}
	private handOffTimedOutClose(child: SpawnedHost) {
		const detached = createDetachedChildCleanup(child);
		this.handoffCloseState = detached;
		detached.install();
		if (!detached.closed()) child.removeListener("close", this.onChildClose);
		this.handoffCloseState = undefined;
		return detached.closed();
	}
	private handleChildClose() {
		this.childClosed = true;
		if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
		this.cleanupTimer = undefined;
		this.handoffCloseState?.close();
		if (!this.stopped) this.abort("Windows transport host exited", false, "exit");
		this.detachOwnedListeners(false);
		const resolve = this.resolveCleanup;
		this.resolveCleanup = undefined;
		this.rejectCleanup = undefined;
		this.cleanup = undefined;
		this.output = Buffer.alloc(0);
		this.child = undefined;
		resolve?.();
	}
	private closeInput() {
		if (this.inputClosed) return;
		this.inputClosed = true;
		try { this.child?.stdin.end(); } catch {}
	}
	private failCleanup() {
		if (this.childClosed) return;
		this.cleanupTimer = undefined;
		const child = this.child;
		if (!child) return;
		// Timeout is not physical closure. Hand close/error safety to callbacks that
		// capture only this child and its streams, then release host protocol state.
		this.detachOwnedListeners(true);
		const closedDuringHandoff = this.handOffTimedOutClose(child);
		this.output = Buffer.alloc(0);
		this.child = undefined;
		if (closedDuringHandoff) return;
		const reject = this.rejectCleanup;
		this.resolveCleanup = undefined;
		this.rejectCleanup = undefined;
		reject?.(safeError("Windows transport host did not close"));
	}
	private requestChildKill() {
		if (this.childClosed || this.childKillRequested) return;
		this.childKillRequested = true;
		try { this.child?.kill(); } catch {}
	}
	private scheduleCleanupKill() {
		if (this.childClosed || this.childKillRequested) return;
		if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
		this.cleanupTimer = setTimeout(() => {
			this.cleanupTimer = undefined;
			this.requestChildKill();
			if (!this.childClosed) this.cleanupTimer = setTimeout(() => this.failCleanup(), SHUTDOWN_GRACE_MS);
		}, SHUTDOWN_GRACE_MS);
	}
	private releaseOwnedChild(killNow: boolean): Promise<void> {
		if (this.cleanup) return this.cleanup;
		const child = this.child;
		if (!child) return Promise.resolve();
		if (!this.cleanup) {
			if (this.childClosed) return Promise.resolve();
			this.cleanup = new Promise<void>((resolve, reject) => { this.resolveCleanup = resolve; this.rejectCleanup = reject; });
		}
		const cleanup = this.cleanup;
		this.closeInput();
		if (killNow) {
			if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
			this.cleanupTimer = undefined;
			this.requestChildKill();
			if (!this.childClosed) this.cleanupTimer = setTimeout(() => this.failCleanup(), SHUTDOWN_GRACE_MS);
		} else this.scheduleCleanupKill();
		return cleanup;
	}
	private abort(message: string, closeChild = false, code: WindowsSessionRegistryPhaseErrorCode = "unknown") {
		if (this.stopped) return;
		const generation = this.listenerActive ? this.listenerGeneration : undefined;
		this.stopped = true;
		this.listenerActive = false;
		for (const id of [...this.pending.keys()]) this.settle(id, transportError(message, code));
		if (generation !== undefined) { try { this.listenerFailure?.(generation); } catch {} }
		void this.releaseOwnedChild(closeChild).catch(() => {});
	}
}

type WindowsRecord = PresenceRecord;
const validRecord = (value: Record<string, unknown>): WindowsRecord => {
	const keys = Object.keys(value);
	if (keys.length !== 4 || !["version", "sessionId", "endpoint", "createdAt"].every((key) => keys.includes(key)) || value.version !== 1 || typeof value.sessionId !== "string" || !SESSION.test(value.sessionId) || typeof value.endpoint !== "string" || !PIPE.test(value.endpoint) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new SessionPresenceError("invalid_presence", "invalid presence record");
	return Object.freeze({ version: 1, sessionId: value.sessionId, endpoint: value.endpoint, createdAt: value.createdAt });
};
const registryError = (error: unknown): never => {
	if (error instanceof SessionPresenceError) throw error;
	throw new SessionPresenceError("io_error", "transport I/O failed");
};

const phaseError = (error: unknown): WindowsSessionRegistryPhaseError => {
	const code = error instanceof Error ? transportFailureCodes.get(error) ?? "unknown" : "unknown";
	return Object.freeze({ class: code === "deadline" ? "timed-out" : error instanceof Error ? "rejected" : "unknown", code });
};
class WindowsSessionRegistryObserver {
	private active = true;
	private readonly callback: WindowsSessionRegistryPhaseObserver;
	constructor(callback: WindowsSessionRegistryPhaseObserver) { this.callback = callback; }
	async run<T>(phase: WindowsSessionRegistryPhase, operation: () => Promise<T>): Promise<T> {
		try {
			const value = await operation();
			this.observe(Object.freeze({ phase, status: "succeeded", error: null }));
			return value;
		} catch (error) {
			try { this.observe(Object.freeze({ phase, status: "failed", error: phaseError(error) })); } catch { /* the operation rejection remains primary */ }
			throw error;
		}
	}
	private observe(event: WindowsSessionRegistryPhaseEvent) {
		if (!this.active) return;
		let result: unknown;
		try { result = this.callback(event); }
		catch { this.active = false; throw safeError("Windows registry observation failed"); }
		if (result === undefined) return;
		this.active = false;
		try { Promise.resolve(result).catch(() => {}); } catch { /* invalid thenables remain observer failures */ }
		throw safeError("Windows registry observation failed");
	}
}

/** Windows metadata stays in the PowerShell owner process; Node sees only public activation records. */
export class WindowsSessionPresenceRegistry {
	readonly paths = Object.freeze({ root: "", presence: "", sockets: "" });
	private readonly host: WindowsSessionTransportHost;
	private readonly observer?: WindowsSessionRegistryObserver;
	private notification?: WindowsHostCallback;
	private listenerFailure?: WindowsHostFailureCallback;
	private constructor(host: WindowsSessionTransportHost, observer?: WindowsSessionRegistryObserver) {
		this.host = host;
		this.observer = observer;
		this.host.setListenerFailure((generation) => this.listenerFailure?.(generation));
	}
	static async create(agentHome: string, observePhase?: WindowsSessionRegistryPhaseObserver) {
		if (process.platform !== "win32") throw new SessionPresenceError("io_error", "transport I/O failed");
		if (typeof agentHome !== "string" || !/^[A-Za-z]:\\/.test(agentHome)) throw new SessionPresenceError("unsafe_path", "unsafe transport path");
		let registry: WindowsSessionPresenceRegistry | undefined;
		const host = new WindowsSessionTransportHost({ callback: async (notification) => registry?.notification?.(notification) ?? false });
		const observer = observePhase === undefined ? undefined : new WindowsSessionRegistryObserver(observePhase);
		const run = <T>(phase: WindowsSessionRegistryPhase, operation: () => Promise<T>) => observer ? observer.run(phase, operation) : operation();
		try {
			await run("start", () => host.start());
			await run("initialize", async () => {
				const initialized = await host.request("initialize", { agentHome });
				if (initialized.state !== "initialized" || initialized.bootstrap !== "complete") throw safeError("Windows transport host unavailable");
			});
			registry = new WindowsSessionPresenceRegistry(host, observer);
			return registry;
		} catch (error) {
			try { await run("cleanup", () => host.close()); } catch { /* registry creation preserves its primary rejection */ }
			registryError(error);
		}
	}
	setNotification(callback?: WindowsHostCallback) { this.notification = callback; }
	clearNotification(callback: WindowsHostCallback) { if (this.notification === callback) this.notification = undefined; }
	setListenerFailure(callback?: WindowsHostFailureCallback) { this.listenerFailure = callback; }
	clearListenerFailure(callback: WindowsHostFailureCallback) { if (this.listenerFailure === callback) this.listenerFailure = undefined; }
	async record(sessionId: string, createdAt = Date.now()) { try { return validRecord(await this.host.request("record", { sessionId, createdAt })); } catch { registryError(undefined); } }
	presencePath(_record: PresenceRecord) { throw new SessionPresenceError("unsafe_path", "unsafe transport path"); }
	async publish(record: PresenceRecord) { try { await this.host.request("publish", { record: validRecord(record as unknown as Record<string, unknown>) }); } catch { registryError(undefined); } }
	async list(excludeSessionId?: string): Promise<readonly SessionPresenceCandidate[]> { return (await this.listActivations(excludeSessionId)).map((record) => Object.freeze({ sessionId: record.sessionId, reachability: "unknown" as const })); }
	async listActivations(excludeSessionId?: string): Promise<readonly WindowsRecord[]> { try { const value = await this.host.request("list", { ...(excludeSessionId === undefined ? {} : { excludeSessionId }) }); if (!Array.isArray(value.records) || value.records.length > 64) throw new Error(); return Object.freeze(value.records.map((record) => validRecord(record as Record<string, unknown>))); } catch { registryError(undefined); } }
	async resolve(sessionId: string): Promise<WindowsRecord> { try { return validRecord(await this.host.request("resolve", { sessionId })); } catch { registryError(undefined); } }
	async removeOwn(record: PresenceRecord) { try { await this.host.request("remove", { record: validRecord(record as unknown as Record<string, unknown>) }); } catch { /* identity-bound owned cleanup is intentionally best effort */ } }
	async startListener(sessionId: string): Promise<WindowsRecord> {
		// listen resolves only after the helper has atomically armed and published it.
		try { return await this.host.listen(sessionId); } catch (error) { registryError(error); }
	}
	async stopListener(record: PresenceRecord) { try { await this.host.stopListener(record); } catch { await this.removeOwn(record); } }
	async close() { await (this.observer ? this.observer.run("cleanup", () => this.host.close()) : this.host.close()); }
}

export class WindowsActiveSessionListener {
	readonly registry: WindowsSessionPresenceRegistry;
	readonly sessionID: string;
	record?: PresenceRecord;
	readonly closed: Promise<void>;
	failure?: Readonly<{ code: "io_error"; message: "listener failed" }>;
	private readonly onNotification: (notification: ReceivedNotification) => Promise<void>;
	private state: "idle" | "starting" | "active" | "closed" = "idle";
	private generation = 0;
	private resolveClosed!: () => void;
	private readonly notification = (notification: Readonly<{ connectionId: string; id: string; senderSessionId: string; recipientSessionId: string; message: string }>) => this.receive(notification);
	private listenerFailure?: WindowsHostFailureCallback;
	constructor(registry: WindowsSessionPresenceRegistry, sessionID: string, onNotification: (notification: ReceivedNotification) => Promise<void>) { this.registry = registry; this.sessionID = sessionID; this.onNotification = onNotification; this.closed = new Promise((resolve) => { this.resolveClosed = resolve; }); }
	get status() { return this.state; }
	get activeConnections() { return 0; }
	async start() {
		if (this.state !== "idle") return;
		const generation = ++this.generation;
		this.state = "starting";
		this.registry.setNotification(this.notification);
		// Host generations are shared by the helper. This closure binds its validated
		// current host generation to this object's independent local start token.
		const listenerFailure: WindowsHostFailureCallback = () => this.fail(generation);
		this.listenerFailure = listenerFailure;
		this.registry.setListenerFailure(listenerFailure);
		try {
			const record = await this.registry.startListener(this.sessionID);
			if (this.state !== "starting" || this.generation !== generation) {
				await this.registry.stopListener(record);
				throw new SessionPresenceError("io_error", this.state === "closed" ? "listener is closed" : "listener failed");
			}
			this.record = record;
			this.state = "active";
		} catch (error) {
			const failed = this.state === "idle" && this.generation === generation && this.failure !== undefined;
			if (this.state !== "closed" && this.generation === generation) this.state = "idle";
			if (failed) throw new SessionPresenceError("io_error", "listener failed");
			throw error;
		}
	}
	async receive(notification: Readonly<{ id: string; senderSessionId: string; recipientSessionId: string; message: string }>) { if ((this.state !== "starting" && this.state !== "active") || notification.recipientSessionId !== this.sessionID) return false; try { await this.onNotification(Object.freeze({ id: notification.id, senderSessionId: notification.senderSessionId, message: notification.message })); return true; } catch { return false; } }
	private fail(generation: number) {
		if ((this.state !== "starting" && this.state !== "active") || this.generation !== generation) return;
		const listenerFailure = this.listenerFailure;
		this.record = undefined;
		this.failure = Object.freeze({ code: "io_error", message: "listener failed" });
		this.state = "idle";
		this.registry.clearNotification(this.notification);
		if (listenerFailure) this.registry.clearListenerFailure(listenerFailure);
		if (this.listenerFailure === listenerFailure) this.listenerFailure = undefined;
	}
	async close() {
		if (this.state === "closed") return;
		this.generation++;
		this.state = "closed";
		const record = this.record;
		const listenerFailure = this.listenerFailure;
		this.record = undefined;
		this.listenerFailure = undefined;
		this.registry.clearNotification(this.notification);
		if (listenerFailure) this.registry.clearListenerFailure(listenerFailure);
		try { if (record) await this.registry.stopListener(record); }
		finally { try { await this.registry.close(); } finally { this.resolveClosed(); } }
	}
}

export class WindowsActiveSessionClient {
	readonly registry: WindowsSessionPresenceRegistry;
	readonly senderSessionId: string;
	private stopped = false;
	private readonly pending = new Set<Socket>();
	constructor(registry: WindowsSessionPresenceRegistry, senderSessionId: string) { this.registry = registry; this.senderSessionId = senderSessionId; }
	get pendingCount() { return this.pending.size; }
	get closed() { return this.stopped; }
	close() { this.stopped = true; for (const socket of this.pending) socket.destroy(); this.pending.clear(); }
	async sendNotification(recipientSessionId: string, message: string, options: { id?: string; expectedActivation?: PresenceRecord; beforeConnect?: () => boolean | Promise<boolean>; signal?: AbortSignal } = {}): Promise<SentNotification> {
		if (this.stopped) throw new ActiveSessionClientError("closed");
		if (recipientSessionId === this.senderSessionId) throw new ActiveSessionClientError("self");
		if (this.pending.size >= MAX_PENDING) throw new ActiveSessionClientError("busy");
		if (options.signal?.aborted) throw new ActiveSessionClientError("aborted");
		let record: PresenceRecord;
		try { record = await this.registry.resolve(recipientSessionId); } catch { throw new ActiveSessionClientError(options.expectedActivation ? "stale" : "not_found"); }
		if (options.expectedActivation && JSON.stringify(record) !== JSON.stringify(options.expectedActivation)) throw new ActiveSessionClientError("stale");
		if (options.beforeConnect && !await options.beforeConnect()) throw new ActiveSessionClientError("stale");
		const id = options.id ?? crypto.randomUUID().replaceAll("-", "");
		const request = encodeNotificationFrame(Object.freeze({ version: 1, kind: "notification", id, senderSessionId: this.senderSessionId, recipientSessionId, message }));
		return new Promise<SentNotification>((resolve, reject) => {
			const socket = createConnection(record.endpoint); this.pending.add(socket);
			const decoder = new FrameDecoder(); let settled = false;
			const finish = (error?: ActiveSessionClientError, result?: SentNotification) => { if (settled) return; settled = true; clearTimeout(timer); this.pending.delete(socket); socket.destroy(); error ? reject(error) : resolve(result!); };
			const timer = setTimeout(() => finish(new ActiveSessionClientError("ack_timeout")), 2_000);
			socket.once("connect", () => { if (this.stopped) finish(new ActiveSessionClientError("closed")); else socket.write(request); });
			socket.on("data", (chunk) => { try { decoder.push(chunk); } catch { finish(new ActiveSessionClientError("invalid_ack")); } });
			socket.once("end", () => { try { const ack = decoder.finish() as AckFrame; finish(ack.kind === "ack" && ack.id === id && ack.accepted ? undefined : new ActiveSessionClientError(ack.kind === "ack" ? "remote_rejected" : "invalid_ack"), { id, accepted: true }); } catch { finish(new ActiveSessionClientError("invalid_ack")); } });
			socket.once("error", () => finish(new ActiveSessionClientError("io_error")));
		});
	}
}
