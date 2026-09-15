import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSessionChangeCapture } from "../lib/session-change-capture.ts";
import { SessionChanges, SESSION_CHANGE_ENTRY, SESSION_CHANGE_RELAY } from "../lib/session-changes.ts";

async function fixture(run: (f: any) => Promise<void>, child = false) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "change-capture-")));
	const handlers = new Map<string, Function>();
	const entries: any[] = [];
	const listeners = new Map<string, Set<Function>>();
	const pi = { on: (key, fn) => handlers.set(key, fn), appendEntry: (customType, data) => entries.push({type:"custom",customType,data}),
		events: { on: (key, fn) => { const subscribers = listeners.get(key) ?? new Set(); subscribers.add(fn); listeners.set(key, subscribers); return () => subscribers.delete(fn); }, emit: (key, data) => listeners.get(key)?.forEach((listener) => listener(data)) } };
	let id = "session", cwd = root;
	const ctx = { get cwd() { return cwd; }, sessionManager: { getSessionId: () => id, getEntries: () => entries } };
	installSessionChangeCapture(pi as never, child ? {GENTLE_PI_AGENTS_CHILD:"1"} : {}, (cwd) => ({root:cwd,commonDir:root}));
	const fire = (key, event = {}) => handlers.get(key)?.(event, ctx);
	try { await fire("session_start"); await run({root, pi, entries, ctx, fire, listenerCount: (key) => listeners.get(key)?.size ?? 0, switchSession: (nextId = "other", nextCwd = root) => { id = nextId; cwd = nextCwd; }}); }
	finally { await rm(root, {recursive:true,force:true}); }
}

test("capture reads no inventory at startup and ignores read-only tools", async () => fixture(async ({fire, entries}) => {
	await fire("tool_call", {toolCallId:"r",toolName:"read",input:{path:"missing"}});
	await fire("tool_result", {toolCallId:"r",toolName:"read",input:{path:"missing"},isError:false});
	await fire("tool_execution_end", {toolCallId:"r",toolName:"read",isError:false});
	assert.deepEqual(entries, []);
}));

test("successful writes capture only the exact tool target and persist for reload", async () => fixture(async ({root,fire,entries}) => {
	await writeFile(join(root,"file"),"human baseline\n");
	const event = {toolCallId:"w",toolName:"write",input:{path:"file",content:"agent output\n"}};
	await fire("tool_call",event);
	await writeFile(join(root,"file"),event.input.content);
	await fire("tool_result",{...event,isError:false});
	assert.equal(entries.length,0);
	await fire("tool_execution_end",{toolCallId:"w",toolName:"write",isError:false});
	assert.equal(entries[0].customType,SESSION_CHANGE_ENTRY);
	await writeFile(join(root,"file"),"later human output\n");
	const changes = new SessionChanges("session",entries);
	assert.match(changes.loadDiff(root,changes.model.files[0]),/\+agent output/);
	assert.doesNotMatch(changes.loadDiff(root,changes.model.files[0]),/later human/);
}));

test("failed and stale-session tool outcomes never add session changes", async () => fixture(async ({root,fire,entries,switchSession}) => {
	const event={toolCallId:"w",toolName:"write",input:{path:"new",content:"agent\n"}};
	await fire("tool_call",event);
	await writeFile(join(root,"new"),event.input.content);
	await fire("tool_result",{...event,isError:false});
	await fire("tool_execution_end",{toolCallId:"w",toolName:"write",isError:true});
	assert.equal(entries.length,0);
	await fire("tool_call",{...event,toolCallId:"x"});
	switchSession();
	await fire("tool_result",{...event,toolCallId:"x",isError:false});
	await fire("tool_execution_end",{toolCallId:"x",toolName:"write",isError:false});
	assert.equal(entries.length,0);
}));

test("session change relays remain subscribed across sessions and inert between them", async () => fixture(async ({root,pi,entries,fire,listenerCount,switchSession}) => {
	assert.equal(listenerCount(SESSION_CHANGE_RELAY), 1, "the relay subscription must be installed once per extension instance");
	const evidence = (id: string, evidenceRoot = root) => ({ id, root: evidenceRoot, path: "own.ts", before: { kind: "absent" as const }, after: { kind: "text" as const, text: "agent\n" } });
	pi.events.emit(SESSION_CHANGE_RELAY, { sessionId: "session", evidence: evidence("first") });
	assert.equal(entries.length, 1);
	await fire("session_shutdown");
	pi.events.emit(SESSION_CHANGE_RELAY, { sessionId: "session", evidence: evidence("between") });
	assert.equal(entries.length, 1, "relays without an active session must be inert");
	const nextRoot = `${root}/next`;
	switchSession("other", nextRoot);
	await fire("session_start");
	assert.equal(listenerCount(SESSION_CHANGE_RELAY), 1, "a new session must not add a duplicate relay subscription");
	pi.events.emit(SESSION_CHANGE_RELAY, { sessionId: "other", evidence: evidence("second", nextRoot) });
	assert.deepEqual(entries.map((entry) => entry.data), [
		{ sessionId: "session", evidence: evidence("first") },
		{ sessionId: "other", evidence: evidence("second", nextRoot) }, 
	]);
	await fire("session_shutdown");
}));

test("child carries bounded evidence in the existing tool-result details transport", async () => fixture(async ({root,fire,entries}) => {
	const event={toolCallId:"w",toolName:"write",input:{path:"new",content:"agent\n"}};
	await fire("tool_call",event); await writeFile(join(root,"new"),event.input.content);
	const result=await fire("tool_result",{...event,isError:false,details:{original:"preserved"}});
	assert.equal(result.details.original,"preserved");
	assert.equal(result.details.gentleSessionChange.id,"w");
	assert.equal(result.details.gentleSessionChange.path,"new");
	assert.deepEqual(entries,[]);
},true));
