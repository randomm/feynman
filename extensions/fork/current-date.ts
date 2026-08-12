// FORK-OWNED. See FORK.md.
//
// Neither Pi nor Feynman puts the current date into the system prompt, yet the prompt
// instructs the agent to research "latest/current/recent" topics. With no anchor the
// model falls back to its training cutoff and silently discards newer sources.
//
// This injects the date through Pi's `context` event, which shapes the per-request
// context only and does not mutate persisted session state.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MARKER = "feynman-current-date";

export function currentDateContextText(now: Date): string {
	const iso = now.toISOString().slice(0, 10);
	const readable = now.toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
	return [
		`<${MARKER}>`,
		`Today's date is ${iso} (${readable}).`,
		"This is the real current date. It is later than your training data cutoff.",
		"Do not assume the current year from your training data, and never dismiss a source",
		"as \"future-dated\" or implausible because it postdates what you remember. Material",
		"published since your cutoff is expected and must be treated as valid evidence.",
		"When judging recency, compare against the date above.",
		`</${MARKER}>`,
	].join("\n");
}

function isDateBlock(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const content = (message as { content?: unknown }).content;
	const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
	return text.includes(MARKER);
}

export function registerCurrentDateContext(pi: ExtensionAPI, now: () => Date = () => new Date()): void {
	pi.on("context", (event) => {
		const at = now();
		// Drop any block from an earlier request so a long-running session cannot carry a
		// stale date, then append a fresh one.
		const messages = (event.messages ?? []).filter((message) => !isDateBlock(message));
		messages.push({
			role: "user",
			content: [{ type: "text", text: currentDateContextText(at) }],
			timestamp: at.getTime(),
		});
		return { messages };
	});
}
