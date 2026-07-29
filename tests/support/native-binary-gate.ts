export const REQUIRE_NATIVE_BINARY_ENV = "GENTLE_PI_REQUIRE_NATIVE_BINARY";

export class NativeBinaryUnavailableError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "NativeBinaryUnavailableError";
	}
}

interface RequireNativeBinaryInput {
	resolvedBinary: string | undefined;
	digestsPinned: boolean;
	env: Record<string, string | undefined>;
}

interface NativeBinaryRun {
	run: true;
}

interface NativeBinarySkip {
	run: false;
	reason: string;
}

type NativeBinaryGateResult = NativeBinaryRun | NativeBinarySkip;

// Two suites decide for themselves whether to run by skipping silently when
// the pinned native binary is unavailable. That is exactly how an earlier
// protocol-minor gap stayed hidden: the suite reported 0 fail while every
// test in it had skipped. This gate keeps the local convenience -- a
// developer without the binary still gets a printed skip reason -- but under
// `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` (set in CI) the same condition throws
// instead, so CI cannot silently report green with zero real coverage.
export function requireNativeBinary(input: RequireNativeBinaryInput): NativeBinaryGateResult {
	const armed = input.env[REQUIRE_NATIVE_BINARY_ENV] === "1";

	if (input.resolvedBinary === undefined) {
		const reason = `Native gentle-ai binary is unresolved; set ${REQUIRE_NATIVE_BINARY_ENV}=1 to fail instead of skip.`;
		if (armed) throw new NativeBinaryUnavailableError(reason);
		return { run: false, reason };
	}

	if (!input.digestsPinned) {
		const reason = "Native gentle-ai release digest is not pinned; skipping the binary-verified suite.";
		if (armed) throw new NativeBinaryUnavailableError(reason);
		return { run: false, reason };
	}

	return { run: true };
}
