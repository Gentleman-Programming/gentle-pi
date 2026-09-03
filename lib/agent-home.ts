import { homedir } from "node:os";
import { join } from "node:path";

// Pi Subagents resolves its global directory as `PI_CODING_AGENT_DIR || ~/.pi/agent`,
// so an empty value must fall through here too or the two homes diverge again.
export function resolveGentlePiAgentHome(env: NodeJS.ProcessEnv = process.env): string {
	return env.GENTLE_PI_AGENT_HOME || env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}
