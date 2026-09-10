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
type HostEvent = Readonly<{ event: "notification"; connectionId: string; generation: number; frame: NotificationFrame }>;
type Pending = { kind: "rpc" | "ack"; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type SpawnedHost = ChildProcessWithoutNullStreams;
export type WindowsHostCallback = (notification: Readonly<{ connectionId: string; id: string; senderSessionId: string; recipientSessionId: string; message: string }>) => Promise<boolean>;
export type WindowsSessionTransportHostOptions = Readonly<{
	runtimeScript?: string;
	spawnProcess?: typeof spawn;
	callback?: WindowsHostCallback;
	rpcDeadlineMs?: number;
}>;

const defaultRuntimeScript = fileURLToPath(new URL("../runtime/windows-session-transport.ps1", import.meta.url));
const safeError = (message: string) => new Error(message);
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

/** Decode the helper's one-frame base64 event before allowing application acknowledgement. */
export function parseWindowsHostNotification(line: string): HostEvent | undefined {
	if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > MAX_PRIVATE_EVENT_BYTES) throw safeError("invalid Windows transport frame");
	let value: unknown;
	try { value = JSON.parse(line); } catch { throw safeError("invalid Windows transport frame"); }
	if (!value || typeof value !== "object" || Array.isArray(value) || hasPrivateData(value)) throw safeError("invalid Windows transport frame");
	const event = value as Record<string, unknown>;
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
	private stopped = false;

	constructor(options: WindowsSessionTransportHostOptions = {}) {
		this.runtimeScript = options.runtimeScript ?? defaultRuntimeScript;
		this.spawnProcess = options.spawnProcess ?? spawn;
		this.callback = options.callback;
		this.deadline = options.rpcDeadlineMs ?? RPC_DEADLINE_MS;
		if (!Number.isInteger(this.deadline) || this.deadline < 1 || this.deadline > RPC_DEADLINE_MS) throw new RangeError("invalid Windows transport deadline");
	}

	start(): Promise<void> {
		if (this.started) return this.started;
		if (this.stopped) return Promise.reject(safeError("Windows transport host exited"));
		try {
			this.child = this.spawnProcess(FIXED_WINDOWS_POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", this.runtimeScript], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }) as SpawnedHost;
		} catch { return Promise.reject(safeError("Windows transport host unavailable")); }
		this.child.stdout.on("data", (chunk: Buffer) => this.onOutput(chunk));
		this.child.stdout.on("error", () => this.abort("Windows transport host unavailable"));
		this.child.stderr.resume?.();
		this.child.once("error", () => this.abort("Windows transport host unavailable"));
		this.child.once("exit", () => this.abort("Windows transport host exited"));
		this.started = this.request("start", {}).then((result) => {
			if (result.state !== "partial") throw safeError("Windows transport host unavailable");
		});
		return this.started;
	}

	request(operation: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
		const kind = operation === "ack" ? "ack" : "rpc";
		if (!/^[a-z-]{1,32}$/.test(operation) || hasPrivateData(values) || (kind === "rpc" ? this.pendingRpcs >= MAX_PENDING : this.pendingAcks >= MAX_PENDING_ACK)) return Promise.reject(safeError("Windows transport request unavailable"));
		const child = this.child;
		if (!child || this.stopped || !child.stdin.writable) return Promise.reject(safeError("Windows transport host exited"));
		const requestId = `${operation}-${++this.sequence}`;
		const line = JSON.stringify({ requestId, operation, ...values });
		if (Buffer.byteLength(line, "utf8") > MAX_CONTROL_BYTES) return Promise.reject(safeError("Windows transport request unavailable"));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => this.settle(requestId, safeError("Windows transport request timed out")), kind === "ack" ? CALLBACK_DEADLINE_MS : this.deadline);
			this.pending.set(requestId, { kind, resolve, reject, timer });
			if (kind === "ack") this.pendingAcks++; else this.pendingRpcs++;
			try { child.stdin.write(`${line}\n`, (error) => { if (error) this.settle(requestId, safeError("Windows transport host exited")); }); }
			catch { this.settle(requestId, safeError("Windows transport host exited")); }
		});
	}

	async listen(sessionId: string, createdAt = Date.now()): Promise<WindowsRecord> {
		const result = validRecord(await this.request("listen", { sessionId, createdAt }));
		this.listenerGeneration++;
		this.listenerActive = true;
		return result;
	}

	async stopListener(record: PresenceRecord) {
		this.listenerActive = false;
		await this.request("stop-listener", { record: validRecord(record as unknown as Record<string, unknown>) });
	}

	async close() {
		this.listenerActive = false;
		if (this.stopped) return;
		const child = this.child;
		if (!child) { this.stopped = true; return; }
		if (!this.stopped) await this.request("shutdown", {}).catch(() => {});
		this.stopped = true;
		if (child.exitCode !== null || child.signalCode !== null) return;
		await new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
		if (child.exitCode === null && child.signalCode === null) child.kill();
	}

	private onOutput(chunk: Buffer) {
		if (!Buffer.isBuffer(chunk)) { this.abort("Windows transport host unavailable", true); return; }
		const output = this.output.length === 0 ? chunk : Buffer.concat([this.output, chunk]);
		let offset = 0;
		for (;;) {
			const newline = output.indexOf(10, offset);
			if (newline < 0) {
				const partial = output.subarray(offset);
				if (partial.length > MAX_PRIVATE_EVENT_BYTES) this.abort("Windows transport host unavailable", true);
				else this.output = Buffer.from(partial);
				return;
			}
			const bytes = output.subarray(offset, newline);
			offset = newline + 1;
			if (bytes.length > MAX_PRIVATE_EVENT_BYTES) { this.abort("Windows transport host unavailable", true); return; }
			let line: string;
			try {
				// Newlines are single UTF-8 bytes, so retaining only an unterminated byte
				// suffix preserves split code points without decoding partial chunks.
				line = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch { this.abort("Windows transport host unavailable", true); return; }
			try {
				const event = parseWindowsHostNotification(line);
				if (event) { void this.acknowledge(event); continue; }
				const reply = parseWindowsHostFrame(line);
				this.settle(reply.requestId, reply.ok ? undefined : safeError("Windows transport request unavailable"), reply.result);
			} catch (error) {
				// Only a schema-validated private event can isolate its embedded client wire.
				if (error instanceof InvalidClientWireError) continue;
				this.abort("Windows transport host unavailable", true);
				return;
			}
		}
	}

	private async acknowledge(event: HostEvent) {
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
	private abort(message: string, closeChild = false) {
		if (this.stopped) return;
		this.stopped = true;
		this.listenerActive = false;
		for (const id of [...this.pending.keys()]) this.settle(id, safeError(message));
		const child = this.child;
		if (closeChild && child && child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch {} }
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

/** Windows metadata stays in the PowerShell owner process; Node sees only public activation records. */
export class WindowsSessionPresenceRegistry {
	readonly paths = Object.freeze({ root: "", presence: "", sockets: "" });
	private readonly host: WindowsSessionTransportHost;
	private notification?: WindowsHostCallback;
	private constructor(host: WindowsSessionTransportHost) { this.host = host; }
	static async create(agentHome: string) {
		if (process.platform !== "win32") throw new SessionPresenceError("io_error", "transport I/O failed");
		if (typeof agentHome !== "string" || !/^[A-Za-z]:\\/.test(agentHome)) throw new SessionPresenceError("unsafe_path", "unsafe transport path");
		let registry: WindowsSessionPresenceRegistry | undefined;
		const host = new WindowsSessionTransportHost({ callback: async (notification) => registry?.notification?.(notification) ?? false });
		try {
			await host.start();
			const initialized = await host.request("initialize", { agentHome });
			if (initialized.state !== "initialized" || initialized.bootstrap !== "complete") throw safeError("Windows transport host unavailable");
			registry = new WindowsSessionPresenceRegistry(host);
			return registry;
		} catch { await host.close(); registryError(undefined); }
	}
	setNotification(callback: WindowsHostCallback) { this.notification = callback; }
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
	async close() { await this.host.close(); }
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
	constructor(registry: WindowsSessionPresenceRegistry, sessionID: string, onNotification: (notification: ReceivedNotification) => Promise<void>) { this.registry = registry; this.sessionID = sessionID; this.onNotification = onNotification; this.closed = new Promise((resolve) => { this.resolveClosed = resolve; }); }
	get status() { return this.state; }
	get activeConnections() { return 0; }
	async start() {
		if (this.state !== "idle") return;
		const generation = ++this.generation;
		this.state = "starting";
		this.registry.setNotification((notification) => this.receive(notification));
		try {
			const record = await this.registry.startListener(this.sessionID);
			if (this.state === "closed" || this.generation !== generation) { await this.registry.stopListener(record); throw new SessionPresenceError("io_error", "listener is closed"); }
			this.record = record;
			this.state = "active";
		} catch (error) { if (this.state !== "closed" && this.generation === generation) this.state = "idle"; throw error; }
	}
	async receive(notification: Readonly<{ id: string; senderSessionId: string; recipientSessionId: string; message: string }>) { if ((this.state !== "starting" && this.state !== "active") || notification.recipientSessionId !== this.sessionID) return false; try { await this.onNotification(Object.freeze({ id: notification.id, senderSessionId: notification.senderSessionId, message: notification.message })); return true; } catch { return false; } }
	async close() { if (this.state === "closed") return; this.generation++; this.state = "closed"; if (this.record) await this.registry.stopListener(this.record); await this.registry.close(); this.resolveClosed(); }
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
