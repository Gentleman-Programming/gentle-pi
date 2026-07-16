#!/usr/bin/env node

import {
	assertCommitTransactionIndex,
	captureCommitTransactionHead,
	COMMIT_TRANSACTION_STATE,
	decodeCommitTransactionInvocation,
	runGitCommitTransaction,
} from "../runtime/git-commit-transaction.mjs";

async function main() {
	const [operation, payload, ...extra] = process.argv.slice(2);
	if (operation === "self-test") {
		if (payload !== undefined || extra.length > 0) throw new Error("commit transaction runner self-test takes no payload");
		process.stdout.write(`${JSON.stringify({ schema: "gentle-pi.git-commit-transaction-runner-self-test/v1", states: Object.values(COMMIT_TRANSACTION_STATE) })}\n`);
		return;
	}
	if (extra.length > 0 || !payload) throw new Error("commit transaction runner requires one encoded payload");
	if (operation === "assert-index") {
		assertCommitTransactionIndex(payload);
		return;
	}
	if (operation === "capture-commit") {
		captureCommitTransactionHead(payload);
		return;
	}
	if (operation !== "run") throw new Error("commit transaction runner operation is unsupported");
	const result = await runGitCommitTransaction(decodeCommitTransactionInvocation(payload));
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
	process.stderr.write(`gentle-pi commit transaction failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
