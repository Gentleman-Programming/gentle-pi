import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, normalize, relative, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REGISTRY_REL_PATH = ".atl/skill-registry.md";
const CACHE_REL_PATH = ".atl/.skill-registry.cache.json";
const SECTION_MARKER = "## Selected skills and compact rules";
const EXCLUDE_NAMES = new Set(["_shared", "skill-registry"]);
const EXCLUDE_PREFIXES = ["sdd-"];
const ATL_IGNORE_ENTRY = ".atl/";
const WATCH_DEBOUNCE_MS = 500;
const REGISTRY_SCHEMA_VERSION = 4;
const NO_SKILL_REGISTRY_FLAG = "no-skill-registry";
const NO_SKILL_REGISTRY_ENV = "GENTLE_PI_NO_SKILL_REGISTRY";
const LEGACY_PROJECT_REGISTRY_REL_PATH = ".pi/extensions/skill-registry.ts";
const LEGACY_PROJECT_REGISTRY_DISABLED_REL_PATH =
	".pi/extensions/skill-registry.ts.disabled";

interface SkillEntry {
	name: string;
	path: string;
	description: string;
	rules: string[];
}

function userSkillDirs(): string[] {
	const home = homedir();
	return [
		join(home, ".pi/agent/skills"),
		join(home, ".config/agents/skills"),
		join(home, ".agents/skills"),
		join(home, ".kimi/skills"),
		join(home, ".config/opencode/skills"),
		join(home, ".config/kilo/skills"),
		join(home, ".claude/skills"),
		join(home, ".gemini/skills"),
		join(home, ".gemini/antigravity/skills"),
		join(home, ".cursor/skills"),
		join(home, ".copilot/skills"),
		join(home, ".codex/skills"),
		join(home, ".codeium/windsurf/skills"),
		join(home, ".qwen/skills"),
		join(home, ".kiro/skills"),
		join(home, ".openclaw/skills"),
	];
}

function projectSkillDirs(cwd: string): string[] {
	return [
		join(cwd, "skills"),
		join(cwd, ".opencode/skills"),
		join(cwd, ".claude/skills"),
		join(cwd, ".gemini/skills"),
		join(cwd, ".cursor/skills"),
		join(cwd, ".github/skills"),
		join(cwd, ".codex/skills"),
		join(cwd, ".qwen/skills"),
		join(cwd, ".kiro/skills"),
		join(cwd, ".openclaw/skills"),
		join(cwd, ".pi/skills"),
		join(cwd, ".agent/skills"),
		join(cwd, ".agents/skills"),
		join(cwd, ".atl/skills"),
	];
}

function findSkillFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const stack: string[] = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
			} else if (entry.isFile() && entry.name === "SKILL.md") {
				out.push(full);
			}
		}
	}
	return out.sort();
}

function parseFrontmatter(source: string): { name?: string; description?: string; body: string } {
	if (!source.startsWith("---\n")) return { body: source };
	const end = source.indexOf("\n---", 4);
	if (end === -1) return { body: source };
	const fm = source.slice(4, end);
	const body = source.slice(end + 4).replace(/^\n/, "");
	const out: { name?: string; description?: string } = {};
	for (const line of fm.split("\n")) {
		const m = line.match(/^(\w+):\s*(.*)$/);
		if (!m) continue;
		const key = m[1];
		let value = m[2].trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key === "name") out.name = value;
		else if (key === "description") out.description = value;
	}
	return { ...out, body };
}

const FALLBACK_RULE_HEADINGS = ["Hard Rules", "Critical Rules", "Critical Patterns", "Voice Rules", "Decision Gates"];
const MAX_EXTRACTED_RULE_COUNT = 15;

function extractCompactRulesSection(body: string): string[] {
	const compactRules = extractRulesFromHeadings(body, ["Compact Rules"]);
	if (compactRules.length > 0) return compactRules;
	return extractRulesFromHeadings(body, FALLBACK_RULE_HEADINGS);
}

