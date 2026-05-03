import { randomUUID } from "crypto";
import type { SessionInfo, SessionTreeEntry, SessionTreeStorage } from "../types.js";

export class InMemorySessionTreeStorage implements SessionTreeStorage {
	private entries: SessionTreeEntry[];
	private leafId: string | null;
	private sessionInfo: SessionInfo;

	constructor(options?: { entries?: SessionTreeEntry[]; leafId?: string | null; sessionInfo?: SessionInfo }) {
		this.entries = options?.entries ? [...options.entries] : [];
		this.leafId = options?.leafId ?? this.entries[this.entries.length - 1]?.id ?? null;
		this.sessionInfo = options?.sessionInfo ?? { id: randomUUID(), createdAt: new Date().toISOString() };
	}

	async getSessionInfo(): Promise<SessionInfo> {
		return this.sessionInfo;
	}

	async getLeafId(): Promise<string | null> {
		return this.leafId;
	}

	async setLeafId(leafId: string | null): Promise<void> {
		this.leafId = leafId;
	}

	async appendEntry(entry: SessionTreeEntry): Promise<void> {
		this.entries.push(entry);
		this.leafId = entry.id;
	}

	async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
		return this.entries.find((entry) => entry.id === id);
	}

	async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
		if (leafId === null) return [];
		const byId = new Map<string, SessionTreeEntry>(this.entries.map((entry) => [entry.id, entry]));
		const path: SessionTreeEntry[] = [];
		let current = byId.get(leafId);
		while (current) {
			path.unshift(current);
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		return path;
	}

	async getEntries(): Promise<SessionTreeEntry[]> {
		return [...this.entries];
	}
}
