import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const execAsync = promisify(exec);

const TEXT_LOGO = [
  "  ██████╗ ███████╗███╗   ██╗████████╗██╗     ███████╗      ██████╗ ██╗",
  " ██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║     ██╔════╝      ██╔══██╗██║",
  " ██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║     █████╗  █████╗██████╔╝██║",
  " ██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║     ██╔══╝  ╚════╝██╔═══╝ ██║",
  " ╚██████╔╝███████╗██║ ╚████║   ██║   ███████╗███████╗      ██║     ██║",
  "  ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝      ╚═╝     ╚═╝",
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

type CellType = "banner" | "rose" | "label" | "value" | "dim" | "accent" | "none";
type LayoutCell = { char: string; type: CellType };

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
    const prefix = Array.from({ length: pad }, () => ({ char: " ", type: "none" as const }));
    this.lines[this.lines.length - 1] = prefix.concat(row);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // Si se está ejecutando un comando de CLI como "pi update" o "pi install", no mostramos la intro animada.
    const isCLICommand = process.argv.length > 2 && !process.argv.every(arg => arg.startsWith('-') || arg.endsWith('.ts'));
    if (isCLICommand) return;

    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

    let closeIntro: (() => void) | null = null;
    const closeIntroSafely = () => {
      if (!closeIntro) return;
      const fn = closeIntro;
      closeIntro = null;
      try { fn(); } catch {}
    };

    void ctx.ui.custom((_tui, _theme, _keybindings, done) => {
      closeIntro = () => done(undefined);
      return {
        render: () => [""],
        invalidate: () => {},
        handleInput: () => {},
      };
    }).catch(() => { closeIntro = null; });

    const roseBase = padLines(normalizeAscii(ROSE_LARGE_RAW));
    const logoBase = padLines(TEXT_LOGO);

    let gitBranch = "Not a git repo";
    let mcpServersCount = 0;
    let extensionsCount = 0;
    let packagesCount = 0;

    const allCommands = pi.getCommands();
    const skills = allCommands.filter((c) => c.source === "skill");
    const allTools = pi.getAllTools();
    const customTools = allTools.filter((t) => !["builtin", "sdk"].includes(t.sourceInfo.source));

    setTimeout(() => {
      execAsync(`git -C "${ctx.cwd}" branch --show-current`).then(({ stdout }) => {
        const b = stdout.trim();
        gitBranch = b ? `On branch ${b}` : "Detached HEAD";
      }).catch(() => {});
    }, 100);

    setTimeout(() => {
      (async () => {
        try {
          const raw = await readFile(join(os.homedir(), ".pi", "agent", "mcp.json"), "utf8");
          const cfg = JSON.parse(raw);
          mcpServersCount = Object.keys(cfg.mcpServers || {}).length;
        } catch {
          mcpServersCount = 0;
        }
      })();
    }, 150);

    setTimeout(() => {
      (async () => {
        try {
          const raw = await readFile(join(os.homedir(), ".pi", "agent", "settings.json"), "utf8");
          const cfg = JSON.parse(raw);
          extensionsCount = Array.isArray(cfg.extensions) ? cfg.extensions.length : 0;
          packagesCount = Array.isArray(cfg.packages) ? cfg.packages.length : 0;
        } catch {
          extensionsCount = 0;
          packagesCount = 0;
        }
      })();
    }, 200);

    let tick = 0;
    const state = { timer: null as NodeJS.Timeout | null };

    setTimeout(() => {
      ctx.ui.setHeader((tui, theme) => {
        if (state.timer) clearInterval(state.timer);

        state.timer = setInterval(() => {
          tick++;
          if (tick > 90) {
            if (state.timer) {
              clearInterval(state.timer);
              state.timer = null;
            }
            closeIntroSafely();
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
        }, 50);

        return {
          render(width: number): string[] {
            const flashStartTick = 16;
            const roseOpacity = Math.min(1, tick / 16);
            const flashPhase = tick >= flashStartTick ? Math.max(0, 1 - (tick - flashStartTick) / 20) : 0;
            const frame = Math.floor(tick / 2);

            const b = new LayoutBuilder();
            b.addRow();
            b.center(width);

            const rowCount = roseBase.lines.length;
            const logoOffset = Math.max(0, Math.floor((rowCount - logoBase.lines.length) / 2));

            for (let i = 0; i < rowCount; i++) {
              const roseLine = roseBase.lines[i] || " ".repeat(roseBase.width);
              const logoLine = i >= logoOffset && i < logoOffset + logoBase.lines.length
                ? logoBase.lines[i - logoOffset]
                : " ".repeat(logoBase.width);

              b.addRow();
              b.add("rose", roseLine);
              b.add("none", "   ");
              b.add("banner", logoLine);
              b.center(width);
            }

            b.addRow();
            b.center(width);

            const fit = (v: any, w: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, w).padEnd(w);
            const addSysRow = (l1: string, v1: string, l2: string, v2: string) => {
              b.addRow();
              b.add("label", fit(l1, 10)); b.add("none", " "); b.add("value", fit(v1, 48));
              b.add("none", "   ");
              b.add("label", fit(l2, 12)); b.add("none", " "); b.add("value", fit(v2, 46));
              b.center(width);
            };

            addSysRow("GIT:", gitBranch, "PATH:", ctx.cwd);
            addSysRow("MCP:", `${mcpServersCount} server(s)`, "PLUGINS:", `${packagesCount} package(s)`);
            addSysRow("AGENTS:", `${skills.length} loaded`, "EXTENSIONS:", `${extensionsCount} active`);
            addSysRow("VER:", `v${VERSION}`, "TOOLS:", `${customTools.length} custom`);

            b.addRow(); b.center(width);

            const out: string[] = [];
            const layout = b.lines;

            for (let y = 0; y < layout.length; y++) {
              const row = layout[y] || [];
              const firstBannerX = row.findIndex((c) => c.type === "banner" && c.char !== " ");
              let line = "";

              for (let x = 0; x < row.length; x++) {
                const cell = row[x] || { char: " ", type: "none" as const };
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

                if (cell.type === "banner") {
                  const localX = firstBannerX >= 0 ? x - firstBannerX : x;
                  const sweep = Math.floor((tick - 16) * 2.2);
                  const isFlashing = tick >= 16 && localX >= sweep - 4 && localX <= sweep + 2;
                  
                  if (isFlashing) {
                    line += `\x1b[1m\x1b[38;2;255;255;255m${cell.char}\x1b[0m`;
                  } else {
                    line += rgb(255, 120, 198, cell.char);
                  }
                  continue;
                }

                switch (cell.type) {
                  case "label": line += theme.fg("muted", cell.char); break;
                  case "value": line += theme.fg("text", cell.char); break;
                  case "dim": line += theme.fg("dim", cell.char); break;
                  case "accent": line += theme.fg("accent", cell.char); break;
                  default: line += cell.char;
                }
              }

              out.push(line);
            }

            return out;
          },
          invalidate() {
            if (state.timer) {
              clearInterval(state.timer);
              state.timer = null;
            }
            closeIntroSafely();
          },
        };
      });
    }, 50);
  });
}
