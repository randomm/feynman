import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Exec, type ExecOptions, type ExecResult, ExecError } from "../extensions/web-providers/exec.js";
import { registerWebTools, resolveWigoloBin } from "../extensions/web-providers/tools.js";
import {
	buildWigoloFetchArgs,
	buildWigoloResearchArgs,
	buildWigoloSearchArgs,
	createSemaphore,
	parseWigoloStdout,
} from "../extensions/web-providers/wigolo.js";

type Call = { file: string; args: string[]; options: ExecOptions };

function fakeExec(handler: (file: string, args: string[]) => ExecResult | Promise<ExecResult>) {
	const calls: Call[] = [];
	const exec: Exec = async (file, args, options) => {
		calls.push({ file, args, options });
		return handler(file, args);
	};
	return { exec, calls };
}

function ok(payload: unknown, stderr = ""): ExecResult {
	return { stdout: JSON.stringify(payload), stderr, exitCode: 0 };
}

const WIGOLO_HITS = { results: [{ title: "A", url: "https://a.example" }], engines_used: ["duckduckgo"] };

function setup(options: {
	exec: Exec;
	runParallel?: (args: string[]) => Promise<unknown>;
	env?: NodeJS.ProcessEnv;
}) {
	const tools = new Map<string, any>();
	const pi = { registerTool: (config: any) => tools.set(config.name, config) } as unknown as ExtensionAPI;
	const parallelCalls: string[][] = [];
	registerWebTools(pi, {
		exec: options.exec,
		runParallel: async (args) => {
			parallelCalls.push(args);
			if (options.runParallel) return options.runParallel(args);
			return { results: [{ title: "P", url: "https://p.example" }] };
		},
		env: options.env ?? {},
		sleep: async () => {},
	});
	return { tool: (name: string) => tools.get(name), parallelCalls };
}

function run(tool: any, params: Record<string, unknown>) {
	return tool.execute("call-1", params);
}

test("registers exactly the three feynman_web tools", () => {
	const { exec } = fakeExec(() => ok(WIGOLO_HITS));
	const names: string[] = [];
	const pi = { registerTool: (config: any) => names.push(config.name) } as unknown as ExtensionAPI;
	registerWebTools(pi, { exec, env: {} });
	assert.deepEqual(names, ["feynman_web_search", "feynman_web_fetch", "feynman_web_research"]);
});

test("search rejects bad input before any backend runs", async () => {
	const { exec, calls } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool } = setup({ exec });
	await assert.rejects(run(tool("feynman_web_search"), { query: "  " }), /invalid_input: query/);
	await assert.rejects(run(tool("feynman_web_search"), { query: "-rf" }), /must not start with a dash/);
	await assert.rejects(run(tool("feynman_web_search"), { query: "x", maxResults: 21 }), /maxResults/);
	await assert.rejects(run(tool("feynman_web_search"), { query: "x", afterDate: "2026/01/01" }), /YYYY-MM-DD/);
	assert.equal(calls.length, 0);
});

test("fetch rejects non-http URLs before any backend runs", async () => {
	const { exec, calls } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool } = setup({ exec });
	await assert.rejects(run(tool("feynman_web_fetch"), { url: "file:///etc/passwd" }), /absolute http/);
	assert.equal(calls.length, 0);
});

test("auto uses wigolo by default and does not touch parallel", async () => {
	const { exec, calls } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool, parallelCalls } = setup({ exec });
	const result = await run(tool("feynman_web_search"), { query: "local web search" });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].file, "wigolo");
	assert.equal(parallelCalls.length, 0);
	assert.equal(result.details.provider, "wigolo");
	assert.match(result.content[0].text, /^\[backend: wigolo\]/);
});

test("LOG_LEVEL=error is set on the wigolo child process", async () => {
	const { exec, calls } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool } = setup({ exec });
	await run(tool("feynman_web_search"), { query: "x" });
	assert.equal(calls[0].options.env?.LOG_LEVEL, "error");
});

test("FEYNMAN_WIGOLO_BIN overrides the binary", async () => {
	const { exec, calls } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool } = setup({ exec, env: { FEYNMAN_WIGOLO_BIN: "/opt/wigolo/bin/wigolo" } });
	await run(tool("feynman_web_search"), { query: "x" });
	assert.equal(calls[0].file, "/opt/wigolo/bin/wigolo");
});

test("missing wigolo binary falls back to parallel with a visible header", async () => {
	const { exec } = fakeExec(() => {
		throw new ExecError("ENOENT", "wigolo not found on PATH");
	});
	const { tool, parallelCalls } = setup({ exec });
	const result = await run(tool("feynman_web_search"), { query: "x", maxResults: 3 });
	assert.deepEqual(parallelCalls[0], ["search", "x", "--json", "--max-results", "3"]);
	assert.equal(result.details.provider, "parallel");
	assert.match(result.content[0].text, /^\[backend: parallel \| fallback from wigolo: enoent\]/);
	assert.equal(result.details.attempts.length, 2);
	assert.equal(result.details.attempts[0].ok, false);
});

