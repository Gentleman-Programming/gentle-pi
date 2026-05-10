import type { GentlePiCommandDecision, GentlePiPhase } from "./types.js";

function normalizeCommand(command: string): string {
	return command.trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenizeCommandSegments(command: string): string[][] {
	const segments: string[][] = [];
	let current = "";
	let quote: '"' | "'" | undefined;

	const pushSegment = (): void => {
		const tokens = current
			.trim()
			.split(/\s+/)
			.filter((token) => token.length > 0);
		if (tokens.length > 0) {
			segments.push(tokens);
		}
		current = "";
	};

	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		const next = command[index + 1];
		if (quote) {
			if (char === quote) {
				quote = undefined;
			}
			current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === ";" || char === "\n" || char === "|" || char === "&") {
			pushSegment();
			if ((char === "&" && next === "&") || (char === "|" && next === "|")) index++;
			continue;
		}
		current += char;
	}
	pushSegment();
	return segments;
}

function stripCommandDecorators(tokens: readonly string[]): string[] {
	let index = 0;
	while (index < tokens.length && /^[a-z_][a-z0-9_]*=.*/i.test(tokens[index])) {
		index++;
	}
	while (["sudo", "command", "time", "nohup"].includes(tokens[index] ?? "")) {
		index++;
		while (index < tokens.length && /^[a-z_][a-z0-9_]*=.*/i.test(tokens[index])) {
			index++;
		}
	}
	if (tokens[index] === "env") {
		index++;
		while (
			index < tokens.length &&
			(/^-[^\s]+$/.test(tokens[index]) || /^[a-z_][a-z0-9_]*=.*/i.test(tokens[index]))
		) {
			index++;
		}
	}
	return tokens.slice(index);
}