function extractRulesFromHeadings(body: string, headings: string[]): string[] {
	const wanted = new Set(headings.map(normalizeHeading));
	let inSection = false;
	const rules: string[] = [];
	for (const raw of body.split("\n")) {
		const line = raw.trimEnd();
		const heading = line.match(/^##\s+(.+?)\s*$/);
		if (heading) {
			inSection = wanted.has(normalizeHeading(heading[1]));
			continue;
		}
		if (!inSection) continue;
		if (/^##\s+/.test(line)) {
			inSection = false;
			continue;
		}
		const rule = extractRuleLine(line);
		if (rule) {
			rules.push(rule);
			if (rules.length >= MAX_EXTRACTED_RULE_COUNT) return rules;
		}
	}
	return rules;
}

function extractRuleLine(line: string): string | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	const bullet = trimmed.match(/^-\s+(.+)$/);
	if (bullet) return bullet[1].trim();
	const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
	if (ordered) return ordered[1].trim();
	if (trimmed.startsWith("|") && trimmed.endsWith("|")) return extractRuleTableRow(trimmed);
	return undefined;
}

function extractRuleTableRow(line: string): string | undefined {
	const cells = line
		.slice(1, -1)
		.split("|")
		.map((cell) => cell.trim());
	if (cells.length < 2) return undefined;
	if (isTableSeparator(cells) || isTableHeader(cells) || !cells[0] || !cells[1]) return undefined;
	return `${cells[0]}: ${cells[1]}`;
}

function isTableSeparator(cells: string[]): boolean {
	return cells.every((cell) => cell.replace(/[\s:-]/g, "") === "");
}

function isTableHeader(cells: string[]): boolean {
	if (cells.length < 2) return false;
	const first = normalizeHeading(cells[0]);
	const second = normalizeHeading(cells[1]);
	return (first === "rule" && second === "requirement") || (first === "target" && second === "test pattern");
}

function normalizeHeading(heading: string): string {
	return heading.trim().toLowerCase();
}

function deriveSkillName(file: string, frontmatterName: string | undefined): string {
	if (frontmatterName) return frontmatterName;
	return basename(join(file, ".."));
}

function isExcluded(name: string): boolean {
	if (EXCLUDE_NAMES.has(name)) return true;
	return EXCLUDE_PREFIXES.some((p) => name.startsWith(p));
}

function comparablePath(path: string): string {
	const clean = normalize(path);
	return clean.length > 1 ? clean.replace(/[\\/]+$/, "") : clean;
}

function uniqueExistingDirs(dirs: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const dir of dirs) {
		const clean = comparablePath(dir);
		if (seen.has(clean) || !existsSync(clean)) continue;
		seen.add(clean);
		out.push(clean);
	}
	return out;
}