test("native module ABI errors fall back to parallel", async () => {
	const { exec } = fakeExec(() => ({
		stdout: "",
		stderr: "Error: The module better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 127",
		exitCode: 1,
	}));
	const { tool } = setup({ exec });
	const result = await run(tool("feynman_web_search"), { query: "x" });
	assert.equal(result.details.provider, "parallel");
	assert.equal(result.details.attempts[0].reason?.startsWith("native_module"), true);
});

test("invalid_input from wigolo is thrown and never falls back", async () => {
	const { exec } = fakeExec(() => ({ stdout: JSON.stringify({ error: "invalid_input", message: "bad flag" }), stderr: "", exitCode: 1 }));
	const { tool, parallelCalls } = setup({ exec });
	await assert.rejects(run(tool("feynman_web_search"), { query: "x" }), /invalid_input: bad flag/);
	assert.equal(parallelCalls.length, 0);
});

test("provider:parallel makes one attempt and never calls wigolo", async () => {
	const { exec, calls } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool, parallelCalls } = setup({ exec });
	const result = await run(tool("feynman_web_search"), { query: "x", provider: "parallel", afterDate: "2026-01-01" });
	assert.equal(calls.length, 0);
	assert.deepEqual(parallelCalls[0], ["search", "x", "--json", "--after-date", "2026-01-01"]);
	assert.equal(result.details.provider, "parallel");
	assert.match(result.content[0].text, /^\[backend: parallel\]/);
});

test("FEYNMAN_WEB_FALLBACK=0 turns fallback off", async () => {
	const { exec } = fakeExec(() => {
		throw new ExecError("ENOENT", "missing");
	});
	const { tool, parallelCalls } = setup({ exec, env: { FEYNMAN_WEB_FALLBACK: "0" } });
	await assert.rejects(run(tool("feynman_web_search"), { query: "x" }), /Web backends failed/);
	assert.equal(parallelCalls.length, 0);
});

test("an invalid FEYNMAN_WEB_PROVIDER warns and uses auto", async () => {
	const { exec } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool } = setup({ exec, env: { FEYNMAN_WEB_PROVIDER: "bing" } });
	const result = await run(tool("feynman_web_search"), { query: "x" });
	assert.equal(result.details.provider, "wigolo");
	assert.match(result.details.warnings.join(" "), /FEYNMAN_WEB_PROVIDER="bing"/);
});

test("FEYNMAN_WEB_PROVIDER=parallel routes everything through parallel (rollback switch)", async () => {
	const { exec, calls } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool, parallelCalls } = setup({ exec, env: { FEYNMAN_WEB_PROVIDER: "parallel" } });
	await run(tool("feynman_web_fetch"), { url: "https://a.example/x" });
	assert.equal(calls.length, 0);
	assert.deepEqual(parallelCalls[0], ["fetch", "https://a.example/x", "--json"]);
});

test("an empty wigolo search (no results, no engines) falls back", async () => {
	const { exec } = fakeExec(() => ok({ results: [], engines_used: [] }));
	const { tool } = setup({ exec });
	const result = await run(tool("feynman_web_search"), { query: "x" });
	assert.equal(result.details.provider, "parallel");
	assert.match(result.content[0].text, /no results/);
});

test("a wigolo search with engines reached but no hits is a real answer, not a fallback", async () => {
	const { exec } = fakeExec(() => ok({ results: [], engines_used: ["bing"] }));
	const { tool, parallelCalls } = setup({ exec });
	const result = await run(tool("feynman_web_search"), { query: "x" });
	assert.equal(result.details.provider, "wigolo");
	assert.equal(result.details.empty, false);
	assert.equal(parallelCalls.length, 0);
});

test("blocked pages fall back only for fetch", async () => {
	const blocked = { stdout: JSON.stringify({ error: "blocked_by_challenge" }), stderr: "", exitCode: 1 };
	const { exec } = fakeExec(() => blocked);
	const { tool, parallelCalls } = setup({ exec });
	const fetched = await run(tool("feynman_web_fetch"), { url: "https://a.example" });
	assert.equal(fetched.details.provider, "parallel");
	assert.equal(parallelCalls.length, 1);
	await assert.rejects(run(tool("feynman_web_search"), { query: "x" }), /Web backends failed/);
	assert.equal(parallelCalls.length, 1);
});

