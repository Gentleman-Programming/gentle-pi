import { homedir } from "node:os";
import { join } from "node:path";

export function resolveGentlePiAgentHome(env: NodeJS.ProcessEnv = process.env): string {
	return env.GENTLE_PI_AGENT_HOME ?? env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}
