import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runParallelCli } from "../parallel-search/parallel.js";
import { type Exec, execFileRunner } from "./exec.js";
import {
	buildWigoloFetchArgs,
	buildWigoloResearchArgs,
	buildWigoloSearchArgs,
	createSemaphore,
	runWigolo,
	type WigoloOutcome,
	type WigoloRunOptions,
} from "./wigolo.js";

export type WebProvider = "auto" | "wigolo" | "parallel";

export type WebToolDeps = {
	exec?: Exec;
	runParallel?: (args: string[]) => Promise<unknown>;
	env?: NodeJS.ProcessEnv;
	sleep?: (ms: number) => Promise<void>;
};

type Attempt = { provider: "wigolo" | "parallel"; ok: boolean; reason?: string };

type Routed = {
	provider: "wigolo" | "parallel";
	attempts: Attempt[];
	warnings: string[];
	payload: unknown;
	fallbackReason?: string;
	empty?: boolean;
};

type Choice = { provider: WebProvider; fallback: boolean };

type WigoloHandle = Omit<WigoloRunOptions, "timeoutMs">;

const SEARCH_TEXT_LIMIT = 20_000;
const FETCH_TEXT_LIMIT = 60_000;
const TIMEOUTS = { search: 60_000, fetch: 120_000, research: 300_000 } as const;

// Tool names are deliberately not wigolo_* or parallel_*: whichever backend
// answers, the model and the user should see the same feynman_web_* surface.
export function registerWebTools(pi: ExtensionAPI, deps: WebToolDeps = {}): void {
	const env = deps.env ?? process.env;
	const exec = deps.exec ?? execFileRunner;
	const runParallel = deps.runParallel ?? runParallelCli;
	const wigolo: WigoloHandle = {
		exec,
		bin: resolveWigoloBin(env),
		semaphore: createSemaphore(readConcurrency(env)),
		sleep: deps.sleep,
	};

	pi.registerTool({
		name: "feynman_web_search",
		label: "Web Search",
		description:
			"Search the web. Uses the local wigolo backend by default and falls back to parallel-cli when wigolo is unavailable. Pass a plain-language query.",
		promptSnippet: "feynman_web_search: web search via local wigolo (default) with parallel fallback.",
		parameters: Type.Object({
			query: Type.String({ description: "What to search for. Must not start with a dash." }),
			maxResults: Type.Optional(Type.Number({ description: "Results to return, 1-20 (default 5)." })),
			afterDate: Type.Optional(Type.String({ description: "Only results published after this date (YYYY-MM-DD)." })),
			includeDomains: Type.Optional(Type.Array(Type.String(), { description: "Restrict results to these domains (wigolo only)." })),
			category: Type.Optional(
				Type.Union(
					[Type.Literal("general"), Type.Literal("news"), Type.Literal("code"), Type.Literal("docs"), Type.Literal("papers")],
					{ description: "Search category (wigolo only)." },
				),
			),
			withContent: Type.Optional(Type.Boolean({ description: "Fetch page content for results (wigolo only; default true)." })),
			provider: Type.Optional(providerSchema()),
		}),
		async execute(_toolCallId, params) {
			validateSearch(params);
			const warnings: string[] = [];
			const choice = resolveProvider(params.provider, env, warnings);
			const routed = await routeSearch(params, choice, warnings, { wigolo, runParallel });
			return render("search", routed, SEARCH_TEXT_LIMIT);
		},
	});

	pi.registerTool({
		name: "feynman_web_fetch",
		label: "Web Fetch",
		description:
			"Fetch a web page as clean markdown. Uses the local wigolo backend by default and falls back to parallel-cli on fetch failures or bot challenges.",
		promptSnippet: "feynman_web_fetch: page-to-markdown via local wigolo (default) with parallel fallback.",
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL to fetch." }),
			maxChars: Type.Optional(Type.Number({ description: "Character limit for the returned markdown (wigolo only)." })),
			section: Type.Optional(Type.String({ description: "Heading text of one section to extract (wigolo only)." })),
			objective: Type.Optional(Type.String({ description: "Extraction goal (parallel only)." })),
			provider: Type.Optional(providerSchema()),
		}),
		async execute(_toolCallId, params) {
			validateFetch(params);
			const warnings: string[] = [];
			const choice = resolveProvider(params.provider, env, warnings);
			const routed = await routeFetch(params, choice, warnings, { wigolo, runParallel });
			return render("fetch", routed, FETCH_TEXT_LIMIT);
		},
	});

	pi.registerTool({
		name: "feynman_web_research",
		label: "Web Research",
		description:
			'Multi-step research that returns a cited brief. Runs on the local wigolo backend and never falls back to parallel automatically, because parallel research is a slower, paid deep run. Pass provider:"parallel" to use it explicitly.',
		promptSnippet: 'feynman_web_research: cited multi-source brief via local wigolo. Use provider:"parallel" only as a last resort.',
		parameters: Type.Object({
			question: Type.String({ description: "The research question." }),
			depth: Type.Optional(
				Type.Union([Type.Literal("quick"), Type.Literal("standard"), Type.Literal("comprehensive")], {
					description: "quick (~15s), standard (~40s, default), comprehensive (~80s). wigolo only.",
				}),
			),
			provider: Type.Optional(providerSchema()),
		}),
		async execute(_toolCallId, params) {
			validateResearch(params);
			const warnings: string[] = [];
			const choice = resolveProvider(params.provider, env, warnings);
			const routed = await routeResearch(params, choice, warnings, { wigolo, runParallel });
			return render("research", routed, SEARCH_TEXT_LIMIT);
		},
	});
}

