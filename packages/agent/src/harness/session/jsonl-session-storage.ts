import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CodingAgentSessionInfo, SessionInfo, SessionTreeEntry, SessionTreeStorage } from "../types.js";

interface SessionHeader {
	type: "session";
	version: 3;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

function headerToSessionInfo(header: SessionHeader, filePath?: string): CodingAgentSessionInfo {
	return {
		id: header.id,
		createdAt: header.timestamp,
		parentSession: header.parentSession,
		projectCwd: header.cwd,
		filePath,
	};
}

async function loadJsonlStorage(
	filePath: string,
): Promise<{ header?: SessionHeader; entries: SessionTreeEntry[]; leafId: string | null }> {
	try {
		const content = await readFile(filePath, "utf8");
		const entries: SessionTreeEntry[] = [];
		let header: SessionHeader | undefined;
		let leafId: string | null = null;
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line) as SessionHeader | SessionTreeEntry;
				if (record.type === "session") {
					header = record as SessionHeader;
					continue;
				}
				entries.push(record as SessionTreeEntry);
				leafId = (record as SessionTreeEntry).id;
			} catch {
				// ignore malformed lines
			}
		}
		return { header, entries, leafId };
	} catch {
		return { entries: [], leafId: null };
	}
}

export class JsonlSessionTreeStorage implements SessionTreeStorage {
	private filePath: string;
	private cwd: string;
	private headerInitialized = false;
	private cacheLoaded = false;
	private sessionInfo?: CodingAgentSessionInfo;
	private entries: SessionTreeEntry[] = [];
	private byId = new Map<string, SessionTreeEntry>();
	private currentLeafId: string | null = null;
	private requestedSessionId?: string;
	private parentSession?: string;

	constructor(filePath: string, options: { cwd: string; sessionId?: string; parentSession?: string }) {
		this.filePath = resolve(filePath);
		this.cwd = options.cwd;
		this.requestedSessionId = options.sessionId;
		this.parentSession = options.parentSession;
	}

	private async ensureParentDir(): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
	}

	private async ensureLoaded(): Promise<void> {
		if (this.cacheLoaded) {
			return;
		}
		const loaded = await loadJsonlStorage(this.filePath);
		this.entries = loaded.entries;
		this.byId = new Map(loaded.entries.map((entry) => [entry.id, entry]));
		this.currentLeafId = loaded.leafId;
		this.headerInitialized = loaded.header !== undefined;
		if (loaded.header) {
			this.sessionInfo = headerToSessionInfo(loaded.header, this.filePath);
		}
		this.cacheLoaded = true;
	}

	private async ensureHeader(): Promise<void> {
		await this.ensureLoaded();
		if (this.headerInitialized) return;
		await this.ensureParentDir();
		const header: SessionHeader = {
			type: "session",
			version: 3,
			id: this.requestedSessionId ?? randomUUID(),
			timestamp: new Date().toISOString(),
			cwd: this.cwd,
			parentSession: this.parentSession,
		};
		await writeFile(this.filePath, `${JSON.stringify(header)}\n`);
		this.sessionInfo = headerToSessionInfo(header, this.filePath);
		this.headerInitialized = true;
	}

	async getSessionInfo(): Promise<SessionInfo> {
		await this.ensureHeader();
		return this.sessionInfo!;
	}

	async getLeafId(): Promise<string | null> {
		await this.ensureLoaded();
		return this.currentLeafId;
	}

	async setLeafId(leafId: string | null): Promise<void> {
		await this.ensureLoaded();
		this.currentLeafId = leafId;
	}

	async appendEntry(entry: SessionTreeEntry): Promise<void> {
		await this.ensureHeader();
		await appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
		this.entries.push(entry);
		this.byId.set(entry.id, entry);
		this.currentLeafId = entry.id;
	}

	async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
		await this.ensureLoaded();
		return this.byId.get(id);
	}

	async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
		await this.ensureLoaded();
		if (leafId === null) return [];
		const path: SessionTreeEntry[] = [];
		let current = this.byId.get(leafId);
		while (current) {
			path.unshift(current);
			current = current.parentId ? this.byId.get(current.parentId) : undefined;
		}
		return path;
	}

	async getEntries(): Promise<SessionTreeEntry[]> {
		await this.ensureLoaded();
		return [...this.entries];
	}
}
