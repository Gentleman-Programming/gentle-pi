import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Pi production code has no native review-transactions mutation path", () => {
	const source = readFileSync(new URL("../extensions/gentle-ai.ts", import.meta.url), "utf8");
	const quarantine = readFileSync(new URL("../lib/native-review-authority-quarantine.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /native-authority-quarantine|quarantineNativeReviewAuthority|createNativeAuthorityQuarantine/);
	assert.doesNotMatch(quarantine, /renameSync|rmSync|unlinkSync|review-transactions/);
});
