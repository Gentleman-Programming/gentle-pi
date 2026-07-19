import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, posix, resolve } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const snapshots = process.argv.slice(2);
if (snapshots.length === 0) snapshots.push("origin/main", "HEAD", "WORKTREE");

function git(args, encoding = "utf8") {
	return execFileSync("git", args, { cwd: root, encoding, maxBuffer: 64 * 1024 * 1024 });
}

function refFiles(ref) {
	return git(["ls-tree", "-r", "--name-only", "-z", ref])
		.split("\0")
		.filter(Boolean)
		.toSorted();
}

function worktreeFiles() {
	return git(["ls-files", "-co", "--exclude-standard", "-z"])
		.split("\0")
		.filter((path) => path.length > 0 && existsSync(resolve(root, path)))
		.toSorted();
}

function content(ref, path) {
	return ref === "WORKTREE"
		? readFileSync(resolve(root, path))
		: git(["show", `${ref}:${path}`], null);
}

function lines(bytes) {
	if (bytes.length === 0) return 0;
	let count = 0;
	for (const byte of bytes) if (byte === 10) count += 1;
	return count + (bytes.at(-1) === 10 ? 0 : 1);
}

function isSource(path) {
	return (
		((path.startsWith("extensions/") || path.startsWith("lib/")) && extname(path) === ".ts") ||
		((path.startsWith("runtime/") || path.startsWith("scripts/")) && extname(path) === ".mjs")
	);
}

function isTest(path) {
	return path.startsWith("tests/") && (extname(path) === ".ts" || extname(path) === ".mjs");
}

function packageIncludes(path, packageJson) {
	if (["package.json", "README.md", "LICENSE"].includes(path)) return true;
	return packageJson.files.some((entry) => entry.endsWith("/") ? path.startsWith(entry) : path === entry);
}

function localImportTargets(path, bytes) {
	const text = bytes.toString("utf8");
	const targets = [];
	const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
	for (const match of text.matchAll(pattern)) {
		const target = posix.normalize(posix.join(posix.dirname(path), match[1]));
		targets.push(target);
	}
	return targets;
}

function measure(ref) {
	const files = ref === "WORKTREE" ? worktreeFiles() : refFiles(ref);
	const packageJson = JSON.parse(content(ref, "package.json").toString("utf8"));
	const packageFiles = files.filter((path) => packageIncludes(path, packageJson));
	const sourceFiles = files.filter(isSource);
	const testFiles = files.filter(isTest);
	const allContent = new Map(files.map((path) => [path, content(ref, path)]));
	const imports = sourceFiles.flatMap((path) =>
		localImportTargets(path, allContent.get(path)).map((target) => ({ source: path, target })),
	);
	const reviewEdges = imports.filter(({ source, target }) =>
		posix.basename(source).startsWith("review-") || posix.basename(target).startsWith("review-"),
	);
	const permanent = ["lib/review-canonical.ts", "lib/review-repository.ts", "lib/review-candidate-view.ts", "lib/review-publication-gate.ts"];
	const permanentConsumers = Object.fromEntries(permanent.map((module) => [
		module,
		imports.filter(({ target }) => target === module).map(({ source }) => source).toSorted(),
	]));
	const originReviewModules = refFiles("origin/main").filter((path) => /^lib\/review-.*\.ts$/.test(path));
	const retiredReviewModules = originReviewModules.filter((path) => !files.includes(path));
	return {
		ref,
		commit: ref === "WORKTREE" ? git(["rev-parse", "HEAD"]).trim() : git(["rev-parse", ref]).trim(),
		package_payload: {
			files: packageFiles.length,
			bytes: packageFiles.reduce((total, path) => total + allContent.get(path).length, 0),
		},
		source: {
			files: sourceFiles.length,
			loc: sourceFiles.reduce((total, path) => total + lines(allContent.get(path)), 0),
		},
		tests: {
			files: testFiles.length,
			loc: testFiles.reduce((total, path) => total + lines(allContent.get(path)), 0),
		},
		dependency_surface: {
			local_import_edges: imports.length,
			review_import_edges: reviewEdges.length,
			permanent_module_consumers: permanentConsumers,
		},
		retired_review_modules: retiredReviewModules,
	};
}

console.log(JSON.stringify(snapshots.map(measure), null, 2));
