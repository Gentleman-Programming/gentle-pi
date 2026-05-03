import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { v7 as uuidv7 } from "uuid";
import type {
	CodingAgentSessionInfo,
	CodingAgentSessionRepo,
	Session,
	SessionInfo,
	SessionRepo,
	SessionTreeEntry,
} from "../types.js";
import { JsonlSessionTreeStorage } from "./jsonl-session-storage.js";
import { InMemorySessionTreeStorage } from "./memory-session-storage.js";
import { DefaultSessionTree } from "./session-tree.js";

function createSessionId(): string {
	return uuidv7();
}

function createTimestamp(): string {
	return new Date().toISOString();
}

function toSession<TInfo extends SessionInfo>(info: TInfo, tree: DefaultSessionTree): Session<TInfo> {
	return { info, tree };
}

function getPathEntriesToFork(
	entries: SessionTreeEntry[],
	entryId: string,
	position: "before" | "at",
): SessionTreeEntry[] {
	const byId = new Map<string, SessionTreeEntry>(entries.map((entry) => [entry.id, entry]));
	const target = byId.get(entryId);
	if (!target) {
		throw new Error(`Entry ${entryId} not found`);
	}
	let effectiveLeafId: string | null;
	if (position === "at") {
		effectiveLeafId = target.id;
	} else {
		if (target.type !== "message" || target.message.role !== "user") {
			throw new Error(`Entry ${entryId} is not a user message`);
		}
		effectiveLeafId = target.parentId;
	}
	if (effectiveLeafId === null) {
		return [];
	}
	const path: SessionTreeEntry[] = [];
	let current = byId.get(effectiveLeafId);
	while (current) {
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path;
}

export class InMemorySessionRepo implements SessionRepo<string> {
	private sessions = new Map<string, Session<SessionInfo>>();

	async create(options?: { id?: string; parentSession?: string }): Promise<Session<SessionInfo>> {
		const info: SessionInfo = {
			id: options?.id ?? createSessionId(),
			createdAt: createTimestamp(),
			parentSession: options?.parentSession,
		};
		const storage = new InMemorySessionTreeStorage({ sessionInfo: info });
		const session = toSession(info, new DefaultSessionTree(storage));
		this.sessions.set(info.id, session);
		return session;
	}

	async open(ref: string): Promise<Session<SessionInfo>> {
		const session = this.sessions.get(ref);
		if (!session) {
			throw new Error(`Session not found: ${ref}`);
		}
		return session;
	}

	async list(): Promise<Array<Session<SessionInfo>>> {
		return [...this.sessions.values()];
	}

	async delete(ref: string): Promise<void> {
		this.sessions.delete(ref);
	}

	async fork(
		ref: string,
		options: { entryId: string; position?: "before" | "at"; id?: string },
	): Promise<Session<SessionInfo>> {
		const source = await this.open(ref);
		const entries = await source.tree.getEntries();
		const forkedEntries = getPathEntriesToFork(entries, options.entryId, options.position ?? "before");
		const info: SessionInfo = {
			id: options.id ?? createSessionId(),
			createdAt: createTimestamp(),
			parentSession: source.info.id,
		};
		const leafId = forkedEntries[forkedEntries.length - 1]?.id ?? null;
		const storage = new InMemorySessionTreeStorage({ sessionInfo: info, entries: forkedEntries, leafId });
		const session = toSession(info, new DefaultSessionTree(storage));
		this.sessions.set(info.id, session);
		return session;
	}
}

function readJsonlHeader(filePath: string): CodingAgentSessionInfo | undefined {
	try {
		const content = readFileSync(filePath, "utf8");
		const firstLine = content.split("\n")[0];
		if (!firstLine) return undefined;
		const header = JSON.parse(firstLine) as {
			type: string;
			id: string;
			timestamp: string;
			cwd: string;
			parentSession?: string;
		};
		if (header.type !== "session") return undefined;
		return {
			id: header.id,
			createdAt: header.timestamp,
			parentSession: header.parentSession,
			projectCwd: header.cwd,
			filePath,
		};
	} catch {
		return undefined;
	}
}

export class JsonlCodingAgentSessionRepo implements CodingAgentSessionRepo<string> {
	private sessionDir: string;
	private cwd: string;

	constructor(options: { sessionDir: string; cwd: string }) {
		this.sessionDir = resolve(options.sessionDir);
		this.cwd = options.cwd;
		mkdirSync(this.sessionDir, { recursive: true });
	}

	private createSessionFilePath(sessionId: string, timestamp: string): string {
		return join(this.sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
	}

	async create(options?: { id?: string; parentSession?: string }): Promise<Session<CodingAgentSessionInfo>> {
		const id = options?.id ?? createSessionId();
		const createdAt = createTimestamp();
		const filePath = this.createSessionFilePath(id, createdAt);
		const storage = new JsonlSessionTreeStorage(filePath, {
			cwd: this.cwd,
			sessionId: id,
			parentSession: options?.parentSession,
		});
		const info = (await storage.getSessionInfo()) as CodingAgentSessionInfo;
		return toSession(info, new DefaultSessionTree(storage));
	}

	async open(ref: string): Promise<Session<CodingAgentSessionInfo>> {
		const filePath = ref.includes("/") || ref.endsWith(".jsonl") ? resolve(ref) : join(this.sessionDir, ref);
		if (!existsSync(filePath)) {
			throw new Error(`Session not found: ${ref}`);
		}
		const storage = new JsonlSessionTreeStorage(filePath, { cwd: this.cwd });
		const info = (await storage.getSessionInfo()) as CodingAgentSessionInfo;
		return toSession(info, new DefaultSessionTree(storage));
	}

	async list(): Promise<Array<Session<CodingAgentSessionInfo>>> {
		if (!existsSync(this.sessionDir)) {
			return [];
		}
		const files = readdirSync(this.sessionDir)
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => join(this.sessionDir, file));
		const sessions: Array<Session<CodingAgentSessionInfo>> = [];
		for (const filePath of files) {
			const info = readJsonlHeader(filePath);
			if (!info) continue;
			sessions.push(
				toSession(info, new DefaultSessionTree(new JsonlSessionTreeStorage(filePath, { cwd: info.projectCwd }))),
			);
		}
		return sessions;
	}

	async listByCwd(cwd: string): Promise<Array<Session<CodingAgentSessionInfo>>> {
		return (await this.list()).filter((session) => session.info.projectCwd === cwd);
	}

	async getMostRecentByCwd(cwd: string): Promise<Session<CodingAgentSessionInfo> | undefined> {
		const sessions = await this.listByCwd(cwd);
		sessions.sort((a, b) => new Date(b.info.createdAt).getTime() - new Date(a.info.createdAt).getTime());
		return sessions[0];
	}

	async delete(ref: string): Promise<void> {
		const filePath = ref.includes("/") || ref.endsWith(".jsonl") ? resolve(ref) : join(this.sessionDir, ref);
		if (existsSync(filePath)) {
			rmSync(filePath, { force: true });
		}
	}

	async fork(
		ref: string,
		options: { entryId: string; position?: "before" | "at"; id?: string },
	): Promise<Session<CodingAgentSessionInfo>> {
		const source = await this.open(ref);
		const entries = await source.tree.getEntries();
		const forkedEntries = getPathEntriesToFork(entries, options.entryId, options.position ?? "before");
		const id = options.id ?? createSessionId();
		const createdAt = createTimestamp();
		const filePath = this.createSessionFilePath(id, createdAt);
		const storage = new JsonlSessionTreeStorage(filePath, {
			cwd: source.info.projectCwd,
			sessionId: id,
			parentSession: source.info.filePath ?? source.info.id,
		});
		for (const entry of forkedEntries) {
			await storage.appendEntry(entry);
		}
		if (forkedEntries.length === 0) {
			await storage.getSessionInfo();
		}
		const info = (await storage.getSessionInfo()) as CodingAgentSessionInfo;
		return toSession(info, new DefaultSessionTree(storage));
	}
}
