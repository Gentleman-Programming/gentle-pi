import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const skill = readFileSync(join(repoRoot, "skills", "issue-creation", "SKILL.md"), "utf8");

test("preserves the prefixed skill identity and bumps metadata for automated Issue Forms", () => {
	assert.match(skill, /^name: gentle-ai-issue-creation$/m);
	assert.match(skill, /^  version: "1\.3"$/m);
});

test("makes YAML Issue Forms the deterministic automated format authority", () => {
	assert.match(skill, /YAML Issue Forms are the format authority/i);
	assert.match(skill, /`input`, `textarea`, `dropdown`, and `checkboxes`/);
	assert.match(skill, /declared order/i);
	assert.match(skill, /visible labels and options/i);
	assert.match(skill, /multi-select.*declared options order/i);
	assert.match(skill, /_No response_/);
	assert.match(skill, /individually required checkbox/i);
	assert.match(skill, /explicit first-person affirmation/i);
	assert.match(skill, /textarea\.attributes\.render/);
	assert.match(skill, /fence the answer with the declared language/i);
});

test("fails closed before publication for invalid required Issue Form data", () => {
	assert.match(skill, /Fail closed before mutation/i);
	assert.match(skill, /malformed, unsupported, missing, or ambiguous required structure or answers/i);
	assert.match(skill, /Never invent answers, selections, confirmations, or labels/i);
});

test("publishes reviewed Issue Form bodies through a private body file", () => {
	assert.match(skill, /private `BODY_FILE`/);
	assert.match(skill, /gh issue create --repo "\$TARGET" --title "\$TITLE" --body-file "\$BODY_FILE"/);
	assert.match(skill, /target verification/i);
	assert.match(skill, /duplicate search/i);
	assert.match(skill, /privacy scan/i);
	assert.match(skill, /permitted labels/i);
	assert.match(skill, /one mutation attempt/i);
	assert.match(skill, /target-host read-back/i);
});

function assertBrowserContract(candidate: string) {
	assert.match(candidate, /gh issue create --repo "\$TARGET" --title "\$TITLE" --body-file "\$BODY_FILE"/);
	assert.match(
		candidate,
		/Only when the user explicitly requests browser completion[\s\S]{0,500}gh issue create --repo "\$TARGET" --web/,
	);
	assert.match(candidate, /malformed, unsupported, or unrepresentable form[\s\S]{0,300}explicitly requests browser completion/i);
	assert.match(candidate, /missing or ambiguous required[\s\S]{0,200}fail closed[\s\S]{0,200}do not open a browser/i);
	assert.doesNotMatch(candidate, /Do not parse or render[\s\S]{0,300}stop for human completion/i);
	assert.doesNotMatch(candidate, /(?:always|must|only)\s+(?:open|use|route to)\s+(?:the )?browser(?:\s+for)?\s+(?:Issue Forms?|YAML)/i);
	assert.doesNotMatch(
		candidate,
		/\bfor\s+(?:YAML\s+)?Issue\s+Forms?\b[\s\S]{0,160}\b(?:open|use|route to|go to)\b[\s\S]{0,100}\b(?:browser|web issue chooser|web)\b/i,
	);
}

test("keeps automated and explicitly requested browser Issue Form paths distinct", () => {
	assertBrowserContract(skill);

	const unconditionalYamlBrowserGuidance = `${skill}\n\nFor YAML Issue Forms, open the web issue chooser and stop for human completion.`;
	assert.throws(() => assertBrowserContract(unconditionalYamlBrowserGuidance));
});

test("discovers support routing and keeps all issue files private until cleanup", () => {
	assert.match(skill, /README\.md/);
	assert.match(skill, /\.github\/ISSUE_TEMPLATE\/config\.yml/);
	assert.match(skill, /Discussions\/contact routing/i);
	assert.match(skill, /questions\/support[\s\S]{0,250}(?:Discussions|contact)[\s\S]{0,250}otherwise ask or stop/i);
	assert.match(skill, /TMP_DIR="\$\(mktemp -d\)"/);
	assert.match(skill, /chmod 700 "\$TMP_DIR"/);
	assert.match(skill, /umask 077/);
	assert.match(skill, /BODY_FILE="\$TMP_DIR\//);
	assert.match(skill, /READBACK_FILE="\$TMP_DIR\//);
	assert.match(skill, /trap '[^']*rm -rf "\$TMP_DIR"[^']*' EXIT/);
});
