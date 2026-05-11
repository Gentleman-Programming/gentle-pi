import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REGISTRY_REL_PATH = ".atl/skill-registry.md";
const CACHE_REL_PATH = ".atl/.skill-registry.cache.json";
const SECTION_MARKER = "## Selected skills and compact rules";
const EXCLUDE_NAMES = new Set(["_shared", "skill-registry"]);
const EXCLUDE_PREFIXES = ["sdd-"];
const ATL_IGNORE_ENTRY = ".atl/";
const WATCH_DEBOUNCE_MS = 500;
const REGISTRY_SCHEMA_VERSION = 2;

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
		join(home, ".agents/skills"),
		join(home, ".config/opencode/skills"),
		join(home, ".claude/skills"),
		join(home, ".gemini/skills"),
		join(home, ".cursor/skills"),
		join(home, ".copilot/skills"),
	];
}

function projectSkillDirs(cwd: string): string[] {
	return [
		join(cwd, "skills"),
		join(cwd, ".pi/skills"),
		join(cwd, ".agent/skills"),
		join(cwd, ".agents/skills"),
		join(cwd, ".claude/skills"),
		join(cwd, ".gemini/skills"),
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
	return out;
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

function extractCompactRulesSection(body: string): string[] {
	const lines = body.split("\n");
	let inSection = false;
	const rules: string[] = [];
	for (const raw of lines) {
		const line = raw.trimEnd();
		if (/^##\s+Compact Rules\s*$/i.test(line)) {
			inSection = true;
			continue;
		}
		if (!inSection) continue;
		if (/^##\s+/.test(line)) break;
		const m = line.match(/^-\s+(.+)$/);
		if (m) rules.push(m[1].trim());
	}
	return rules;
}

function deriveSkillName(file: string, frontmatterName: string | undefined): string {
	if (frontmatterName) return frontmatterName;
	return basename(join(file, ".."));
}

function isExcluded(name: string): boolean {
	if (EXCLUDE_NAMES.has(name)) return true;
	return EXCLUDE_PREFIXES.some((p) => name.startsWith(p));
}

function uniqueExistingDirs(dirs: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const dir of dirs) {
		if (seen.has(dir) || !existsSync(dir)) continue;
		seen.add(dir);
		out.push(dir);
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
		description: fm.description ?? "",
		rules:
			rules.length > 0
				? rules
				: ["No compact rules declared; delegators should load the full skill file before direct work, or pass an explicit fallback path only when Project Standards cannot be injected."],
	};
}

function dedupeBySkillName(entries: SkillEntry[], cwd: string): SkillEntry[] {
	const projectPrefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
	const buckets = new Map<string, SkillEntry[]>();
	for (const entry of entries) {
		const list = buckets.get(entry.name) ?? [];
		list.push(entry);
		buckets.set(entry.name, list);
	}
	const out: SkillEntry[] = [];
	for (const [, list] of buckets) {
		const projectScoped = list.find((e) => e.path.startsWith(projectPrefix));
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
	lines.push("<!-- Auto-generated by .pi/extensions/skill-registry.ts. Run /skill-registry:refresh to regenerate. -->");
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

function regenerateRegistry(cwd: string, force: boolean): RegenResult {
	const existingDirs = uniqueExistingDirs([...projectSkillDirs(cwd), ...userSkillDirs()]);
	const files = existingDirs.flatMap(findSkillFiles).sort();
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

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		try {
			ensureAtlIgnored(ctx.cwd);
			const result = regenerateRegistry(ctx.cwd, false);
			if (result.regenerated && ctx.hasUI) {
				ctx.ui.notify(`Skill registry refreshed (${result.skillCount} skills)`, "info");
			}
			startSkillRegistryWatcher(ctx.cwd, (message) => {
				if (ctx.hasUI) ctx.ui.notify(message, "info");
			});
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
