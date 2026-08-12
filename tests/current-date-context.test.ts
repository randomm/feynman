// FORK-OWNED TEST. See FORK.md.
//
// Neither Pi nor Feynman puts the current date in the system prompt (verified by
// capturing a real provider request: 38,311 chars, zero date references). The prompt
// still tells the agent to research "latest/current/recent" topics, so the model
// anchors on its training cutoff and silently discards newer sources. One observed
// run rejected everything published after 2025.
import test from "node:test";
import assert from "node:assert/strict";
import { currentDateContextText, registerCurrentDateContext } from "../extensions/fork/current-date.js";

function fakePi() {
	const handlers: Array<(event: any) => any> = [];
	const pi = { on: (name: string, handler: any) => { if (name === "context") handlers.push(handler); } } as any;
	return { pi, fire: (messages: any[]) => handlers[0]?.({ type: "context", messages }) };
}

test("date text states the full current date unambiguously", () => {
	const text = currentDateContextText(new Date("2026-08-12T09:00:00Z"));
	assert.match(text, /2026-08-12/);
	assert.match(text, /2026/);
});

test("date text tells the agent not to trust its training cutoff", () => {
	const text = currentDateContextText(new Date("2026-08-12T09:00:00Z"));
	assert.match(text, /training/i);
});

test("handler appends the date context to the request messages", () => {
	const { pi, fire } = fakePi();
	registerCurrentDateContext(pi, () => new Date("2026-08-12T09:00:00Z"));
	const result = fire([{ role: "user", content: "hi" }]);
	const serialised = JSON.stringify(result.messages);
	assert.match(serialised, /2026-08-12/);
	assert.equal(result.messages.length, 2, "original message is kept, one context message added");
});

test("repeated requests do not accumulate duplicate date blocks", () => {
	const { pi, fire } = fakePi();
	registerCurrentDateContext(pi, () => new Date("2026-08-12T09:00:00Z"));
	const first = fire([{ role: "user", content: "hi" }]);
	const second = fire(first.messages);
	// count opening tags only - each block contains both <marker> and </marker>
	const count = JSON.stringify(second.messages).match(/<feynman-current-date>/g)?.length ?? 0;
	assert.equal(count, 1, "exactly one date block regardless of how many times context is built");
});

test("a stale date block is refreshed rather than left wrong", () => {
	const { pi, fire } = fakePi();
	let now = new Date("2026-08-12T09:00:00Z");
	registerCurrentDateContext(pi, () => now);
	const first = fire([{ role: "user", content: "hi" }]);
	now = new Date("2026-08-13T09:00:00Z");
	const second = fire(first.messages);
	const serialised = JSON.stringify(second.messages);
	assert.match(serialised, /2026-08-13/);
	assert.doesNotMatch(serialised, /2026-08-12/);
});
