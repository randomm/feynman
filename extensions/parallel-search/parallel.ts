import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const execFileAsync = promisify(execFile);

function formatText(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

async function runParallelCli(args: string[]): Promise<unknown> {
	try {
		const { stdout } = await execFileAsync("parallel-cli", args);

		let parsed: unknown;
		try {
			parsed = JSON.parse(stdout);
		} catch {
			return stdout;
		}

		if (parsed && typeof parsed === "object" && "status" in parsed) {
			if ((parsed as { status?: string }).status === "error") {
				const err = parsed as Record<string, unknown>;
				const errorDetail =
					typeof err.error === "string" ? err.error :
					typeof err.message === "string" ? err.message :
					JSON.stringify(parsed);
				throw new Error(`parallel-cli error: ${errorDetail}`);
			}
		}

		return parsed;
	} catch (error) {
		if (error instanceof Error) {
			const hasStderr = "stderr" in error && typeof (error as Record<string, unknown>).stderr === "string";
			if (hasStderr) {
				const sanitized = String((error as Record<string, unknown>).stderr).substring(0, 500);
				throw new Error(`parallel-cli failed: ${sanitized}`);
			}
			throw error;
		}
		throw new Error(String(error));
	}
}

export function registerParallelTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "parallel_search",
		label: "Parallel Search",
		description:
			"Search the web using parallel-cli. Fast, no API key required. Use for all routine web queries. Pass a natural language objective. Options: mode (fast|one-shot|agentic, default fast), maxResults (default 10), afterDate (YYYY-MM-DD).",
		parameters: Type.Object({
			objective: Type.String({
				description: "Natural language search objective describing what to find",
			}),
			mode: Type.Optional(
				Type.String({
					description: "Search mode: fast, one-shot, or agentic (default: fast)",
				}),
			),
			maxResults: Type.Optional(
				Type.Number({ description: "Maximum number of results (default: 10)" }),
			),
			afterDate: Type.Optional(
				Type.String({
					description: "Filter results after this date (format: YYYY-MM-DD)",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const args = ["search", params.objective, "--json"];

			if (params.mode) {
				args.push("--mode", params.mode);
			}
			if (params.maxResults !== undefined) {
				const n = Math.floor(Number(params.maxResults));
				if (!Number.isFinite(n) || n < 1) throw new Error("maxResults must be a positive integer");
				args.push("--max-results", String(n));
			}
			if (params.afterDate) {
				args.push("--after-date", params.afterDate);
			}

			const result = await runParallelCli(args);
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "parallel_fetch",
		label: "Parallel Fetch",
		description:
			"Extract clean markdown content from a URL using parallel-cli. Use when you have a specific URL and need its full content.",
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch content from" }),
			objective: Type.Optional(
				Type.String({
					description: "Optional objective to guide extraction (e.g., 'extract summary')",
				}),
			),
			fullContent: Type.Optional(
				Type.Boolean({ description: "Extract full content (default: false)" }),
			),
		}),
		async execute(_toolCallId, params) {
			const args = ["fetch", params.url, "--json"];

			if (params.objective) {
				args.push("--objective", params.objective);
			}
			if (params.fullContent) {
				args.push("--full-content");
			}

			const result = await runParallelCli(args);
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "parallel_research",
		label: "Parallel Research",
		description:
			"Deep async multi-source research using parallel-cli. WARNING: This is slow (30 seconds to 5+ minutes) and costs more money. Use ONLY as a last resort when parallel_search results are clearly insufficient for the question. Prefer parallel_search for all routine queries.",
		parameters: Type.Object({
			question: Type.String({
				description: "Research question to investigate deeply",
			}),
			processor: Type.Optional(
				Type.String({
					description:
						"Processing tier: lite-fast (10-20s), core-fast (15-100s), pro-fast (30s-5min, default), ultra-fast (1-10min)",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const args = [
				"research", "run",
				params.question,
				"--json",
				"--processor", params.processor ?? "pro-fast",
			];

			const result = await runParallelCli(args);
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});
}