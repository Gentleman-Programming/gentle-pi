import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const execAsync = promisify(exec);

const PI_AGENT_DIR = join(os.homedir(), ".pi", "agent");
const PI_NPM_DIR = join(PI_AGENT_DIR, "npm", "node_modules");
const PI_GIT_DIR = join(PI_AGENT_DIR, "git");

const TEXT_LOGO = [
  "                  ▄▄▄▀▀▀▀▀██                                ▄▄▀▄▄           ▄▄█▀▀▀██   ▀▀█▄    ▄▄▄",
  "              ▄▄█▀▀▒▒▒▒▒▄▄█▀▒                   ▄██     ▄▄█▀█▄█▀▒▒      ▄█▀▀ ▒▒▒▄█▀▀▒   ▄██▒ ▄█▀▒▒▒",
  "          ▄▄██▀▒▒▒▒▒▄▄▄▀▀▒▒▒▒        ▄▄▄  ▀▀▀▀██▀▀▀▀▀███▀█▄▀▀▒▒▒▒      ██▒▒▒▒▄▄█▀▒▒▒▒▄▄█▀▀▄██▀▒▒▒",
  "        ▄██▀▒▒▒▒     ▒▒▄▄█ ▄▄▄▀██ ▄▄▄▀▀▀▄  ▄██▀▒▒▒▒▄██▀▀▀▒▄▄███         ▒▒ ▄███▄▄▄█▀▀▀▒▒▄██▀▒▒▒",
  "       ██▀▒▒▒     ▄▄▄███▀▄██▀▀▀▄▄██▀▀▄█▀▄▄██▀▒▒▒▄▄██▀▒▒▄██▀▀▀▄▄▀▀▀▀▀▀▀▀▀ ▄█▀▀▒▒▒▒▒▒▒▒▒▄██▒▒▒▒",
  "       ▀█▄▄▄▄▄▀▀▀█▄▄███▄▒▀▀▀▀▀▀▒▀▀▒▒▀▀▀▀▒██▄▄▀▀▀ ▀█▄▀▀▀ ▀▀▀▀▀▒▒▒▒▒▒▒▒▒▒▄██▀▒▒▒       ███▒▒",
  "        ▒▄▄▄█▀▀▀█▄█▀▀▒▒▒▒ ▒▒▒▒▒▒ ▒▒  ▒▒▒▒ ▒▒▒▒▒▒▒ ▒▒▒▒▒▒ ▒▒▒▒▒        ▀▀▀▒▒▒          ▒▒▒",
  "     ▄▄▀▀ ▒▒▒▒▄██▀▒▒▒▒                                                 ▒▒▒",
  "   ▄█ ▒▒▒▄▄██▀▀▒▒▒▒",
  "    ▀▀▀▀▀▀▒▒▒▒▒▒",
  "     ▒▒▒▒▒▒",
];

const ROSE_LARGE_RAW = [
  "             ⣠⣾⣷⣶⣦⣤⣤⣄⣠⣄⣀  ⢀⣀⣀",
  "          ⢀⣴⣿⣿⠿⣋⣭⣭⣯⣭⣍⣭⣿⣟⠛⠛⠿⣿⣷⣄",
  "      ⢀⣴⣾⡟⢻⣿⡟⠁⣼⣿⠏⣵⢻⣿⣻⣿⣿⢿⡻⣿⣿⣶⡌⢿⣿⣷⣦⣤⡄",
  "   ⣤⣶⣾⣿⣿⠏ ⠈⢿⣄ ⢹⣏⠠⠟⣾⣿⣿⣿⣿⣿⠷⣏⣼⠟⢡⣿⡟⠋⢻⣿⣿⡄",
  "   ⠈⣿⣿⣿⣿⡆   ⣽⢧⡘⠈⠳⣦⣍⠛⠛⢦⣉⣴⣛⣫⣭⣴⡟⠋  ⣾⣿⣿⡿",
  "   ⢀⠹⣿⣿⣿⣷⣤⡄ ⠋ ⠙⢆ ⣠⠴⠟⠛⣛⣛⣛⠟⠋⠁⠺⡇ ⣀⣴⣿⣿⡟⠁",
  "   ⠈⣀⠈⠛⠷⠿⣿⣿⣷⣤⣀ ⢠⠋   ⠈⠉⠉    ⣠⣴⣥⠾⠛⠉⣰⣿⣷",
  "          ⠹⣯⣝⠛⠛⠷⢶⣤⣤⣀   ⢀⡠⠖⠋⠉⢉⣀⣀⣴⣾⣿⠿⠟⠃",
  "             ⠘⠻⢿⣦⣄⡀  ⠉⠛⢦⠠⢊⠤⠴⢒⣛⣛⣩⣽⡿⠟⠁",
  "        ⠶⢶⣤⣄⡀⠨⠭⠽⠟⣓⢦⣀⠈⢇⡥⠖⠛⠋⠉⠉",
  "           ⠈⢷ ⠐⠂⢤⣽⣄ ⠰⡎⠙⠳⣄⡀ ⠈⢣⠘⢦⠋",
  "            ⠈⢳⣀⡒⠉⠉⣉⠙⡲⣽⣄ ⣏⠳⡄ ⠘⡇ ⡾⠁",
  "              ⠛⠻⢦⣄⣉⡁⣀⣀⣈⣙⣺⣌⡇⢠⢀⡇⡾",
  "                   ⠈⠉    ⠈⠳⡄⣸⢱⠇",
  "                           ⡷⠡⡯⢖⠉",
  "                        ⢀⡴⢪⠔⣉⠔⠋",
  "                           ⠐⠈",
];

