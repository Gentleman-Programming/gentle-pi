import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

// These tests assert that the composed main-agent prompt (built by buildGentlePrompt)
// does not encourage Rioplatense voseo in neutral mode, and does include the expected
// voseo/Rioplatense markers in gentleman mode.

test("neutral mode composed prompt does not instruct to use voseo", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// The neutral prompt must never tell the model to USE voseo
	assert.doesNotMatch(
		prompt,
		/answer in natural Rioplatense Spanish with voseo/i,
		"neutral prompt must not instruct to use Rioplatense voseo",
	);
	assert.doesNotMatch(
		prompt,
		/uses natural Rioplatense voseo/i,
		"neutral prompt must not describe voseo as the language mode to use",
	);
});

test("neutral mode composed prompt does not contain unqualified Rioplatense instruction", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// Must not say "In gentleman mode, Spanish uses natural Rioplatense voseo"
	assert.doesNotMatch(
		prompt,
		/In `gentleman` mode, Spanish uses natural Rioplatense voseo/i,
		"neutral prompt must not carry static mode-description mentioning Rioplatense voseo",
	);
});

test("gentleman mode composed prompt contains voseo reference", () => {
	const prompt = __testing.buildGentlePrompt("gentleman");
	assert.match(
		prompt,
		/voseo/i,
		"gentleman prompt must reference voseo",
	);
});

test("gentleman mode composed prompt contains Rioplatense reference", () => {
	const prompt = __testing.buildGentlePrompt("gentleman");
	assert.match(
		prompt,
		/Rioplatense/i,
		"gentleman prompt must reference Rioplatense",
	);
});

test("neutral mode composed prompt explicitly states active mode is neutral", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	assert.match(
		prompt,
		/Current persona mode: neutral/i,
		"neutral prompt must state active mode is neutral",
	);
});

test("gentleman mode composed prompt explicitly states active mode is gentleman", () => {
	const prompt = __testing.buildGentlePrompt("gentleman");
	assert.match(
		prompt,
		/Current persona mode: gentleman/i,
		"gentleman prompt must state active mode is gentleman",
	);
});

test("neutral mode composed prompt explicitly forbids voseo conjugations", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// The neutral persona prompt must explicitly forbid voseo conjugation forms
	assert.match(
		prompt,
		/Do NOT use voseo/i,
		"neutral prompt must explicitly forbid voseo",
	);
});

test("neutral and gentleman modes produce different language-boundary text", () => {
	const neutralPrompt = __testing.buildGentlePrompt("neutral");
	const gentlemanPrompt = __testing.buildGentlePrompt("gentleman");

	// The language-boundary section must differ between modes
	assert.notEqual(
		neutralPrompt,
		gentlemanPrompt,
		"neutral and gentleman prompts must differ",
	);

	// Neutral must not include a positive instruction to use Rioplatense
	assert.doesNotMatch(
		neutralPrompt,
		/Language: natural Rioplatense/i,
		"neutral prompt must not contain positive 'natural Rioplatense' language instruction",
	);

	// Gentleman must contain the Rioplatense instruction
	assert.match(
		gentlemanPrompt,
		/Language: natural Rioplatense/i,
		"gentleman prompt must contain 'Language: natural Rioplatense' instruction",
	);
});
