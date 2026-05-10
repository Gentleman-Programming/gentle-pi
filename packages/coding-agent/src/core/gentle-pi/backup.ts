import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GentlePiPhase } from "./types.js";

export interface RollbackCheckpointMetadata {
	changeName: string;
	phase: GentlePiPhase;
	reason: string;
	createdAt: string;
	files: string[];
}

export interface RollbackCheckpointCopy {
	source: string;
	checkpointPath: string;
	exists: boolean;
}

export interface RollbackCheckpoint {
	metadata: RollbackCheckpointMetadata;
	directory: string;
	metadataPath: string;
	copies: RollbackCheckpointCopy[];
}

function safeSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function createRollbackCheckpoint(options: {
	projectRoot: string;
	changeName: string;
	phase: GentlePiPhase;
	files: string[];
	reason: string;
}): RollbackCheckpoint {
	const createdAt = new Date().toISOString();
	const directory = join(
		options.projectRoot,
		"openspec",
		"changes",
		options.changeName,
		"rollback-checkpoints",
		safeSegment(createdAt),
	);
	mkdirSync(directory, { recursive: true });
	const copies = options.files.map((file) => {
		const source = join(options.projectRoot, file);
		const checkpointPath = join(directory, file);
		mkdirSync(dirname(checkpointPath), { recursive: true });
		const exists = existsSync(source);
		if (exists) {
			copyFileSync(source, checkpointPath);
		}
		return { source, checkpointPath, exists };
	});
	const metadata: RollbackCheckpointMetadata = {
		changeName: options.changeName,
		phase: options.phase,
		reason: options.reason,
		createdAt,
		files: [...options.files],
	};
	const metadataPath = join(directory, "metadata.json");
	writeFileSync(metadataPath, `${JSON.stringify({ metadata, copies }, null, 2)}\n`);
	return { metadata, directory, metadataPath, copies };
}
