import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { readSidebarBannerConfig, renderSidebarBanner } from "../lib/shell-sidebar-banner.ts";

const plain = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
test("compact rose and wordmark fit rail widths without cropping", () => {
	for (const width of [0, 1, 8, 20, 30, 46, 80]) {
		const lines = renderSidebarBanner(plain, width, { showRose: true, showTextLogo: true });
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
		if (width >= 30) {
			assert.match(lines.join("\n"), /GENTLE PI/);
			assert.match(lines.join("\n"), /[\u2800-\u28ff]/);
			assert.ok(lines.length <= 10);
		}
	}
});

test("rose and wordmark opt-outs remain independent and leave no empty artwork", () => {
	for (const showRose of [false, true]) for (const showTextLogo of [false, true]) {
		const text = renderSidebarBanner(plain, 46, { showRose, showTextLogo }).join("\n");
		assert.equal(text.includes("GENTLE PI"), showTextLogo);
		assert.equal(/[\u2800-\u28ff]/.test(text), showRose);
		if (!showRose && !showTextLogo) assert.equal(text, "");
	}
});

test("banner paints fresh semantic accent and text roles on each render", () => {
	let palette = "dark";
	const theme = { ...plain, fg: (role: string, text: string) => `<${palette}:${role}>${text}` };
	assert.match(renderSidebarBanner(theme, 46).join("\n"), /dark:accent/);
	palette = "light";
	const text = renderSidebarBanner(theme, 46).join("\n");
	assert.match(text, /light:accent/);
	assert.match(text, /light:text/);
	assert.doesNotMatch(text, /dark:/);
});

test("saved visibility wins; missing and malformed configuration use defaults", async () => {
	assert.deepEqual(await readSidebarBannerConfig(async () => '{"showRose":false,"showTextLogo":true,"color":"cyan"}'), { showRose: false, showTextLogo: true });
	for (const raw of ["{}", "null", "[]", "invalid"]) {
		assert.deepEqual(await readSidebarBannerConfig(async () => raw), { showRose: true, showTextLogo: true });
	}
	assert.deepEqual(await readSidebarBannerConfig(async () => { throw new Error("missing"); }), { showRose: true, showTextLogo: true });
});
