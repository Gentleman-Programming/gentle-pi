import assert from "node:assert/strict";
import test from "node:test";
import {
	AGENT_ACTIVITY_CHANGED_CHANNEL,
	AGENT_ACTIVITY_REQUEST_CHANNEL,
	createAgentActivityConsumer,
	createAgentActivityProjection,
	validateAgentActivitySnapshot,
} from "../lib/agent-activity-projection.ts";

class Bus {
	readonly records: Array<{ channel: string; data: unknown }> = [];
	readonly handlers = new Map<string, Array<(data: unknown) => void>>();

	on(channel: string, handler: (data: unknown) => void): () => void {
		const handlers = this.handlers.get(channel) ?? [];
		handlers.push(handler);
		this.handlers.set(channel, handlers);
		return () => this.handlers.set(channel, handlers.filter((item) => item !== handler));
	}

	emit(channel: string, data?: unknown): void {
		this.records.push({ channel, data });
		for (const handler of [...(this.handlers.get(channel) ?? [])]) handler(data);
	}
}

const entry = (id = "task-1", extra: Record<string, unknown> = {}) => ({
	id, name: "worker", kind: "managed-task", state: "running", ...extra,
});
const changedCount = (bus: Bus) => bus.records.filter(({ channel }) => channel === AGENT_ACTIVITY_CHANGED_CHANNEL).length;
const available = (generation: string, revision: number) => ({
	version: "gentle-pi.agent-activity/v1", source_generation: generation, revision,
	availability: "available", tasks: [], total_count: 0, truncated: false,
});
const unavailable = (reason: string, generation: string | null, revision: number) => ({
	version: "gentle-pi.agent-activity/v1", source_generation: generation, revision,
	availability: "unavailable", tasks: [], total_count: 0, truncated: false, reason,
});
function assertUnavailable(snapshot: unknown, reason: string, generation: string | null, revision: number): void {
	assert.deepEqual(snapshot, unavailable(reason, generation, revision));
}

test("snapshot validation enforces lifecycle revisions and generation grammar", () => {
	const generation = "generation-1";
	const invalid = [
		["available revision 0", available(generation, 0)],
		["starting revision 1", unavailable("starting", generation, 1)],
		["replacing revision 1", unavailable("replacing", generation, 1)],
		["shutdown revision 0", unavailable("shutdown", generation, 0)],
		["generation control", available("generation\n1", 1)],
		["generation too long", available("a".repeat(129), 1)],
	] as const;
	const accepted: string[] = [];
	for (const [name, snapshot] of invalid) {
		try { validateAgentActivitySnapshot(snapshot); accepted.push(name); } catch { /* expected rejection */ }
	}
	assert.deepEqual(accepted, []);
});

test("projection emits lifecycle envelopes and rejects stale capabilities", () => {
	const bus = new Bus();
	const projection = createAgentActivityProjection(bus);
	assertUnavailable(projection.getSnapshot(), "not-started", null, 0);
	assert.deepEqual(Object.keys(projection.getSnapshot()), ["version", "source_generation", "revision", "availability", "tasks", "total_count", "truncated", "reason"]);
	const first = projection.registerProducer();
	const generation = projection.getSnapshot().source_generation;
	assert.equal(typeof generation, "string");
	assertUnavailable(projection.getSnapshot(), "starting", generation, 0);
	first.publish([entry()]);
	assert.deepEqual(projection.getSnapshot(), {
		version: "gentle-pi.agent-activity/v1", source_generation: generation, revision: 1,
		availability: "available", tasks: [entry()], total_count: 1, truncated: false,
	});
	const second = projection.registerProducer();
	const replacementGeneration = projection.getSnapshot().source_generation;
	assert.notEqual(replacementGeneration, generation);
	assertUnavailable(projection.getSnapshot(), "replacing", replacementGeneration, 0);
	assert.equal(changedCount(bus), 3);
	assert.ok(bus.records.filter(({ channel }) => channel === AGENT_ACTIVITY_CHANGED_CHANNEL).every(({ data }) => Object.isFrozen(data)));
	first.publish([entry("stale")]);
	first.dispose();
	assertUnavailable(projection.getSnapshot(), "replacing", replacementGeneration, 0);
	second.publish([entry("current")]);
	second.dispose();
	assertUnavailable(projection.getSnapshot(), "shutdown", replacementGeneration, 2);
	second.dispose();
	assertUnavailable(projection.getSnapshot(), "shutdown", replacementGeneration, 2);
	const consumer = createAgentActivityConsumer(bus);
	consumer.request();
	assert.deepEqual(consumer.getSnapshot(), projection.getSnapshot());
});

