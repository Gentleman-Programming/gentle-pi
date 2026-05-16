import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function shyConfigPath(cwd: string): string {
	return join(cwd, ".pi", "gentle-ai", "shy.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isShyMode(cwd: string): boolean {
	const path = shyConfigPath(cwd);
	if (!existsSync(path)) return false;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) && parsed.shy === true;
	} catch {
		return false;
	}
}

export function setShyMode(cwd: string, enabled: boolean): void {
	const path = shyConfigPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ shy: enabled }, null, 2)}\n`);
}

export function toggleShyMode(cwd: string): boolean {
	const next = !isShyMode(cwd);
	setShyMode(cwd, next);
	return next;
}
