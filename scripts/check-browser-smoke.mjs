import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const webUiSourceEntry = join(root, "packages", "web-ui", "src", "index.ts");
const webUiDist = join(root, "packages", "web-ui", "dist");
const requiredFiles = ["index.js", "index.d.ts", "app.css"];
const nodeBuiltinImport = /(?:from|import)\s*[(]?\s*["']node:/;

const localSourceBrowserPlugin = {
	name: "local-source-browser-smoke",
	setup(buildContext) {
		buildContext.onResolve({ filter: /^node:/ }, (args) => ({
			errors: [{ text: `Browser source imports Node built-in ${args.path}` }],
		}));
		buildContext.onResolve({ filter: /^[^./]|^\.\.[^/]/ }, (args) => ({ path: args.path, external: true }));
	},
};

const bundleResult = await build({
	entryPoints: [webUiSourceEntry],
	bundle: true,
	write: false,
	platform: "browser",
	format: "esm",
	logLevel: "silent",
	plugins: [localSourceBrowserPlugin],
});

const bundledSource = bundleResult.outputFiles.map((file) => file.text).join("\n");

if (nodeBuiltinImport.test(bundledSource)) {
	throw new Error("Browser smoke failed: web-ui source bundle imports Node built-ins.");
}

for (const file of requiredFiles) {
	await access(join(webUiDist, file));
}

const entry = await readFile(join(webUiDist, "index.js"), "utf8");

if (nodeBuiltinImport.test(entry)) {
	throw new Error("Browser smoke failed: web-ui entry imports Node built-ins.");
}