function providerSchema() {
	return Type.Union([Type.Literal("auto"), Type.Literal("wigolo"), Type.Literal("parallel")], {
		description: "Backend. Default comes from FEYNMAN_WEB_PROVIDER, otherwise auto (wigolo first, then parallel).",
	});
}

// Order: explicit FEYNMAN_WIGOLO_BIN, then the wrapper written by
// scripts/fork/install-wigolo.sh, then whatever `wigolo` is on PATH.
export function resolveWigoloBin(env: NodeJS.ProcessEnv): string {
	const explicit = env.FEYNMAN_WIGOLO_BIN?.trim();
	if (explicit) return explicit;
	const managed = join(env.HOME ?? "", ".feynman", "bin", "wigolo");
	return env.HOME && existsSync(managed) ? managed : "wigolo";
}

function readConcurrency(env: NodeJS.ProcessEnv): number {
	const parsed = Number.parseInt(env.FEYNMAN_WIGOLO_CONCURRENCY ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 8) : 2;
}

export function resolveProvider(explicit: WebProvider | undefined, env: NodeJS.ProcessEnv, warnings: string[]): Choice {
	let provider: WebProvider = "auto";
	const raw = env.FEYNMAN_WEB_PROVIDER?.trim().toLowerCase();
	if (raw) {
		if (raw === "auto" || raw === "wigolo" || raw === "parallel") provider = raw;
		else warnings.push(`FEYNMAN_WEB_PROVIDER="${raw}" is not auto, wigolo or parallel; using auto`);
	}
	if (explicit) provider = explicit;
	return { provider, fallback: env.FEYNMAN_WEB_FALLBACK !== "0" };
}

type Deps = { wigolo: WigoloHandle; runParallel: (args: string[]) => Promise<unknown> };

async function routeSearch(params: SearchInput, choice: Choice, warnings: string[], deps: Deps): Promise<Routed> {
	const wigoloArgs = buildWigoloSearchArgs(params);
	return runChain({
		choice,
		warnings,
		wigolo: () => runWigolo({ ...deps.wigolo, timeoutMs: TIMEOUTS.search }, wigoloArgs, "search"),
		parallel: () => {
			const args = ["search", params.query, "--json"];
			if (params.maxResults !== undefined) args.push("--max-results", String(params.maxResults));
			if (params.afterDate) args.push("--after-date", params.afterDate);
			if (params.includeDomains?.length || params.category || params.withContent === false) {
				warnings.push("includeDomains, category and withContent are wigolo-only and were ignored");
			}
			return deps.runParallel(args);
		},
		tool: "search",
		// wigolo search with no results and no engines reached is a real failure of that backend.
		treatEmptyAsFallback: true,
	});
}

async function routeFetch(params: FetchInput, choice: Choice, warnings: string[], deps: Deps): Promise<Routed> {
	const wigoloArgs = buildWigoloFetchArgs(params);
	return runChain({
		choice,
		warnings,
		wigolo: () => runWigolo({ ...deps.wigolo, timeoutMs: TIMEOUTS.fetch }, wigoloArgs, "fetch"),
		parallel: () => {
			const args = ["fetch", params.url, "--json"];
			if (params.objective) args.push("--objective", params.objective);
			if (params.section || params.maxChars !== undefined) {
				warnings.push("section and maxChars are wigolo-only and were ignored");
			}
			return deps.runParallel(args);
		},
		tool: "fetch",
		treatEmptyAsFallback: false,
	});
}

async function routeResearch(params: ResearchInput, choice: Choice, warnings: string[], deps: Deps): Promise<Routed> {
	if (choice.provider === "parallel") {
		if (params.depth) warnings.push("depth is wigolo-only and was ignored");
		const payload = await deps.runParallel(["research", "run", params.question, "--json", "--processor", "pro-fast"]);
		return { provider: "parallel", attempts: [{ provider: "parallel", ok: true }], warnings, payload };
	}
	// Research never falls back silently: parallel research is slow and paid.
	const outcome = await runWigolo(
		{ ...deps.wigolo, timeoutMs: TIMEOUTS.research },
		buildWigoloResearchArgs(params),
		"research",
	);
	if (outcome.status !== "ok") {
		const failure = outcome.status === "failed" ? outcome.failure : undefined;
		const detail = failure ? `${failure.code}: ${failure.message}` : "no data returned";
		throw new Error(`wigolo research failed (${detail}). For a slower, paid parallel deep run, retry with provider:"parallel".`);
	}
	// sampling_supported in the payload reports MCP client sampling, not LLM
	// availability, so it is not used as a template signal.
	return { provider: "wigolo", attempts: [{ provider: "wigolo", ok: true }], warnings, payload: outcome.data };
}