function stripShellQuote(value: string): string {
	return value.replace(/^['"]+/, "").replace(/['"]+$/, "");
}

function expandShellExecSegments(tokens: readonly string[]): string[][] {
	if (!["sh", "bash", "zsh", "dash"].includes(tokens[0] ?? "")) {
		return [tokens.slice()];
	}
	const commandFlagIndex = tokens.findIndex(
		(token) => token === "-c" || (token.endsWith("c") && token.startsWith("-")),
	);
	if (commandFlagIndex === -1 || commandFlagIndex === tokens.length - 1) {
		return [tokens.slice()];
	}
	const nestedCommand = tokens
		.slice(commandFlagIndex + 1)
		.map(stripShellQuote)
		.join(" ");
	return commandSegments(nestedCommand);
}

function hasOption(token: string, option: string): boolean {
	return (
		token === option ||
		(token.startsWith("-") && !token.startsWith("--") && option.length === 2 && token.includes(option[1]))
	);
}

function hasLongOption(token: string, option: string): boolean {
	return token === option || token.startsWith(`${option}=`);
}

function isCurrentTreePath(token: string): boolean {
	return token === "." || token === "./";
}

const NPM_GLOBAL_OPTIONS_WITH_VALUE = new Set(["--prefix", "--workspace", "-w", "--userconfig", "--cache"]);
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set(["-C", "--git-dir", "--work-tree", "-c"]);
const NPM_SCOPED_EXECUTION_MARKER = "__npm_scoped_execution__";

function stripNpmGlobalOptions(tokens: readonly string[]): string[] {
	if (tokens[0] !== "npm") return tokens.slice();
	let index = 1;
	let scopedExecution = false;
	while (index < tokens.length) {
		const token = tokens[index];
		if (token === "--") {
			index++;
			continue;
		}
		if (NPM_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
			if ((token === "--prefix" && tokens[index + 1] !== ".") || token === "--workspace" || token === "-w") {
				scopedExecution = true;
			}
			index += 2;
			continue;
		}
		if (
			token.startsWith("--prefix=") ||
			token.startsWith("--workspace=") ||
			token.startsWith("--userconfig=") ||
			token.startsWith("--cache=")
		) {
			if ((token.startsWith("--prefix=") && token !== "--prefix=.") || token.startsWith("--workspace=")) {
				scopedExecution = true;
			}
			index++;
			continue;
		}
		if (token.startsWith("-") && token !== "-") {
			index++;
			continue;
		}
		break;
	}
	return scopedExecution
		? ["npm", NPM_SCOPED_EXECUTION_MARKER, ...tokens.slice(index)]
		: ["npm", ...tokens.slice(index)];
}

function stripGitGlobalOptions(tokens: readonly string[]): string[] {
	if (tokens[0] !== "git") return tokens.slice();
	let index = 1;
	while (index < tokens.length) {
		const token = tokens[index];
		if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
			index += 2;
			continue;
		}
		if (token.startsWith("--git-dir=") || token.startsWith("--work-tree=") || token.startsWith("-c=")) {
			index++;
			continue;
		}
		if (token.startsWith("-") && token !== "--") {
			index++;
			continue;
		}
		break;
	}
	return ["git", ...tokens.slice(index)];
}

function commandSegments(command: string): string[][] {
	return tokenizeCommandSegments(command)
		.map(stripCommandDecorators)
		.flatMap(expandShellExecSegments)
		.map((tokens) => stripNpmGlobalOptions(stripGitGlobalOptions(tokens)))
		.filter((tokens) => tokens.length > 0);
}

function isDestructiveGit(tokens: readonly string[]): boolean {
	if (tokens[0] !== "git") return false;
	if (tokens[1] === "reset") return tokens.some((token) => hasLongOption(token, "--hard"));
	if (tokens[1] === "clean") {
		return tokens.some((token) => hasOption(token, "-f") || hasLongOption(token, "--force"));
	}
	if (tokens[1] === "stash") return true;
	if (tokens[1] !== "checkout") return false;
	return tokens
		.slice(2)
		.filter((token) => token !== "--")
		.some(isCurrentTreePath);
}

function isForbiddenProjectCommand(tokens: readonly string[]): boolean {
	if (tokens[0] !== "npm") return false;
	const commandIndex = npmCommandIndex(tokens);
	const isScopedExecution = commandIndex === 2;
	if (tokens[commandIndex] === "test") return !isScopedExecution;
	if (tokens[commandIndex] !== "run") return false;
	const script = tokens[commandIndex + 1];
	return script === "dev" || script === "build" || (script === "test" && !isScopedExecution);
}

function npmCommandIndex(tokens: readonly string[]): number {
	return tokens[1] === NPM_SCOPED_EXECUTION_MARKER ? 2 : 1;
}

function isDangerousRemoval(tokens: readonly string[]): boolean {
	return (
		tokens[0] === "rm" &&
		tokens.some((token) => hasOption(token, "-r")) &&
		tokens.some((token) => hasOption(token, "-f"))
	);
}

function isRemoteMutation(tokens: readonly string[]): boolean {
	return tokens[0] === "git" && tokens[1] === "push";
}

function segmentRequiresCheckpoint(tokens: readonly string[]): boolean {
	if (tokens[0] === "npx" && tokens[1] === "biome") {
		return tokens.includes("--write") && (tokens[2] === "check" || tokens[2] === "format");
	}
	if (tokens[0] === "npm") {
		const commandIndex = npmCommandIndex(tokens);
		return tokens[commandIndex] === "install" || tokens[commandIndex] === "i";
	}
	return tokens[0] === "git" && (tokens[1] === "add" || tokens[1] === "commit");
}

function requiresCheckpoint(segments: readonly string[][], phase: GentlePiPhase | undefined): boolean {
	if (phase !== "apply" && phase !== "archive") return false;
	return segments.some(segmentRequiresCheckpoint);
}

export function evaluateGentlePiCommandPolicy(options: {
	command: string;
	phase?: GentlePiPhase;
}): GentlePiCommandDecision {
	const command = normalizeCommand(options.command);
	const segments = commandSegments(command);
	if (segments.some((tokens) => isDestructiveGit(tokens) || isDangerousRemoval(tokens))) {
		return { action: "deny", reason: "destructive git command is forbidden", checkpoint: false };
	}
	if (segments.some(isForbiddenProjectCommand)) {
		return { action: "deny", reason: "forbidden project command is blocked by Gentle Pi policy", checkpoint: false };
	}
	if (segments.some(isRemoteMutation)) {
		return { action: "confirm", reason: "remote mutation requires explicit confirmation", checkpoint: false };
	}
	if (requiresCheckpoint(segments, options.phase)) {
		return { action: "allow", reason: "state mutation requires rollback checkpoint", checkpoint: true };
	}
	return { action: "allow", reason: "command-within-gentle-pi-policy", checkpoint: false };
}
