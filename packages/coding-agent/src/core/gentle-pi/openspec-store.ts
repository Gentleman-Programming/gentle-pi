import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { GENTLE_PI_ENVELOPE_STATUS, type GentlePiPhase, type GentlePiResultEnvelope } from "./types.js";

export interface OpenSpecPaths {
	root: string;
	config: string;
	changes: string;
}

export interface OpenSpecWriteResult {
	artifactPath: string;
	previousContent: string | undefined;
	writtenContent: string;
	continued: boolean;
}

export interface GentlePiExecutionMetadata {
	phase: GentlePiPhase;
	startedAt: string;
}

export interface GentlePiContext {
	changeName: string;
	paths: OpenSpecPaths;
	configContent: string;
	existingArtifacts: string[];
	metadata: GentlePiExecutionMetadata;
}

export interface GentlePiContextSuccess {
	status: "success";
	context: GentlePiContext;
}

export interface GentlePiContextBlocked extends GentlePiResultEnvelope {
	status: "blocked";
	reason: string;
}

export type GentlePiContextResult = GentlePiContextSuccess | GentlePiContextBlocked;

export interface OpenSpecStore {
	readonly projectRoot: string;
	readonly paths: OpenSpecPaths;
	readConfig(): string | undefined;
	listChangeArtifacts(changeName: string): string[];
	readChangeArtifact(changeName: string, relativePath: string): string | undefined;
	writeChangeArtifact(changeName: string, relativePath: string, content: string): OpenSpecWriteResult;
}

function createPaths(projectRoot: string): OpenSpecPaths {
	const root = join(projectRoot, "openspec");
	return {
		root,
		config: join(root, "config.yaml"),
		changes: join(root, "changes"),
	};
}

function listFilesRecursive(root: string, prefix = ""): string[] {
	if (!existsSync(root)) return [];
	const entries = readdirSync(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFilesRecursive(fullPath, relativePath));
		} else {
			files.push(relativePath);
		}
	}
	return files.sort();
}

export function createOpenSpecStore(projectRoot: string): OpenSpecStore {
	const paths = createPaths(projectRoot);
	return {
		projectRoot,
		paths,
		readConfig() {
			return existsSync(paths.config) ? readFileSync(paths.config, "utf8") : undefined;
		},
		listChangeArtifacts(changeName) {
			return listFilesRecursive(join(paths.changes, changeName));
		},
		readChangeArtifact(changeName, relativePath) {
			const artifactPath = join(paths.changes, changeName, relativePath);
			return existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : undefined;
		},
		writeChangeArtifact(changeName, relativePath, content) {
			const artifactPath = join(paths.changes, changeName, relativePath);
			const previousContent = existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : undefined;
			mkdirSync(dirname(artifactPath), { recursive: true });
			writeFileSync(artifactPath, content);
			return { artifactPath, previousContent, writtenContent: content, continued: previousContent !== undefined };
		},
	};
}

export function initializeGentlePiContext(options: {
	projectRoot: string;
	changeName: string;
	phase: GentlePiPhase;
}): GentlePiContextResult {
	const store = createOpenSpecStore(options.projectRoot);
	const configContent = store.readConfig();
	if (!configContent) {
		return {
			status: GENTLE_PI_ENVELOPE_STATUS.BLOCKED,
			executive_summary: "OpenSpec config is missing.",
			artifacts: [],
			next_recommended: "sdd-init",
			risks: "openspec/config.yaml is required before phase execution",
			reason: "openspec-config-missing",
		};
	}
	try {
		YAML.parse(configContent);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: GENTLE_PI_ENVELOPE_STATUS.BLOCKED,
			executive_summary: "OpenSpec config is invalid.",
			artifacts: [],
			next_recommended: "sdd-init",
			risks: `openspec/config.yaml must be valid YAML before phase execution: ${message}`,
			reason: "openspec-config-invalid",
		};
	}
	return {
		status: GENTLE_PI_ENVELOPE_STATUS.SUCCESS,
		context: {
			changeName: options.changeName,
			paths: store.paths,
			configContent,
			existingArtifacts: store.listChangeArtifacts(options.changeName),
			metadata: { phase: options.phase, startedAt: new Date().toISOString() },
		},
	};
}
