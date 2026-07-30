import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GENTLE_AI_VERSION } from "../lib/gentle-ai-binary.ts";
import {
	NativeReviewCliV216,
	NativeReviewConsentBindingError,
	NativeReviewConsentRequiredError,
	clearNativeReviewCapabilitiesCacheForTesting,
	type ExecFileAdapter,
} from "../lib/native-review-cli.ts";
import type { ReviewConsentV2 } from "../lib/review-integration-v2.ts";

const fixtureRoot = join(process.cwd(), "contracts", "review-integration", "v2", "fixtures");
const fixture = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as T;
const executableDigest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";

function capabilities(): Record<string, unknown> {
	const value = fixture<Record<string, unknown>>("capabilities.fixture.json");
	(value.package as Record<string, unknown>).version = GENTLE_AI_VERSION;
	return value;
}

function unrelatedStatus(targetIdentity: string): Record<string, unknown> {
	const status = fixture<Record<string, unknown>>("status.fixture.json");
	status.applicability = "unrelated";
	status.receipt = { status: "not_applicable" };
	status.action = "start";
	status.replayability = "not_replayable";
	status.target_identity = targetIdentity;
	status.candidates = [];
	delete status.authority;
	delete status.frozen;
	delete status.next_transition;
	const projection = status.projection as Record<string, unknown>;
	projection.initial_snapshot_identity = targetIdentity;
	projection.current_snapshot_identity = targetIdentity;
	return status;
}