function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function normalizeAscii(lines: string[]): string[] {
  const trimmed = lines.map((l) => l.replace(/\s+$/g, ""));
  const nonEmpty = trimmed.filter((l) => l.trim().length > 0);
  const minLead = nonEmpty.length
    ? Math.min(...nonEmpty.map((l) => (l.match(/^\s*/) || [""])[0].length))
    : 0;
  return trimmed.map((l) => (l.length >= minLead ? l.slice(minLead) : l));
}

function padLines(lines: string[]): { lines: string[]; width: number } {
  const width = Math.max(...lines.map((l) => l.length), 0);
  return { lines: lines.map((l) => l.padEnd(width)), width };
}

type CellType =
  | "banner"
  | "logo-tip"
  | "logo-tip2"
  | "logo-fresh"
  | "logo-fresh2"
  | "logo-warm"
  | "logo-ink"
  | "rose"
  | "label"
  | "value"
  | "dim"
  | "accent"
  | "none";
type LayoutCell = { char: string; type: CellType };

type Span = { start: number; end: number };

function computeLogoBounds(lines: string[]): Span {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== " ") {
        if (i < start) start = i;
        if (i > end) end = i;
      }
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: 0, end: 0 };
  return { start, end };
}

function buildLetterSpans(bounds: Span, weights: number[]): Span[] {
  const spanWidth = Math.max(1, bounds.end - bounds.start + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = bounds.start;
  return weights.map((w, i) => {
    const remaining = bounds.end - cursor + 1;
    const raw = Math.max(1, Math.round((w / total) * spanWidth));
    const width = i === weights.length - 1 ? remaining : Math.min(raw, remaining - (weights.length - i - 1));
    const s = cursor;
    const e = s + width - 1;
    cursor = e + 1;
    return { start: s, end: e };
  });
}

const LOGO_BOUNDS = computeLogoBounds(TEXT_LOGO);
const LETTER_WEIGHTS = [14, 10, 11, 10, 9, 11, 6, 13, 12]; // G E N T L E - P I
const LETTER_SPANS = buildLetterSpans(LOGO_BOUNDS, LETTER_WEIGHTS);

function letterIndexAtX(x: number): number {
  for (let i = 0; i < LETTER_SPANS.length; i++) {
    const s = LETTER_SPANS[i];
    if (x >= s.start && x <= s.end) return i;
  }
  if (x < LETTER_SPANS[0].start) return 0;
  return LETTER_SPANS.length - 1;
}

type Point = { x: number; y: number };

function pointKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function buildLetterStrokeMap(letterIdx: number): { orderMap: Map<string, number>; maxOrder: number } {
  const span = LETTER_SPANS[letterIdx];
  const points: Point[] = [];
  const pointSet = new Set<string>();

  for (let y = 0; y < TEXT_LOGO.length; y++) {
    const line = TEXT_LOGO[y] ?? "";
    for (let x = span.start; x <= Math.min(span.end, line.length - 1); x++) {
      if (line[x] !== " ") {
        points.push({ x, y });
        pointSet.add(pointKey(x, y));
      }
    }
  }

  const neighbors8 = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ] as const;

  const visited = new Set<string>();
  const components: Point[][] = [];

  for (const p of points) {
    const k = pointKey(p.x, p.y);
    if (visited.has(k)) continue;

    const stack = [p];
    const comp: Point[] = [];
    visited.add(k);

    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const [dx, dy] of neighbors8) {
        const nk = pointKey(cur.x + dx, cur.y + dy);
        if (!visited.has(nk) && pointSet.has(nk)) {
          visited.add(nk);
          stack.push({ x: cur.x + dx, y: cur.y + dy });
        }
      }
    }

    components.push(comp);
  }

  components.sort((a, b) => {
    const ax = Math.min(...a.map((p) => p.x));
    const bx = Math.min(...b.map((p) => p.x));
    if (ax !== bx) return ax - bx;
    const ay = Math.min(...a.map((p) => p.y));
    const by = Math.min(...b.map((p) => p.y));
    return ay - by;
  });

  const orderMap = new Map<string, number>();
  let order = 0;

  for (const comp of components) {
    const compSet = new Set(comp.map((p) => pointKey(p.x, p.y)));
    const compMap = new Map(comp.map((p) => [pointKey(p.x, p.y), p]));

    let current = comp.reduce((best, p) =>
      p.x < best.x || (p.x === best.x && p.y < best.y) ? p : best,
    );

    let dirX = 1;
    let dirY = 0;

    while (compSet.size > 0) {
      const ck = pointKey(current.x, current.y);
      if (compSet.has(ck)) {
        compSet.delete(ck);
        orderMap.set(ck, order++);
      }
      if (compSet.size === 0) break;

      const candidates: Point[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nk = pointKey(current.x + dx, current.y + dy);
          if (compSet.has(nk)) {
            const point = compMap.get(nk);
            if (point) candidates.push(point);
          }
        }
      }

      let next: Point | null = null;
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const adx = a.x - current.x;
          const ady = a.y - current.y;
          const bdx = b.x - current.x;
          const bdy = b.y - current.y;

          const aDist = Math.hypot(adx, ady);
          const bDist = Math.hypot(bdx, bdy);
          const aTurn = Math.abs(adx * dirY - ady * dirX);
          const bTurn = Math.abs(bdx * dirY - bdy * dirX);

          const aScore = aDist * 3.8 + aTurn * 1.3 + Math.abs(ady) * 0.12;
          const bScore = bDist * 3.8 + bTurn * 1.3 + Math.abs(bdy) * 0.12;
          return aScore - bScore;
        });
        next = candidates[0];
      } else {
        let best: Point | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const k of compSet) {
          const p = compMap.get(k);
          if (!p) continue;
          const dx = p.x - current.x;
          const dy = p.y - current.y;
          const score = Math.hypot(dx, dy) + Math.abs(dy) * 0.16;
          if (score < bestScore) {
            bestScore = score;
            best = p;
          }
        }
        next = best;
      }

      if (!next) break;
      dirX = next.x - current.x;
      dirY = next.y - current.y;
      current = next;
    }
  }

  return { orderMap, maxOrder: Math.max(1, order - 1) };
}

