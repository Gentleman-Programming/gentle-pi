import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { resolveGentlePiAgentHome } from "./agent-home.ts";

/**
 * Engram child-session capability (gentle-ai#602 runtime half, gentle-pi#593).
 *
 * SDD agent frontmatter declares `mem_*` tool names, but a declared name never
 * loads the extension that registers it. Foreground children on modern
 * pi-subagents never load the parent's ambient extensions, so those tools only
 * exist when the gentle-engram extension is loaded explicitly in the child via
 * `subagentOnlyExtensions`. Pi resolves extension entries as file paths, so the
 * installer stamps the per-machine absolute entry path into installed agent
 * frontmatter — the shipped assets stay machine-independent.
 */

const ENGRAM_PACKAGE_NAME = "gentle-engram";
const CAPABILITY_KEY = "subagentOnlyExtensions";
const MEMORY_TOOL_PATTERN = /^mem_[a-z0-9_]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve the installed gentle-engram Pi extension entry file, or undefined
 * when gentle-engram is not installed under the Pi package root or does not
 * declare a loadable `pi.extensions[0]`.
 */
export function resolveEngramExtensionEntry(
	agentHome: string = resolveGentlePiAgentHome(),
): string | undefined {
	const packageDir = join(agentHome, "npm", "node_modules", ENGRAM_PACKAGE_NAME);
	try {
		const manifestPath = join(packageDir, "package.json");
		if (!existsSync(manifestPath)) return undefined;
		const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (!isRecord(parsed)) return undefined;
		const pi = parsed.pi;
		if (!isRecord(pi)) return undefined;
		const extensions = pi.extensions;
		if (!Array.isArray(extensions)) return undefined;
		const entry = extensions.find(
			(candidate): candidate is string =>
				typeof candidate === "string" && candidate.trim().length > 0,
		);
		if (entry === undefined) return undefined;
		const entryPath = isAbsolute(entry) ? entry : join(packageDir, entry);
		return existsSync(entryPath) ? resolve(entryPath) : undefined;
	} catch {
		return undefined;
	}
}

function frontmatterLines(content: string): string[] | undefined {
	if (!content.startsWith("---\n")) return undefined;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return undefined;
	return content.slice(4, endIndex).split("\n");
}

/**
 * True when the agent frontmatter allowlists at least one `mem_*` tool, in
 * either scalar CSV or YAML bullet form.
 */
export function declaresMemoryTools(content: string): boolean {
	const lines = frontmatterLines(content);
	if (lines === undefined) return false;
	const toolsIndex = lines.findIndex((line) => /^tools:/.test(line));
	if (toolsIndex === -1) return false;
	const scalar = lines[toolsIndex].slice("tools:".length).trim();
	if (scalar.length > 0) {
		return scalar
			.split(",")
			.map((tool) => tool.trim())
			.some((tool) => MEMORY_TOOL_PATTERN.test(tool));
	}
	for (const line of lines.slice(toolsIndex + 1)) {
		const bullet = line.match(/^\s+-\s+(.+)$/);
		if (!bullet) break;
		if (MEMORY_TOOL_PATTERN.test(bullet[1].trim())) return true;
	}
	return false;
}

/**
 * Idempotently insert, replace, or strip the `subagentOnlyExtensions` line in
 * agent frontmatter. The line is stamped (single CSV scalar, immediately after
 * the tools block) only when the agent declares `mem_*` tools AND a resolvable
 * gentle-engram entry exists; otherwise any existing line is stripped.
 */
export function updateFrontmatterEngramCapability(
	content: string,
	engramExtensionEntry: string | undefined,
): string {
	const lines = frontmatterLines(content);
	if (lines === undefined) return content;
	const shouldStamp =
		engramExtensionEntry !== undefined && declaresMemoryTools(content);
	const endIndex = content.indexOf("\n---", 4);
	const body = content.slice(endIndex);

	const cleaned: string[] = [];
	let toolsHeaderIndex = -1;
	let lastToolsBulletIndex = -1;
	for (const line of lines) {
		if (/^subagentOnlyExtensions:/.test(line)) continue;
		if (/^tools:/.test(line)) toolsHeaderIndex = cleaned.length;
		if (/^\s+-\s+/.test(line)) lastToolsBulletIndex = cleaned.length;
		cleaned.push(line);
	}

	if (!shouldStamp) {
		return cleaned.length === lines.length
			? content
			: `---\n${cleaned.join("\n")}${body}`;
	}
	const insertIndex =
		lastToolsBulletIndex >= 0
			? lastToolsBulletIndex + 1
			: toolsHeaderIndex >= 0
				? toolsHeaderIndex + 1
				: cleaned.length;
	cleaned.splice(insertIndex, 0, `${CAPABILITY_KEY}: ${engramExtensionEntry}`);
	return `---\n${cleaned.join("\n")}${body}`;
}

/**
 * Remove `subagentOnlyExtensions` lines from agent frontmatter so packaged and
 * installed content can be compared for drift without flagging the stamped
 * per-machine capability line.
 */
export function stripEngramCapabilityLines(content: string): string {
	const lines = frontmatterLines(content);
	if (lines === undefined) return content;
	const endIndex = content.indexOf("\n---", 4);
	const body = content.slice(endIndex);
	const cleaned = lines.filter((line) => !/^subagentOnlyExtensions:/.test(line));
	return cleaned.length === lines.length
		? content
		: `---\n${cleaned.join("\n")}${body}`;
}