function queuedAdapter(outputs: readonly Record<string, unknown>[]): { adapter: ExecFileAdapter; calls: Array<readonly string[]> } {
	const queue = [...outputs];
	const calls: Array<readonly string[]> = [];
	return {
		calls,
		adapter: async (request) => {
			calls.push(request.arguments);
			const body = queue.shift();
			if (body === undefined) throw new Error("unexpected native invocation");
			return { stdout: JSON.stringify(body), stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		},
	};
}

function client(adapter: ExecFileAdapter): NativeReviewCliV216 {
	clearNativeReviewCapabilitiesCacheForTesting();
	return new NativeReviewCliV216(adapter, "/package/.gentle-ai/gentle-ai", 30_000, 1024 * 1024, async () => undefined, () => executableDigest);
}

test("negotiated ordinary START declares relay and preserves the complete target-bound consent envelope", async () => {
	const consent = fixture<Record<string, unknown>>("consent.fixture.json");
	const target = String(consent.target_identity);
	const queue = queuedAdapter([
		capabilities(),
		unrelatedStatus(target),
		consent,
	]);
	await assert.rejects(
		() => client(queue.adapter).start({ cwd: "/repo" }),
		(error: unknown) => {
			assert.ok(error instanceof NativeReviewConsentRequiredError);
			assert.deepEqual(error.consent.raw, consent);
			assert.equal(error.consent.targetIdentity, target);
			return true;
		},
	);
	assert.deepEqual(queue.calls.at(-1), [
		"review", "start", "--contract", "gentle-ai.review-integration/v2", "--cwd", "/repo",
		"--target", target, "--projection", "workspace", "--consent", "relay",
	]);
});

test("consent follow-up executes the provider-named invocation exactly once and refuses a changed target binding", async () => {
	const consent = fixture<ReviewConsentV2 extends never ? never : Record<string, unknown>>("consent.fixture.json");
	const decodedConsent = (await import("../lib/review-integration-v2.ts")).decodeReviewConsentV2(consent);
	const started = JSON.parse(JSON.stringify(fixture<Record<string, unknown>>("start.fixture.json"))
		.replaceAll("review-start-fixture", "review-consent-fixture")) as Record<string, unknown>;
	const queue = queuedAdapter([capabilities(), started]);
	const native = client(queue.adapter);
	const result = await native.answerConsent!({ cwd: "/repo", consent: decodedConsent, answer: "granted" });
	assert.equal(result.kind, "started");
	assert.deepEqual(queue.calls.at(-1), decodedConsent.choices[0].invocation.split(" ").slice(1));
	assert.equal(queue.calls.filter((arguments_) => arguments_.includes("granted")).length, 1);

	const changed = structuredClone(decodedConsent);
	changed.targetIdentity = `sha256:${"b".repeat(64)}`;
	await assert.rejects(
		() => native.answerConsent!({ cwd: "/repo", consent: changed, answer: "declined" }),
		/target|binding/,
	);
});

// A binding mismatch is decided entirely inside Pi, before the provider is
// launched, so it must not be reported as a provider failure (issue #247).
test("a consent invocation binding mismatch is a typed pre-native error that never launches the provider", async () => {
	const consent = (await import("../lib/review-integration-v2.ts")).decodeReviewConsentV2(fixture<Record<string, unknown>>("consent.fixture.json"));
	const queue = queuedAdapter([]);
	await assert.rejects(
		() => client(queue.adapter).answerConsent!({ cwd: "/repo/.git/gentle-ai/candidate-views/a1c7fdae", consent, answer: "granted" }),
		(error: unknown) => {
			assert.ok(error instanceof NativeReviewConsentBindingError);
			assert.equal(error.name, "NativeReviewConsentBindingError");
			assert.equal(error.reason, "consent-invocation-cwd-changed");
			assert.equal(error.launchAttempted, false);
			assert.equal(error.mutationOutcome, "none");
			assert.match(error.message, /repository binding changed/);
			return true;
		},
	);
	assert.deepEqual(queue.calls, []);
});

// `decodeReviewConsentV2` already rejects a malformed invocation, so these
// guards defend against a consent object that drifted after decoding. Each one
// must still name itself rather than collapse into a generic failure.
test("every consent invocation binding guard reports its own reason without launching the provider", async () => {
	const decoded = (await import("../lib/review-integration-v2.ts")).decodeReviewConsentV2(fixture<Record<string, unknown>>("consent.fixture.json"));
	const drifted = (mutate: (consent: ReviewConsentV2) => void): ReviewConsentV2 => {
		const value = structuredClone(decoded);
		mutate(value);
		return value;
	};
	const rewriteGranted = (consent: ReviewConsentV2, replace: (invocation: string) => string): void => {
		const choice = consent.choices.find((candidate) => candidate.answer === "granted") as { invocation: string };
		choice.invocation = replace(choice.invocation);
	};
	const cases = [
		{
			reason: "consent-answer-unknown",
			consent: drifted((consent) => { (consent as { choices: unknown }).choices = consent.choices.filter((choice) => choice.answer !== "granted"); }),
		},
		{ reason: "consent-invocation-not-start", consent: drifted((consent) => rewriteGranted(consent, (value) => value.replace("review start", "review finalize"))) },
		{ reason: "consent-invocation-contract-changed", consent: drifted((consent) => rewriteGranted(consent, (value) => value.replace("gentle-ai.review-integration/v2", "gentle-ai.review-integration/v1"))) },
		{ reason: "consent-invocation-target-changed", consent: drifted((consent) => { (consent as { targetIdentity: string }).targetIdentity = `sha256:${"c".repeat(64)}`; }) },
		{ reason: "consent-invocation-projection-changed", consent: drifted((consent) => { (consent as { projection: string }).projection = "staged"; }) },
		{ reason: "consent-invocation-answer-changed", consent: drifted((consent) => rewriteGranted(consent, (value) => value.replace("--consent granted", "--consent declined"))) },
		{ reason: "consent-invocation-option-invalid", consent: drifted((consent) => rewriteGranted(consent, (value) => `${value} --consent granted`)) },
	] as const;
	for (const scenario of cases) {
		const queue = queuedAdapter([]);
		await assert.rejects(
			() => client(queue.adapter).answerConsent!({ cwd: "/repo", consent: scenario.consent, answer: "granted" }),
			(error: unknown) => {
				assert.ok(error instanceof NativeReviewConsentBindingError, `${scenario.reason} must be a typed binding error`);
				assert.equal(error.reason, scenario.reason);
				return true;
			},
		);
		assert.deepEqual(queue.calls, [], `${scenario.reason} must not launch the provider`);
	}
});

test("declined consent decodes the provider's explicit empty authority fields without creating a lineage", async () => {
	const rawConsent = fixture<Record<string, unknown>>("consent.fixture.json");
	const consent = (await import("../lib/review-integration-v2.ts")).decodeReviewConsentV2(rawConsent);
	const declined = {
		operation: "review/start",
		action: "declined",
		lenses_required: false,
		lineage_id: "",
		state: "",
		risk_level: "high",
		selected_lenses: [],
		lens_bindings: [],
		projection: "workspace",
		target_identity: consent.targetIdentity,
		changed_files: 1,
		changed_lines: 1,
		correction_budget: 0,
		risk_evidence: ["shell scripting in scripts/deploy.sh"],
		consent: "declined_this_candidate",
	};
	const queue = queuedAdapter([capabilities(), declined]);
	const result = await client(queue.adapter).answerConsent!({ cwd: "/repo", consent, answer: "declined" });
	assert.equal(result.kind, "declined");
	assert.equal("lineageId" in result, false);
	assert.deepEqual(queue.calls.at(-1), consent.choices[1].invocation.split(" ").slice(1));
});