function loadSkill(file: string): SkillEntry | undefined {
	let source: string;
	try {
		source = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
	const fm = parseFrontmatter(source);
	const name = deriveSkillName(file, fm.name);
	if (isExcluded(name)) return undefined;
	const rules = extractCompactRulesSection(fm.body);
	return {
		name,
		path: file,
		description: extractTriggerDescription(fm.description ?? ""),
		rules:
			rules.length > 0
				? rules
				: ["No compact rules declared; delegators should load the full skill file before direct work, or pass an explicit fallback path only when Project Standards cannot be injected."],
	};
}

function extractTriggerDescription(description: string): string {
	const match = description.match(/\bTrigger:\s*(.+)$/i);
	return match ? match[1].trim() : description;
}

function dedupeBySkillName(entries: SkillEntry[], cwd: string): SkillEntry[] {
	const cleanCwd = comparablePath(cwd);
	const projectPrefix = cleanCwd.endsWith(sep) ? cleanCwd : `${cleanCwd}${sep}`;
	const buckets = new Map<string, SkillEntry[]>();
	for (const entry of entries) {
		const list = buckets.get(entry.name) ?? [];
		list.push(entry);
		buckets.set(entry.name, list);
	}
	const out: SkillEntry[] = [];
	for (const [, list] of buckets) {
		const projectScoped = list.find((e) => comparablePath(e.path).startsWith(projectPrefix));
		out.push(projectScoped ?? list[0]);
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

function fingerprint(files: string[]): string {
	const lines = [
		`schema:${REGISTRY_SCHEMA_VERSION}`,
		...files.map((f) => {
			try {
				const stat = statSync(f);
				return `${f}:${stat.mtimeMs}:${stat.size}`;
			} catch {
				return `${f}:missing`;
			}
		}),
	].sort();
	return createHash("sha1").update(lines.join("\n")).digest("hex");
}

function renderRegistry(cwd: string, sources: string[], entries: SkillEntry[]): string {
	const projectName = basename(cwd);
	const today = new Date().toISOString().slice(0, 10);
	const lines: string[] = [];
	lines.push(`# Skill Registry — ${projectName}`);
	lines.push("");
	lines.push("<!-- Auto-generated by gentle-pi extensions/skill-registry.ts. Run /skill-registry:refresh to regenerate. -->");
	lines.push("");
	lines.push(`Last updated: ${today}`);
	lines.push("");
	lines.push("## Sources scanned");
	lines.push("");
	for (const src of sources) {
		lines.push(`- ${src}`);
	}
	lines.push("");
	lines.push("## Contract");
	lines.push("");
	lines.push("**Delegator use only.** Any agent that launches subagents reads this registry to resolve compact rules, then injects matching rule text into subagent prompts under `## Project Standards (auto-resolved)`.");
	lines.push("");
	lines.push("Subagents still read their assigned executor/phase skill. During normal runtime, they do **not** independently discover or load additional project/user `SKILL.md` files or this registry; project/user rules arrive pre-digested. Explicit fallback loading is degraded self-healing and must be reported in `skill_resolution` as `fallback-registry` or `fallback-path`.");
	lines.push("");
	lines.push(SECTION_MARKER);
	lines.push("");
	for (const entry of entries) {
		lines.push(`### ${entry.name}`);
		lines.push(`- Path: ${entry.path}`);
		if (entry.description) {
			lines.push(`- Trigger: ${entry.description}`);
		}
		lines.push("- Rules:");
		for (const rule of entry.rules) {
			lines.push(`  - ${rule}`);
		}
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

interface RegenResult {
	regenerated: boolean;
	skillCount: number;
	reason: string;
}

function ensureAtlIgnored(cwd: string): void {
	const gitignorePath = join(cwd, ".gitignore");
	let existing = "";
	if (existsSync(gitignorePath)) {
		existing = readFileSync(gitignorePath, "utf8");
	}
	const hasAtlIgnore = existing
		.split("\n")
		.map((line) => line.trim())
		.some((line) => line === ".atl" || line === ATL_IGNORE_ENTRY);
	if (hasAtlIgnore) return;
	const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
	const header = existing.includes("# Local Pi runtime state") ? "" : "# Local Pi runtime state\n";
	writeFileSync(gitignorePath, `${existing}${prefix}${header}${ATL_IGNORE_ENTRY}\n`);
}

function isGeneratedLegacyProjectRegistry(source: string): boolean {
	return (
		source.includes("Auto-generated by .pi/extensions/skill-registry.ts") &&
		source.includes("const REGISTRY_REL_PATH = \".atl/skill-registry.md\"") &&
		source.includes("function projectSkillDirs(cwd: string): string[]") &&
		source.includes("function regenerateRegistry(cwd: string, force: boolean)") &&
		(!source.includes('join(cwd, "skills")') ||
			source.includes("const dirs = [...userSkillDirs(), ...projectSkillDirs(cwd)]") ||
			source.includes("if (rules.length === 0) return undefined"))
	);
}

function nextLegacyDisabledPath(cwd: string): string {
	const base = join(cwd, LEGACY_PROJECT_REGISTRY_DISABLED_REL_PATH);
	if (!existsSync(base)) return base;
	for (let i = 1; i < 100; i++) {
		const candidate = `${base}.${i}`;
		if (!existsSync(candidate)) return candidate;
	}
	return `${base}.${Date.now()}`;
}

function quarantineLegacyProjectRegistry(cwd: string): boolean {
	const legacyPath = join(cwd, LEGACY_PROJECT_REGISTRY_REL_PATH);
	if (!existsSync(legacyPath)) return false;
	let source = "";
	try {
		source = readFileSync(legacyPath, "utf8");
	} catch {
		return false;
	}
	if (!isGeneratedLegacyProjectRegistry(source)) return false;
	const disabledPath = nextLegacyDisabledPath(cwd);
	try {
		renameSync(legacyPath, disabledPath);
		return true;
	} catch {
		return false;
	}
}

function regenerateRegistry(cwd: string, force: boolean): RegenResult {
	const existingDirs = uniqueExistingDirs([...projectSkillDirs(cwd), ...userSkillDirs()]);
	const files = existingDirs.flatMap(findSkillFiles);
	const cachePath = join(cwd, CACHE_REL_PATH);
	const registryPath = join(cwd, REGISTRY_REL_PATH);
	const fp = fingerprint(files);
	let cached: string | undefined;
	if (existsSync(cachePath)) {
		try {
			cached = (JSON.parse(readFileSync(cachePath, "utf8")) as { fingerprint?: string }).fingerprint;
		} catch {
			cached = undefined;
		}
	}
	if (!force && cached === fp && existsSync(registryPath)) {
		return { regenerated: false, skillCount: 0, reason: "cache-hit" };
	}
	const entries = files
		.map(loadSkill)
		.filter((e): e is SkillEntry => Boolean(e));
	const deduped = dedupeBySkillName(entries, cwd);
	const sources = existingDirs.map((d) => {
		const rel = relative(cwd, d);
		return rel.startsWith("..") ? d : rel || ".";
	});
	const md = renderRegistry(cwd, sources, deduped);
	mkdirSync(join(cwd, ".atl"), { recursive: true });
	writeFileSync(registryPath, md);
	writeFileSync(cachePath, JSON.stringify({ fingerprint: fp }, null, 2));
	return { regenerated: true, skillCount: deduped.length, reason: force ? "forced" : "fingerprint-changed" };
}

const watchedCwds = new Set<string>();

function isTruthyEnv(value: string | undefined): boolean {
	return value === "1" || value === "true" || value === "yes" || value === "on";
}

function hasCliArg(args: string[], ...names: string[]): boolean {
	return args.some((arg) => names.includes(arg));
}

function shouldSkipSkillRegistryStartup(
	pi: Pick<ExtensionAPI, "getFlag">,
	argv = process.argv.slice(2),
	env = process.env,
): boolean {
	return (
		pi.getFlag(NO_SKILL_REGISTRY_FLAG) === true ||
		isTruthyEnv(env[NO_SKILL_REGISTRY_ENV]) ||
		hasCliArg(argv, "--no-skills", "-ns")
	);
}

function startSkillRegistryWatcher(cwd: string, notify: (message: string) => void): void {
	if (watchedCwds.has(cwd)) return;
	watchedCwds.add(cwd);
	const dirs = uniqueExistingDirs([...projectSkillDirs(cwd), ...userSkillDirs()]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const refresh = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			try {
				const result = regenerateRegistry(cwd, false);
				if (result.regenerated) {
					notify(`Skill registry refreshed (${result.skillCount} skills)`);
				}
			} catch {
				// Keep the watcher best-effort; session_start/manual refresh surfaces detailed failures.
			}
		}, WATCH_DEBOUNCE_MS);
	};
	for (const dir of dirs) {
		try {
			watch(dir, { recursive: true }, refresh);
		} catch {
			// Some filesystems do not support recursive watches; session_start/manual refresh still work.
		}
	}
}

export const __testing = {
	projectSkillDirs,
	userSkillDirs,
	extractCompactRulesSection,
	extractTriggerDescription,
	uniqueExistingDirs,
	dedupeBySkillName,
	shouldSkipSkillRegistryStartup,
};

export default function (pi: ExtensionAPI) {
	pi.registerFlag(NO_SKILL_REGISTRY_FLAG, {
		description: "Skip the Gentle AI skill registry refresh and watcher on startup.",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", async (_event, ctx) => {
		if (shouldSkipSkillRegistryStartup(pi)) return;
		try {
			ensureAtlIgnored(ctx.cwd);
			const quarantinedLegacy = quarantineLegacyProjectRegistry(ctx.cwd);
			const result = regenerateRegistry(ctx.cwd, quarantinedLegacy);
			if (result.regenerated && ctx.hasUI) {
				ctx.ui.notify(`Skill registry refreshed (${result.skillCount} skills)`, "info");
			}
			if (quarantinedLegacy && ctx.hasUI) {
				ctx.ui.notify(
					"Disabled stale project-local skill registry extension; using package registry with project skills first.",
					"warning",
				);
			}
			startSkillRegistryWatcher(ctx.cwd, (message) => {
				if (ctx.hasUI) ctx.ui.notify(message, "info");
			});
			if (quarantinedLegacy) {
				setTimeout(() => {
					try {
						regenerateRegistry(ctx.cwd, true);
					} catch {
						// Best-effort same-session self-heal in case the stale extension already ran.
					}
				}, WATCH_DEBOUNCE_MS);
			}
		} catch (error) {
			if (ctx.hasUI) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Skill registry refresh failed: ${message}`, "warning");
			}
		}
	});

	pi.registerCommand("skill-registry:refresh", {
		description: "Regenerate .atl/skill-registry.md from local skill sources.",
		handler: async (_args, ctx) => {
			try {
				ensureAtlIgnored(ctx.cwd);
				const result = regenerateRegistry(ctx.cwd, true);
				ctx.ui.notify(
					`Skill registry: ${result.skillCount} skill(s) written to ${REGISTRY_REL_PATH}`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Skill registry refresh failed: ${message}`, "warning");
			}
		},
	});
}