const LETTER_STROKES = LETTER_SPANS.map((_, i) => buildLetterStrokeMap(i));
const WRITING_START_TICK = 10;
const LETTER_TICKS = LETTER_STROKES.map((s) => Math.max(5, Math.ceil(((s.maxOrder + 8) / 11) * 0.3)));
// Micro-pausa visual entre letras: 1 tick de reposo entre cada stroke.
const PAUSE_TICKS = 1;
const LETTER_START_TICKS = LETTER_TICKS.map((_, i) =>
  WRITING_START_TICK + LETTER_TICKS.slice(0, i).reduce((a, b) => a + b + PAUSE_TICKS, 0),
);
const WRITING_END_TICK = WRITING_START_TICK + LETTER_TICKS.reduce((a, b) => a + b + PAUSE_TICKS, 0);

function buildPenLogoLine(
  line: string,
  rowIdx: number,
  _totalRows: number,
  tick: number,
): LayoutCell[] {
  const out: LayoutCell[] = [];

  for (let x = 0; x < line.length; x++) {
    const ch = line[x] ?? " ";
    if (ch === " ") {
      out.push({ char: " ", type: "none" });
      continue;
    }

    const letterIdx = letterIndexAtX(x);
    const stroke = LETTER_STROKES[letterIdx];
    const startTick = LETTER_START_TICKS[letterIdx];
    const duration = LETTER_TICKS[letterIdx];
    const progress = (tick - startTick) / Math.max(1, duration);

    if (progress < 0) {
      out.push({ char: " ", type: "none" });
      continue;
    }

    const head = progress * (stroke.maxOrder + 7);
    const rawOrder = stroke.orderMap.get(pointKey(x, rowIdx));
    if (rawOrder === undefined) {
      out.push({ char: " ", type: "none" });
      continue;
    }

    let order = rawOrder;
    // v1: ajuste SOLO para la primera letra (G), con más curvatura caligráfica.
    if (letterIdx === 0) {
      const s = LETTER_SPANS[0];
      const w = Math.max(1, s.end - s.start + 1);
      const localX = x - s.start;
      const curveBias =
        Math.sin((localX / w) * Math.PI * 1.35 + rowIdx * 0.26) * 2.2 +
        Math.cos((localX / w) * Math.PI * 0.72 - rowIdx * 0.20) * 1.3;
      order = rawOrder + curveBias;
    }

    if (head < order) {
      out.push({ char: " ", type: "none" });
      continue;
    }

    const age = head - order;
    if (age < 0.6) {
      out.push({ char: ch, type: "logo-tip" });
    } else if (age < 1.8) {
      out.push({ char: ch, type: "logo-tip2" });
    } else if (age < 4.0) {
      out.push({ char: ch, type: "logo-fresh" });
    } else if (age < 7.0) {
      out.push({ char: ch, type: "logo-fresh2" });
    } else if (age < 11.0) {
      out.push({ char: ch, type: "logo-warm" });
    } else {
      out.push({ char: ch, type: "logo-ink" });
    }
  }
  return out;
}

