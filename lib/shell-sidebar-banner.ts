import { visibleWidth } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ShellBarTheme } from "./shell-bar.ts";

export interface SidebarBannerConfig { showRose: boolean; showTextLogo: boolean }
const DEFAULT = { showRose: true, showTextLogo: true };
export async function readSidebarBannerConfig(read = () => readFile(join(process.env.GENTLE_PI_CONFIG_HOME ?? join(homedir(), ".pi", "gentle-ai"), "banner.json"), "utf8")): Promise<SidebarBannerConfig> {
	try {
		const config = JSON.parse(await read());
		return {
			showRose: typeof config?.showRose === "boolean" ? config.showRose : true,
			showTextLogo: typeof config?.showTextLogo === "boolean" ? config.showTextLogo : true,
		};
	} catch { return { ...DEFAULT }; }
}

// The original startup rose, scaled as Braille dots rather than cropped cells.
const ROSE = [
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
const DOTS = [[1, 8], [2, 16], [4, 32], [64, 128]];
const compactRose = (() => {
	const cells = Array.from({ length: 9 }, () => Array<number>(24).fill(0));
	ROSE.forEach((line, row) => [...line].forEach((char, col) => {
		const bits = char.codePointAt(0)! - 0x2800;
		if (bits < 0 || bits > 255) return;
		DOTS.forEach((dots, y) => dots.forEach((bit, x) => {
			if (!(bits & bit)) return;
			const dx = Math.floor((col * 2 + x) / 2);
			const dy = Math.floor((row * 4 + y) / 2);
			cells[Math.floor(dy / 4)][Math.floor(dx / 2)] |= DOTS[dy % 4][dx % 2];
		}));
	}));
	return cells.map((row) => row.map((bits) => bits ? String.fromCodePoint(0x2800 + bits) : " ").join("").trimEnd());
})();

export function renderSidebarBanner(theme: ShellBarTheme, width: number, config: SidebarBannerConfig = DEFAULT): string[] {
	// Hide an element whole when it cannot fit; never truncate its identity.
	const rose = config.showRose && width >= 24 ? compactRose : [];
	const logo = config.showTextLogo && width >= 9 ? "GENTLE PI" : "";
	if (!rose.length) return logo ? [theme.fg("text", theme.bold(logo))] : [];
	const sideBySide = !!logo && width >= 36;
	const lines = rose.map((line, index) => {
		const painted = theme.fg("accent", line);
		return sideBySide && index === 3
			? painted + " ".repeat(27 - visibleWidth(line)) + theme.fg("text", theme.bold(logo))
			: painted;
	});
	return !sideBySide && logo ? [...lines, theme.fg("text", theme.bold(logo))] : lines;
}
