import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseDeltaSpec } from "./openspec-deltas.ts";

export interface DomainCollision {
	change: string;
	path: string;
}

export interface LegacyFlatSpecWarning {
	change: string;
	path: string;
	hasDomainSpecs: boolean;
}

export interface LargeModifiedRequirement {
	name: string;
	lineCount: number;
}

export interface DestructiveDeltaReport {
	destructive: boolean;
	removedRequirements: string[];
	largeModifiedRequirements: LargeModifiedRequirement[];
}

export interface DestructiveDeltaOptions {
	largeModifiedLineThreshold?: number;
}

function safeDirectories(path: string): string[] {
	try {
		return readdirSync(path).filter((entry) => {
			try {
				return statSync(join(path, entry)).isDirectory();
			} catch {
				return false;
			}
		});
	} catch {
		return [];
	}
}

function hasAnyDomainSpec(specsDir: string): boolean {
	for (const domain of safeDirectories(specsDir)) {
		if (existsSync(join(specsDir, domain, "spec.md"))) return true;
	}
	return false;
}

export function detectActiveDomainCollisions(
	cwd: string,
	changeName: string,
	domain: string,
): DomainCollision[] {
	const changesDir = join(cwd, "openspec", "changes");
	const collisions: DomainCollision[] = [];
	for (const change of safeDirectories(changesDir)) {
		if (change === "archive" || change === changeName) continue;
		const path = join(changesDir, change, "specs", domain, "spec.md");
		if (existsSync(path)) collisions.push({ change, path });
	}
	return collisions;
}

export function detectLegacyFlatSpec(
	cwd: string,
	changeName: string,
): LegacyFlatSpecWarning | undefined {
	const changeDir = join(cwd, "openspec", "changes", changeName);
	const path = join(changeDir, "spec.md");
	if (!existsSync(path)) return undefined;
	return {
		change: changeName,
		path,
		hasDomainSpecs: hasAnyDomainSpec(join(changeDir, "specs")),
	};
}

export function analyzeDeltaDestructiveness(
	deltaMarkdown: string,
	options: DestructiveDeltaOptions = {},
): DestructiveDeltaReport {
	const threshold = options.largeModifiedLineThreshold ?? 40;
	const delta = parseDeltaSpec(deltaMarkdown);
	const removedRequirements = delta.removed.map((block) => block.name);
	const largeModifiedRequirements = delta.modified
		.map((block) => ({
			name: block.name,
			lineCount: block.content.split("\n").length,
		}))
		.filter((block) => block.lineCount >= threshold);
	return {
		destructive: removedRequirements.length > 0 || largeModifiedRequirements.length > 0,
		removedRequirements,
		largeModifiedRequirements,
	};
}