class LayoutBuilder {
  lines: LayoutCell[][] = [];

  addRow() {
    this.lines.push([]);
  }

  add(type: CellType, text: string) {
    const row = this.lines[this.lines.length - 1];
    for (const char of text) row.push({ char, type });
  }

  center(width: number) {
    const row = this.lines[this.lines.length - 1];
    const pad = Math.max(0, Math.floor((width - row.length) / 2));
    const prefix = Array.from({ length: pad }, () => ({
      char: " ",
      type: "none" as const,
    }));
    this.lines[this.lines.length - 1] = prefix.concat(row);
  }
}

export default function (pi: ExtensionAPI) {
  const settingsPath = join(os.homedir(), ".pi", "agent", "settings.json");

  const readStartupAnimation = async (): Promise<boolean> => {
    try {
      const raw = await readFile(settingsPath, "utf8");
      const cfg = JSON.parse(raw);
      return cfg.startupAnimation !== false;
    } catch {
      return true;
    }
  };

  const writeStartupAnimation = async (enabled: boolean): Promise<void> => {
    const raw = await readFile(settingsPath, "utf8");
    const cfg = JSON.parse(raw);
    cfg.startupAnimation = enabled;
    await writeFile(settingsPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  };

  pi.registerCommand("intro", {
    description: "Toggle startup animation. Usage: /intro on | /intro off",
    getArgumentCompletions: (prefix) => {
      const vals = ["on", "off"];
      return vals
        .filter((v) => v.startsWith((prefix || "").toLowerCase()))
        .map((v) => ({ value: v, label: v }));
    },
    handler: async (args, ctx) => {
      const arg = String(args || "").trim().toLowerCase();
      if (arg !== "on" && arg !== "off") {
        ctx.ui.notify("Use: /intro on | /intro off", "info");
        return;
      }
      await writeStartupAnimation(arg === "on");
      ctx.ui.notify(
        arg === "on"
          ? "Intro: ON (next startup)"
          : "Intro: OFF (next startup)",
        "info",
      );
    },
  });

  const toggleIntro = async (ctx: any) => {
    const current = await readStartupAnimation();
    const next = !current;
    await writeStartupAnimation(next);
    ctx.ui.notify(
      next ? "Intro: ON (next startup)" : "Intro: OFF (next startup)",
      "info",
    );
  };

  const registerShortcut = (pi as any).registerShortcut;
  if (typeof registerShortcut === "function") {
    registerShortcut.call(pi, "f1", {
      description: "Toggle startup animation",
      handler: toggleIntro,
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // En modo de prueba con `-e <archivo.ts>` sí queremos mostrar la intro,
    // así que no filtramos por argv en esta versión.

    const startupAnimation = await readStartupAnimation();

    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

    const roseBase = padLines(normalizeAscii(ROSE_LARGE_RAW));
    const logoBase = padLines(TEXT_LOGO);

    let gitBranch = "Not a git repo";
    let mcpServersCount = 0;
    let extensionFilesCount = 0;
    let packagesCount = 0;
    let sddAgentCount = 0;
    let skillCommandCount = 0;

    const allCommands = pi.getCommands();
    skillCommandCount = allCommands.filter((c) => c.source === "skill").length;
    const allTools = pi.getAllTools();
    const customTools = allTools.filter(
      (t) => !["builtin", "sdk"].includes(t.sourceInfo.source),
    );

    setTimeout(() => {
      execAsync(`git -C "${ctx.cwd}" branch --show-current`)
        .then(({ stdout }) => {
          const b = stdout.trim();
          gitBranch = b ? `On branch ${b}` : "Detached HEAD";
        })
        .catch(() => {});
    }, 100);

    setTimeout(() => {
      (async () => {
        try {
          const raw = await readFile(
            join(os.homedir(), ".pi", "agent", "mcp.json"),
            "utf8",
          );
          const cfg = JSON.parse(raw);
          mcpServersCount = Object.keys(cfg.mcpServers || {}).length;
        } catch {
          mcpServersCount = 0;
        }
      })();
    }, 150);

    // Count SDD agent files from the agents directory
    const countSddAgents = async (): Promise<number> => {
      try {
        const entries = await readdir(join(PI_AGENT_DIR, "agents"), { withFileTypes: true });
        return entries.filter((e) => e.isFile() && e.name.startsWith("sdd-") && e.name.endsWith(".md")).length;
      } catch { return 0; }
    };

    // Count real extension files from installed packages
    const countPackageExtensions = async (): Promise<number> => {
      let count = 0;
      try {
        const settingsRaw = await readFile(join(PI_AGENT_DIR, "settings.json"), "utf8");
        const cfg = JSON.parse(settingsRaw);
        packagesCount = Array.isArray(cfg.packages) ? cfg.packages.length : 0;

        if (!Array.isArray(cfg.packages)) return 0;

        for (const pkg of cfg.packages) {
          let pkgJsonPath: string | null = null;

          if (typeof pkg === "string" && pkg.startsWith("npm:")) {
            const name = pkg.slice("npm:".length);
            const candidate = join(PI_NPM_DIR, name, "package.json");
            if (existsSync(candidate)) {
              pkgJsonPath = candidate;
            }
          } else if (typeof pkg === "string" && (pkg.startsWith("git:") || pkg.startsWith("https://") || pkg.startsWith("http://"))) {
            // git/https packages: extract path under PI_GIT_DIR
            const url = pkg.replace(/^git:/, "https:").replace(/\.git$/, "");
            const urlObj = new URL(url);
            const host = urlObj.hostname;
            const pathParts = urlObj.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");
            // Try: git/{host}/{org}/{repo}/package.json, git/{host}/{org}/{repo}/, etc.
            const domainDir = join(PI_GIT_DIR, host);
            if (existsSync(domainDir)) {
              for (let depth = pathParts.length; depth >= 2; depth--) {
                const sub = pathParts.slice(0, depth).join("/");
                const candidate = join(PI_GIT_DIR, host, sub, "package.json");
                if (existsSync(candidate)) { pkgJsonPath = candidate; break; }
              }
            }
          }

          if (pkgJsonPath) {
            try {
              const pkgRaw = await readFile(pkgJsonPath, "utf8");
              const pkgJson = JSON.parse(pkgRaw);
              const exts = pkgJson.pi?.extensions;
              if (Array.isArray(exts)) {
                count += exts.length;
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
      return count;
    };

    setTimeout(() => {
      (async () => {
        const [extCount, sddCount] = await Promise.all([
          countPackageExtensions(),
          countSddAgents(),
        ]);
        extensionFilesCount = extCount;
        sddAgentCount = sddCount;
      })();
    }, 200);

    let tick = startupAnimation ? 0 : WRITING_END_TICK + 25;
    const state = { timer: null as NodeJS.Timeout | null };

    setTimeout(() => {
      ctx.ui.setHeader((tui, theme) => {
        if (state.timer) clearInterval(state.timer);

        if (startupAnimation) {
          state.timer = setInterval(() => {
            tick++;
            if (tick > WRITING_END_TICK + 25) {
              if (state.timer) {
                clearInterval(state.timer);
                state.timer = null;
              }
              return;
            }
            try {
              tui.requestRender();
            } catch {
              if (state.timer) {
                clearInterval(state.timer);
                state.timer = null;
              }
            }
          }, 25);
        }

        return {
          render(width: number): string[] {
            const flashStartTick = 16;
            const roseOpacity = Math.min(1, tick / 16);
            const flashPhase =
              tick >= flashStartTick
                ? Math.max(0, 1 - (tick - flashStartTick) / 20)
                : 0;
            const frame = Math.floor(tick / 2);

            const sideBySideMinWidth = roseBase.width + 3 + logoBase.width + 4;
            const wideStatsMinWidth = 122;
            const horizontal = width >= sideBySideMinWidth;
            const wideStats = width >= wideStatsMinWidth;

            const b = new LayoutBuilder();
            b.addRow();
            b.center(width);

            if (horizontal) {
              const rowCount = Math.max(
                roseBase.lines.length,
                logoBase.lines.length,
              );
              const roseOffset = Math.max(
                0,
                Math.floor((rowCount - roseBase.lines.length) / 2),
              );
              const logoOffset = Math.max(
                0,
                Math.floor((rowCount - logoBase.lines.length) / 2),
              );

              for (let i = 0; i < rowCount; i++) {
                const roseI = i - roseOffset;
                const logoI = i - logoOffset;
                const roseLine =
                  roseI >= 0 && roseI < roseBase.lines.length
                    ? roseBase.lines[roseI]
                    : " ".repeat(roseBase.width);
                const logoLine =
                  logoI >= 0 && logoI < logoBase.lines.length
                    ? logoBase.lines[logoI]
                    : " ".repeat(logoBase.width);

                b.addRow();
                b.add("rose", roseLine);
                b.add("none", "   ");
                if (logoI >= 0 && logoI < logoBase.lines.length) {
                  b.lines[b.lines.length - 1].push(
                    ...buildPenLogoLine(
                      logoLine,
                      logoI,
                      logoBase.lines.length,
                      tick,
                    ),
                  );
                } else {
                  b.add("none", " ".repeat(logoBase.width));
                }
                b.center(width);
              }
            } else {
              const showBanner = width >= logoBase.width + 2;
              const showRose = width >= roseBase.width + 2;
              if (showBanner) {
                for (let logoI = 0; logoI < logoBase.lines.length; logoI++) {
                  const logoLine = logoBase.lines[logoI];
                  b.addRow();
                  b.lines[b.lines.length - 1].push(
                    ...buildPenLogoLine(
                      logoLine,
                      logoI,
                      logoBase.lines.length,
                      tick,
                    ),
                  );
                  b.center(width);
                }
                if (showRose) {
                  b.addRow();
                  b.center(width);
                }
              }
              if (showRose) {
                for (const roseLine of roseBase.lines) {
                  b.addRow();
                  b.add("rose", roseLine);
                  b.center(width);
                }
              }
            }

            b.addRow();
            b.center(width);

            const fit = (v: unknown, w: number) =>
              String(v ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, w)
                .padEnd(w);
            const addWideRow = (
              l1: string,
              v1: string,
              l2: string,
              v2: string,
            ) => {
              b.addRow();
              b.add("label", fit(l1, 10));
              b.add("none", " ");
              b.add("value", fit(v1, 48));
              b.add("none", "   ");
              b.add("label", fit(l2, 12));
              b.add("none", " ");
              b.add("value", fit(v2, 46));
              b.center(width);
            };
            const narrowRows: Array<[string, string]> = [
              ["PATH:", ctx.cwd],
              ["GIT:", gitBranch],
              ["MCP:", `${mcpServersCount} server(s)`],
              ["PLUGINS:", `${packagesCount} package(s)`],
              ["AGENTS:", `${sddAgentCount} phases`],
              ["VER:", `v${VERSION}`],
              ["EXTENSIONS:", `${extensionFilesCount} active`],
              ["SKILLS:", `${skillCommandCount} loaded`],
              ["TOOLS:", `${customTools.length} custom`],
            ];
            const narrowLabelW = Math.max(...narrowRows.map(([l]) => l.length));
            const narrowValueW = Math.max(
              0,
              Math.min(
                Math.max(...narrowRows.map(([, v]) => v.length)),
                Math.max(8, width - narrowLabelW - 4),
              ),
            );
            const addNarrowRow = (label: string, value: string) => {
              b.addRow();
              b.add("label", label.padEnd(narrowLabelW));
              b.add("none", "  ");
              b.add("value", fit(value, narrowValueW));
              b.center(width);
            };

            if (wideStats) {
              addWideRow("PATH:", ctx.cwd, "EXTENSIONS:", `${extensionFilesCount} active`);
              addWideRow(
                "GIT:",
                gitBranch,
                "PLUGINS:",
                `${packagesCount} package(s)`,
              );
              addWideRow(
                "MCP:",
                `${mcpServersCount} server(s)`,
                "SKILLS:",
                `${skillCommandCount} loaded`,
              );
              addWideRow(
                "AGENTS:",
                `${sddAgentCount} phases`,
                "TOOLS:",
                `${customTools.length} custom`,
              );
              addWideRow("VER:", `v${VERSION}`, "", "");
            } else {
              addNarrowRow("PATH:", ctx.cwd);
              addNarrowRow("GIT:", gitBranch);
              addNarrowRow("MCP:", `${mcpServersCount} server(s)`);
              addNarrowRow("PLUGINS:", `${packagesCount} package(s)`);
              addNarrowRow("AGENTS:", `${sddAgentCount} phases`);
              addNarrowRow("VER:", `v${VERSION}`);
              addNarrowRow("EXTENSIONS:", `${extensionFilesCount} active`);
              addNarrowRow("SKILLS:", `${skillCommandCount} loaded`);
              addNarrowRow("TOOLS:", `${customTools.length} custom`);
            }

            b.addRow();
            b.center(width);

            const out: string[] = [];
            const layout = b.lines;

            const logoTypes = new Set(["banner", "logo-tip", "logo-tip2", "logo-fresh", "logo-fresh2", "logo-warm", "logo-ink"] as const);
            const logoRows = layout
              .map((row, idx) => ({ idx, hasLogo: (row || []).some((c) => logoTypes.has(c.type as any)) }))
              .filter((r) => r.hasLogo)
              .map((r) => r.idx);
            const sparkleY = logoRows.length > 0 ? logoRows[Math.floor(logoRows.length / 2)] : -1;
            const logoLastX = Math.max(
              -1,
              ...layout.map((row) => {
                let last = -1;
                for (let i = 0; i < (row || []).length; i++) {
                  if (logoTypes.has((row?.[i]?.type as any) ?? "none") && (row?.[i]?.char ?? " ") !== " ") {
                    last = i;
                  }
                }
                return last;
              }),
            );

            const glintStartTick = WRITING_END_TICK + 4;
            const glintEndTick = WRITING_END_TICK + 18;
            const glintActive = tick >= glintStartTick && tick <= glintEndTick;
            const glintHead = ((tick - glintStartTick) / Math.max(1, glintEndTick - glintStartTick)) * (LOGO_BOUNDS.end - LOGO_BOUNDS.start + 1);
            // Estrella en la punta de la I (ultima letra del logo GENTLE-PI)
            const sparkleActive = tick >= WRITING_END_TICK + 19 && tick <= WRITING_END_TICK + 25;
            const sparkleTick = tick - (WRITING_END_TICK + 19);

            // Encontrar la celda mas a la derecha del logo (punta de la I)
            let starCX = -1, starCY = 0;
            if (sparkleActive) {
              for (let y = 0; y < layout.length; y++) {
                const row = layout[y] || [];
                for (let x = row.length - 1; x >= 0; x--) {
                  const c = row[x];
                  if (c && c.char !== " " && logoTypes.has(c.type as any)) {
                    if (x > starCX) { starCX = x; starCY = y; }
                    break;
                  }
                }
              }
              // Asegurar espacio vertical: forzar starCY >= 2
              if (starCY < 2) starCY = 2;
              // Asegurar espacio horizontal
              const maxW = layout.length > 0 ? (layout[0] || []).length : 100;
              if (starCX + 3 >= maxW) starCX = maxW - 4;
            }

            const renderStarCell = (_x: number, _y: number): string | null => {
              return null;
            };

            for (let y = 0; y < layout.length; y++) {
              const row = layout[y] || [];
              const firstLogoX = row.findIndex((c) => logoTypes.has(c.type as any) && c.char !== " ");
              let line = "";

              for (let x = 0; x < row.length; x++) {
                const cell = row[x] || { char: " ", type: "none" as const };

                // Estrella check FIRST (antes del espacio)
                if (sparkleActive) {
                  const starResult = renderStarCell(x, y);
                  if (starResult) {
                    line += starResult;
                    continue;
                  }
                }

                if (cell.char === " ") {
                  line += " ";
                  continue;
                }

                if (cell.type === "rose") {
                  const pulse = 0.9 + Math.sin((x + y + frame) * 0.08) * 0.1;
                  const k = Math.max(0.01, roseOpacity * pulse);
                  const f = Math.pow(flashPhase, 0.4);

                  const rBase = Math.floor(255 * k);
                  const gBase = Math.floor(118 * k);
                  const bBase = Math.floor(195 * k);

                  if (f > 0.85) {
                    line += `\x1b[1m\x1b[38;2;255;255;255m${cell.char}\x1b[0m`;
                  } else {
                    const r = Math.floor(rBase + (255 - rBase) * f);
                    const g = Math.floor(gBase + (255 - gBase) * f);
                    const bColor = Math.floor(bBase + (255 - bBase) * f);
                    line += rgb(r, g, bColor, cell.char);
                  }
                  continue;
                }

                if (logoTypes.has(cell.type as any)) {
                  const localLogoX = firstLogoX >= 0 ? x - firstLogoX : x;
                  const glintOnCell = glintActive && localLogoX >= glintHead - 2 && localLogoX <= glintHead + 1;

                  if (glintOnCell) {
                    line += `\x1b[1m` + rgb(255, 220, 185, cell.char) + `\x1b[22m`;
                    continue;
                  }

                  if (cell.type === "logo-tip" || cell.type === "logo-tip2") {
                    const glow = cell.type === "logo-tip" ? 245 : 225;
                    line += `\x1b[1m` + rgb(255, glow, 238, cell.char) + `\x1b[22m`;
                  } else if (cell.type === "logo-fresh" || cell.type === "logo-fresh2") {
                    const r = cell.type === "logo-fresh" ? 255 : 230;
                    const g = cell.type === "logo-fresh" ? 138 : 118;
                    const b = cell.type === "logo-fresh" ? 206 : 178;
                    line += cell.char === "▒"
                      ? rgb(110, 36, 70, cell.char)
                      : rgb(r, g, b, cell.char);
                  } else if (cell.type === "logo-warm") {
                    line += cell.char === "▒"
                      ? rgb(125, 40, 76, cell.char)
                      : rgb(245, 128, 196, cell.char);
                  } else {
                    line += cell.char === "▒"
                      ? rgb(95, 30, 60, cell.char)
                      : rgb(255, 120, 198, cell.char);
                  }
                  continue;
                }

                switch (cell.type) {
                  case "label":
                    line += rgb(200, 100, 160, cell.char);
                    break;
                  case "value":
                    line += rgb(255, 140, 210, cell.char);
                    break;
                  case "dim":
                    line += theme.fg("dim", cell.char);
                    break;
                  case "accent":
                    line += theme.fg("accent", cell.char);
                    break;
                  default:
                    line += cell.char;
                }
              }

              out.push(truncateToWidth(line, Math.max(1, width), ""));
            }

            return out;
          },
          invalidate() {
            if (state.timer) {
              clearInterval(state.timer);
              state.timer = null;
            }
          },
        };
      });
    }, 0);
  });
}
