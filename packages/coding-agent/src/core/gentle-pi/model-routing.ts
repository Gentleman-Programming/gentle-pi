import { GENTLE_PI_ENVELOPE_STATUS, type GentlePiPhase, type GentlePiRoute, type GentlePiRouteTable } from "./types.js";

const SUPPORTED_ROUTE_FIELDS = new Set(["provider", "model", "thinkingLevel"]);

export function resolveGentlePiPhaseRoute(options: {
	phase: GentlePiPhase;
	routes: GentlePiRouteTable;
}):
	| { status: "success"; route: GentlePiRoute }
	| { status: "blocked"; reason: "routing-policy-missing"; phase: GentlePiPhase } {
	const route = options.routes[options.phase];
	if (!route) {
		return { status: GENTLE_PI_ENVELOPE_STATUS.BLOCKED, reason: "routing-policy-missing", phase: options.phase };
	}
	return { status: GENTLE_PI_ENVELOPE_STATUS.SUCCESS, route };
}

export function validateGentlePiRoutingPolicy(
	routes: Record<string, unknown>,
):
	| { status: "success"; invalidRoutes: [] }
	| { status: "blocked"; invalidRoutes: string[]; reason: "unsupported-pi-route-field" } {
	const invalidRoutes: string[] = [];
	for (const [phase, value] of Object.entries(routes)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		for (const field of Object.keys(value)) {
			if (!SUPPORTED_ROUTE_FIELDS.has(field)) {
				invalidRoutes.push(`${phase}.${field}`);
			}
		}
	}
	if (invalidRoutes.length === 0) {
		return { status: GENTLE_PI_ENVELOPE_STATUS.SUCCESS, invalidRoutes: [] };
	}
	return { status: GENTLE_PI_ENVELOPE_STATUS.BLOCKED, invalidRoutes, reason: "unsupported-pi-route-field" };
}
