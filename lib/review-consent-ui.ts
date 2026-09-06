import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ReviewConsentEnvelope, ReviewConsentV3 } from "./review-integration-v2.ts";

export const HOST_REVIEW_SESSION_PERMISSION_LABEL = "Run this review and allow reviews for this Pi session";

const HOST_REVIEW_SESSION_PERMISSION_EFFECT =
	"Runs the provider's exact grant for this frozen candidate, then lets the Pi host use each later candidate's fresh validated provider grant once while this exact Pi session and canonical Git repository identity, including sibling worktrees, remain active. Reload keeps it; new, resume, fork, quit, process restart, or explicit revocation ends it. It grants no verdict, acknowledgement, maintenance, delivery, or cross-repository authority.";

export type ReviewConsentUiSelection =
	| { kind: "provider"; answer: "granted" | "declined" }
	| { kind: "host-session" };

export interface ReviewConsentUiModel {
	readonly title: string;
	readonly options: readonly [string, string, string];
}

export function isPiConsentV3(consent: ReviewConsentEnvelope): consent is ReviewConsentV3 {
	return consent.schema === "gentle-ai.review-integration.consent/v3" && consent.agent === "pi";
}

export function formatReviewConsentUi(consent: ReviewConsentV3): ReviewConsentUiModel {
	const evidence = consent.riskEvidence.map((item) => `- ${item}`).join("\n");
	const title = [
		consent.headline,
		"",
		`Reason: ${consent.reason}`,
		`Value: ${consent.value}`,
		`Risk: ${consent.riskLevel}; ${consent.changedFiles} changed file(s), ${consent.changedLines} changed line(s).`,
		`Target: ${consent.targetIdentity}`,
		`Projection: ${consent.projection}`,
		"Risk evidence:",
		evidence,
		"",
		"Ownership: The first two actions are provider-owned and apply only to this candidate. The third action is owned by the Pi host and controls only an in-memory permission for this exact Pi session and canonical Git repository identity, including sibling worktrees.",
		"",
		`Off-path note: ${consent.offPath.note}`,
		`Off-path command: ${consent.offPath.command}`,
	].join("\n");
	return {
		title,
		options: [
			`1. ${consent.choices[0].label}\nEffect: ${consent.choices[0].effect}`,
			`2. ${consent.choices[1].label}\nEffect: ${consent.choices[1].effect}`,
			`3. ${HOST_REVIEW_SESSION_PERMISSION_LABEL}\nEffect: ${HOST_REVIEW_SESSION_PERMISSION_EFFECT}`,
		],
	};
}

export async function presentReviewConsentUi(
	context: ExtensionContext,
	consent: ReviewConsentEnvelope,
): Promise<ReviewConsentUiSelection | undefined> {
	if (!isPiConsentV3(consent)) return undefined;
	const model = formatReviewConsentUi(consent);
	try {
		const selected = await context.ui.select(model.title, [...model.options]);
		if (selected === model.options[0]) return { kind: "provider", answer: "granted" };
		if (selected === model.options[1]) return { kind: "provider", answer: "declined" };
		if (selected === model.options[2]) return { kind: "host-session" };
		return undefined;
	} catch {
		return undefined;
	}
}