test("fresh seam instances mint unequal privacy-safe generations", () => {
	const first = createAgentActivityProjection(new Bus());
	const second = createAgentActivityProjection(new Bus());
	first.registerProducer();
	second.registerProducer();
	const firstGeneration = first.getSnapshot().source_generation;
	const secondGeneration = second.getSnapshot().source_generation;
	assert.notEqual(firstGeneration, secondGeneration);
	assert.match(firstGeneration ?? "", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
	assert.match(secondGeneration ?? "", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
});

test("publish applies exact output bounds and invalid input is atomic", () => {
	const bus = new Bus();
	const projection = createAgentActivityProjection(bus);
	const producer = projection.registerProducer();
	for (const [count, truncated] of [[100, false], [101, true]] as const) {
		producer.publish(Array.from({ length: count }, (_, index) => entry(`task-${count}-${index}`)));
		const snapshot = projection.getSnapshot();
		assert.equal(snapshot.total_count, count);
		assert.equal(snapshot.tasks.length, 100);
		assert.equal(snapshot.truncated, truncated);
	}
	const before = projection.getSnapshot();
	const emissions = changedCount(bus);
	assert.throws(() => producer.publish(Array.from({ length: 1_001 }, (_, index) => entry(`too-many-${index}`))));
	assert.equal(projection.getSnapshot(), before);
	assert.equal(changedCount(bus), emissions);
});

test("required privacy grammars reject while optional and forbidden fields are omitted", () => {
	const bus = new Bus();
	const projection = createAgentActivityProjection(bus);
	const producer = projection.registerProducer();
	const invalidRequired = [
		["empty id", { id: "" }], ["id control", { id: "task\n1" }], ["id length", { id: "a".repeat(129) }],
		["empty name", { name: "" }], ["name control", { name: "worker\t1" }], ["name length", { name: "a".repeat(65) }],
		["kind", { kind: "other" }], ["state", { state: "chatting" }],
	] as const;
	for (const [name, fields] of invalidRequired) {
		const before = projection.getSnapshot();
		const emissions = changedCount(bus);
		assert.throws(() => producer.publish([entry("invalid", fields)]), TypeError, name);
		assert.equal(projection.getSnapshot(), before);
		assert.equal(changedCount(bus), emissions);
	}
	producer.publish([entry("safe", {
		parent_id: null, activity: "waiting\n", tool_name: "tool/name", model_provider: "a".repeat(65),
		model_id: "a".repeat(129), effort: "bad effort", started_at_ms: -1, ended_at_ms: "secret",
		input_tokens: -1, output_tokens: "secret", cached_tokens: Number.MAX_SAFE_INTEGER + 1,
		total_tokens: null, context_window_tokens: {}, prompt: "private prompt", path: "/private/project", credentials: "token",
	})]);
	assert.deepEqual(projection.getSnapshot().tasks, [entry("safe")]);
	assert.throws(() => producer.publish([entry("safe"), entry("safe")]));
});

test("valid optional fields remain bounded and snapshots are immutable", () => {
	const bus = new Bus();
	const projection = createAgentActivityProjection(bus);
	const producer = projection.registerProducer();
	const candidate = [entry("first"), entry("second")];
	producer.publish(candidate);
	candidate[0]!.name = "changed outside the seam";
	assert.deepEqual(projection.getSnapshot().tasks.map((task) => task.id), ["first", "second"]);
	assert.throws(() => { (projection.getSnapshot().tasks[0] as { name: string }).name = "mutate"; });
	producer.publish([entry("rich", {
		parent_id: "parent-1", activity: "running-tool", tool_name: "gentle.read_file", model_provider: "provider-name",
		model_id: "model:v1", effort: "medium", started_at_ms: 10, ended_at_ms: 5, total_tokens: 2, context_window_tokens: 3,
	})]);
	assert.deepEqual(projection.getSnapshot().tasks, [{
		id: "rich", name: "worker", kind: "managed-task", state: "running", parent_id: "parent-1", activity: "running-tool",
		tool_name: "gentle.read_file", model_provider: "provider-name", model_id: "model:v1", effort: "medium",
		started_at_ms: 10, total_tokens: 2, context_window_tokens: 3,
	}]);
});

test("consumer subscribes before requesting and clears malformed changes fail-closed", () => {
	const bus = new Bus();
	const projection = createAgentActivityProjection(bus);
	const producer = projection.registerProducer();
	const consumer = createAgentActivityConsumer(bus);
	const seen: unknown[] = [];
	consumer.subscribe((snapshot) => seen.push(snapshot));
	consumer.request();
	assert.equal(bus.records.at(-2)?.channel, AGENT_ACTIVITY_REQUEST_CHANNEL);
	assert.equal(bus.records.at(-2)?.data, undefined);
	assert.equal(seen.length, 1);
	producer.publish([entry()]);
	consumer.request();
	assert.equal(seen.length, 3);
	assert.deepEqual(consumer.getSnapshot(), projection.getSnapshot());
	assert.deepEqual(Object.keys(consumer).sort(), ["getSnapshot", "request", "subscribe"]);
	bus.emit(AGENT_ACTIVITY_CHANGED_CHANNEL, { version: "wrong/v9", availability: "available" });
	assert.equal(consumer.getSnapshot(), undefined);
	assert.equal(seen.at(-1), undefined);
	bus.emit(AGENT_ACTIVITY_CHANGED_CHANNEL, null);
	assert.equal(consumer.getSnapshot(), undefined);
	const firstBus = new Bus();
	const firstConsumer = createAgentActivityConsumer(firstBus);
	firstConsumer.request();
	assert.equal(firstConsumer.getSnapshot(), undefined);
	const firstProjection = createAgentActivityProjection(firstBus);
	firstProjection.registerProducer();
	assert.equal(firstConsumer.getSnapshot()?.reason, "starting");
});