async function runChain(options: {
	choice: Choice;
	warnings: string[];
	wigolo: () => Promise<WigoloOutcome>;
	parallel: () => Promise<unknown>;
	tool: "search" | "fetch";
	treatEmptyAsFallback: boolean;
}): Promise<Routed> {
	const { choice, warnings } = options;
	const attempts: Attempt[] = [];

	if (choice.provider === "parallel") {
		const payload = await options.parallel();
		return { provider: "parallel", attempts: [{ provider: "parallel", ok: true }], warnings, payload };
	}

	const outcome = await options.wigolo();
	if (outcome.status === "ok") {
		attempts.push({ provider: "wigolo", ok: true });
		return { provider: "wigolo", attempts, warnings, payload: outcome.data };
	}

	if (outcome.status === "empty") {
		attempts.push({ provider: "wigolo", ok: true, reason: "no results" });
		const canFallBack = options.treatEmptyAsFallback && choice.provider === "auto" && choice.fallback;
		if (!canFallBack) return { provider: "wigolo", attempts, warnings, payload: outcome.data, empty: true };
		return fallbackTo(options, attempts, "wigolo returned no results");
	}

	const { failure } = outcome;
	attempts.push({ provider: "wigolo", ok: false, reason: `${failure.code}: ${failure.message}` });
	if (failure.kind === "invalid") throw new Error(`invalid_input: ${failure.message}`);
	const fallbackEligible = failure.kind === "infra" || (failure.kind === "blocked" && options.tool === "fetch");
	if (choice.provider === "wigolo" || !choice.fallback || !fallbackEligible) throw attemptsError(attempts);
	return fallbackTo(options, attempts, failure.code);
}

async function fallbackTo(
	options: { parallel: () => Promise<unknown>; warnings: string[] },
	attempts: Attempt[],
	reason: string,
): Promise<Routed> {
	try {
		const payload = await options.parallel();
		attempts.push({ provider: "parallel", ok: true });
		return { provider: "parallel", attempts, warnings: options.warnings, payload, fallbackReason: reason };
	} catch (error) {
		attempts.push({ provider: "parallel", ok: false, reason: error instanceof Error ? error.message : String(error) });
		throw attemptsError(attempts);
	}
}

function attemptsError(attempts: Attempt[]): Error {
	const lines = attempts.map((a) => `  - ${a.provider}: ${a.ok ? "ok" : "failed"}${a.reason ? ` (${a.reason})` : ""}`);
	return new Error(`Web backends failed:\n${lines.join("\n")}`);
}

function render(tool: "search" | "fetch" | "research", routed: Routed, limit: number) {
	const header = routed.fallbackReason
		? `[backend: ${routed.provider} | fallback from ${routed.attempts[0]?.provider ?? "wigolo"}: ${routed.fallbackReason}]`
		: `[backend: ${routed.provider}]`;
	const body = typeof routed.payload === "string" ? routed.payload : JSON.stringify(routed.payload, null, 2);
	const notes = routed.warnings.length ? `\n[warnings: ${routed.warnings.join("; ")}]` : "";
	const empty = routed.empty ? "\n[no results]" : "";
	return {
		content: [{ type: "text" as const, text: `${header}${notes}${empty}\n${trimText(body, limit)}` }],
		details: {
			tool,
			provider: routed.provider,
			attempts: routed.attempts,
			warnings: routed.warnings,
			empty: routed.empty ?? false,
			payload: routed.payload,
		},
	};
}

function trimText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n[truncated: ${value.length - maxChars} chars omitted]`;
}

type SearchInput = {
	query: string;
	maxResults?: number;
	afterDate?: string;
	includeDomains?: string[];
	category?: "general" | "news" | "code" | "docs" | "papers";
	withContent?: boolean;
	provider?: WebProvider;
};
type FetchInput = { url: string; maxChars?: number; section?: string; objective?: string; provider?: WebProvider };
type ResearchInput = { question: string; depth?: "quick" | "standard" | "comprehensive"; provider?: WebProvider };

function validateSearch(params: SearchInput): void {
	const query = params.query.trim();
	if (!query || query.startsWith("-")) throw invalid("query must be non-empty and must not start with a dash");
	if (params.maxResults !== undefined && (!Number.isInteger(params.maxResults) || params.maxResults < 1 || params.maxResults > 20)) {
		throw invalid("maxResults must be an integer from 1 to 20");
	}
	if (params.afterDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(params.afterDate)) throw invalid("afterDate must be YYYY-MM-DD");
}

function validateFetch(params: FetchInput): void {
	if (!/^https?:\/\/\S+$/.test(params.url)) throw invalid("url must be an absolute http(s) URL");
	if (params.maxChars !== undefined && (!Number.isInteger(params.maxChars) || params.maxChars < 1)) {
		throw invalid("maxChars must be a positive integer");
	}
}

function validateResearch(params: ResearchInput): void {
	if (!params.question.trim()) throw invalid("question must be non-empty");
}

function invalid(message: string): Error {
	return new Error(`invalid_input: ${message}`);
}
