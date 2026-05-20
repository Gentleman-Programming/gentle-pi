export interface RuntimeToolCallResult {
	block: boolean;
	reason: string;
}

const FORCE_BRANCH_DELETE_PATTERN =
	/\bgit\s+branch\b(?=[^\n]*(?:\s-D(?:\s|$)|\s--delete\b|\s-[A-Za-z]*d[A-Za-z]*(?:\s|$)))(?=[^\n]*(?:\s-D(?:\s|$)|\s--force\b|\s-[A-Za-z]*f[A-Za-z]*(?:\s|$)))/;

const DENIED_BASH_PATTERNS = [
	/\brm\s+-rf\s+(?:\/|~|\$HOME|\.\.?)(?:\s|$)/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\b(?=[^\n]*(?:-[^\n]*f|--force))(?=[^\n]*(?:-[^\n]*d|--directories))/,
	/\bgit\s+push\b(?=[^\n]*(?:\s--force(?:-with-lease)?\b|\s-[A-Za-z]*f[A-Za-z]*(?:\s|$)))/,
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
];

const CONFIRM_BASH_PATTERNS = [
	/\bgit\s+push\b/,
	/\bgit\s+rebase\b/,
	FORCE_BRANCH_DELETE_PATTERN,
	/\bnpm\s+publish\b/,
	/\bpi\s+remove\b/,
];

export type RuntimeGuardAction = "allow" | "confirm" | "block";
export type RuntimeGuardedCommand =
	| "gitPush"
	| "gitRebase"
	| "gitBranchDeleteForce"
	| "npmPublish"
	| "piRemove";
export interface RuntimeGuardedCommands {
	gitPush?: RuntimeGuardAction;
	gitRebase?: RuntimeGuardAction;
	gitBranchDeleteForce?: RuntimeGuardAction;
	npmPublish?: RuntimeGuardAction;
	piRemove?: RuntimeGuardAction;
}
export interface RuntimeGuardProfile {
	autonomousMode: boolean;
	guardedCommands: RuntimeGuardedCommands;
}

export const AUTONOMOUS_GUARD_DEFAULTS: {
	gitPush: RuntimeGuardAction;
	gitRebase: RuntimeGuardAction;
	gitBranchDeleteForce: RuntimeGuardAction;
	npmPublish: RuntimeGuardAction;
	piRemove: RuntimeGuardAction;
} = {
	gitPush: "allow",
	gitRebase: "confirm",
	gitBranchDeleteForce: "confirm",
	npmPublish: "block",
	piRemove: "confirm",
};

const GUARDED_COMMAND_PATTERNS = [
	{ name: "gitPush", pattern: /\bgit\s+push\b/ },
	{ name: "gitRebase", pattern: /\bgit\s+rebase\b/ },
	{
		name: "gitBranchDeleteForce",
		pattern: FORCE_BRANCH_DELETE_PATTERN,
	},
	{ name: "npmPublish", pattern: /\bnpm\s+publish\b/ },
	{ name: "piRemove", pattern: /\bpi\s+remove\b/ },
];

export function evaluateDeniedCommand(
	command: string,
): RuntimeToolCallResult | undefined {
	for (const pattern of DENIED_BASH_PATTERNS) {
		if (pattern.test(command)) {
			return {
				block: true,
				reason:
					"Gentle AI safety policy blocked a destructive shell command. Ask the user for an explicit safer plan.",
			};
		}
	}
	return undefined;
}

export function commandRequiresConfirmation(command: string): boolean {
	for (const pattern of CONFIRM_BASH_PATTERNS) {
		if (pattern.test(command)) return true;
	}
	return false;
}

export function guardedCommandFor(
	command: string,
): RuntimeGuardedCommand | undefined {
	for (const entry of GUARDED_COMMAND_PATTERNS) {
		if (entry.pattern.test(command)) return entry.name;
	}
	return undefined;
}

export function evaluateRuntimeGuardCommand(
	command: string,
	profile: RuntimeGuardProfile,
): RuntimeToolCallResult | undefined {
	if (!profile.autonomousMode) return undefined;
	const guardedCommand = guardedCommandFor(command);
	if (!guardedCommand) return undefined;
	const action = profile.guardedCommands[guardedCommand];
	if (action === "allow") return undefined;
	if (action === "block") {
		return {
			block: true,
			reason:
				"Gentle AI autonomous runtime permission profile blocked this guarded command.",
		};
	}
	return undefined;
}
