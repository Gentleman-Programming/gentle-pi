import assert from "node:assert/strict";
import test from "node:test";
import {
	canonicalJsonV1,
	domainHashV1,
	parseCanonicalJsonV1,
} from "../lib/review-canonical.ts";

test("canonical JSON has stable bytes and domain hashes", () => {
	const left = { zebra: -0, omitted: undefined, nested: { b: true, a: "é" } };
	const right = { nested: { a: "é", b: true }, zebra: 0 };
	assert.equal(canonicalJsonV1(left), "{\"nested\":{\"a\":\"é\",\"b\":true},\"zebra\":0}");
	assert.equal(canonicalJsonV1(left), canonicalJsonV1(right));
	assert.equal(domainHashV1("event", left), domainHashV1("event", right));
	assert.notEqual(domainHashV1("event", left), domainHashV1("root-set", left));
});

test("canonical JSON rejects invalid values and non-canonical input", () => {
	assert.throws(() => canonicalJsonV1([undefined]), /undefined/i);
	assert.throws(() => canonicalJsonV1(Number.NaN), /non-finite/i);
	assert.throws(() => parseCanonicalJsonV1('{"b":1,"a":2}'), /canonical/i);
	assert.deepEqual(parseCanonicalJsonV1('{"a":2,"b":1}'), { a: 2, b: 1 });
});