test("research never falls back silently and names the parallel escape hatch", async () => {
	const { exec } = fakeExec(() => ({ stdout: JSON.stringify({ error: "upstream_error" }), stderr: "", exitCode: 1 }));
	const { tool, parallelCalls } = setup({ exec });
	await assert.rejects(run(tool("feynman_web_research"), { question: "q" }), /provider:"parallel"/);
	assert.equal(parallelCalls.length, 0);
});

test("research on wigolo passes the brief through and adds no synthesis warning", async () => {
	// sampling_supported is MCP client sampling, not LLM availability, so it must not warn.
	const { exec } = fakeExec(() => ok({ report: "synthesized", sampling_supported: false }));
	const { tool } = setup({ exec });
	const result = await run(tool("feynman_web_research"), { question: "q", depth: "quick" });
	assert.equal(result.details.provider, "wigolo");
	assert.deepEqual(result.details.warnings, []);
	assert.equal(result.details.payload.report, "synthesized");
});

test("explicit parallel research runs the paid deep path", async () => {
	const { exec, calls } = fakeExec(() => ok(WIGOLO_HITS));
	const { tool, parallelCalls } = setup({ exec });
	const result = await run(tool("feynman_web_research"), { question: "q", provider: "parallel" });
	assert.equal(calls.length, 0);
	assert.deepEqual(parallelCalls[0], ["research", "run", "q", "--json", "--processor", "pro-fast"]);
	assert.equal(result.details.provider, "parallel");
});

test("a busy SQLite cache is retried once and then succeeds", async () => {
	let attempts = 0;
	const { exec } = fakeExec(() => {
		attempts++;
		if (attempts === 1) return { stdout: "", stderr: "SQLITE_BUSY: database is locked", exitCode: 1 };
		return ok(WIGOLO_HITS);
	});
	const { tool, parallelCalls } = setup({ exec });
	const result = await run(tool("feynman_web_search"), { query: "x" });
	assert.equal(attempts, 2);
	assert.equal(result.details.provider, "wigolo");
	assert.equal(parallelCalls.length, 0);
});

test("long text is truncated with a visible marker", async () => {
	const big = { results: [{ snippet: "x".repeat(40_000) }], engines_used: ["bing"] };
	const { exec } = fakeExec(() => ok(big));
	const { tool } = setup({ exec });
	const result = await run(tool("feynman_web_search"), { query: "x" });
	assert.match(result.content[0].text, /\[truncated: \d+ chars omitted\]/);
});

test("wigolo argument builders map every flag", () => {
	assert.deepEqual(
		buildWigoloSearchArgs({
			query: "q",
			maxResults: 4,
			afterDate: "2026-02-01",
			includeDomains: ["a.org", "b.org"],
			category: "papers",
			withContent: false,
		}),
		["search", "q", "--json", "--max-results", "4", "--from-date", "2026-02-01", "--include-domains", "a.org,b.org", "--category", "papers", "--no-content"],
	);
	assert.deepEqual(buildWigoloFetchArgs({ url: "https://a", maxChars: 900, section: "Intro" }), [
		"fetch",
		"https://a",
		"--json",
		"--max-content-chars",
		"900",
		"--section",
		"Intro",
	]);
	assert.deepEqual(buildWigoloResearchArgs({ question: "q", depth: "comprehensive" }), ["research", "q", "--json", "--depth", "comprehensive"]);
});

test("stdout parsing skips log lines that share the stream with the result", () => {
	const stdout = [
		'{"ts":"2026-10-12T18:00:00Z","level":"info","msg":"rerank ready"}',
		"{",
		'  "results": [],',
		'  "engines_used": ["bing"]',
		"}",
	].join("\n");
	assert.deepEqual(parseWigoloStdout(stdout), { results: [], engines_used: ["bing"] });
	assert.equal(parseWigoloStdout("not json at all"), undefined);
});

test("wigolo binary resolves: explicit env, then managed wrapper, then PATH", () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-web-home-"));
	assert.equal(resolveWigoloBin({ HOME: home }), "wigolo");
	mkdirSync(join(home, ".feynman", "bin"), { recursive: true });
	writeFileSync(join(home, ".feynman", "bin", "wigolo"), "#!/bin/sh\n");
	assert.equal(resolveWigoloBin({ HOME: home }), join(home, ".feynman", "bin", "wigolo"));
	assert.equal(resolveWigoloBin({ HOME: home, FEYNMAN_WIGOLO_BIN: "/custom/wigolo" }), "/custom/wigolo");
});

test("the concurrency limiter never runs more tasks than its slots", async () => {
	const limit = createSemaphore(2);
	let active = 0;
	let peak = 0;
	const task = () =>
		limit(async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
		});
	await Promise.all(Array.from({ length: 6 }, task));
	assert.equal(peak, 2);
});
