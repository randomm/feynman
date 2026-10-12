import type { Exec, ExecError } from "./exec.js";

export type WigoloSearchParams = {
	query: string;
	maxResults?: number;
	afterDate?: string;
	includeDomains?: string[];
	category?: "general" | "news" | "code" | "docs" | "papers";
	withContent?: boolean;
};

export type WigoloFetchParams = {
	url: string;
	maxChars?: number;
	section?: string;
};

export type WigoloResearchParams = {
	question: string;
	depth?: "quick" | "standard" | "comprehensive";
};

// Flags were checked against `wigolo <tool> --help` for 0.2.1. Keep them in sync
// with the pinned version in scripts/fork/install-wigolo.sh.
export function buildWigoloSearchArgs(params: WigoloSearchParams): string[] {
	const args = ["search", params.query, "--json"];
	if (params.maxResults !== undefined) args.push("--max-results", String(params.maxResults));
	if (params.afterDate) args.push("--from-date", params.afterDate);
	if (params.includeDomains?.length) args.push("--include-domains", params.includeDomains.join(","));
	if (params.category) args.push("--category", params.category);
	if (params.withContent === false) args.push("--no-content");
	return args;
}

export function buildWigoloFetchArgs(params: WigoloFetchParams): string[] {
	const args = ["fetch", params.url, "--json"];
	if (params.maxChars !== undefined) args.push("--max-content-chars", String(params.maxChars));
	if (params.section) args.push("--section", params.section);
	return args;
}

export function buildWigoloResearchArgs(params: WigoloResearchParams): string[] {
	const args = ["research", params.question, "--json"];
	if (params.depth) args.push("--depth", params.depth);
	return args;
}

// Log lines and the JSON result can share stdout. Try the pretty-printed object
// first, then the whole stream, then single-line objects from the end.
export function parseWigoloStdout(stdout: string): unknown {
	const lines = stdout.split("\n");
	const start = lines.findIndex((line) => line === "{");
	const candidates: string[] = [];
	if (start >= 0) candidates.push(lines.slice(start).join("\n"));
	candidates.push(stdout.trim());
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].startsWith("{")) candidates.push(lines[i]);
	}
	for (const candidate of candidates) {
		try {
			const parsed: unknown = JSON.parse(candidate);
			if (parsed && typeof parsed === "object") return parsed;
		} catch {
			// try the next candidate
		}
	}
	return undefined;
}

export type WigoloFailure = {
	kind: "invalid" | "infra" | "blocked" | "error";
	code: string;
	message: string;
	retryable: boolean;
};

export type WigoloOutcome =
	| { status: "ok"; data: Record<string, unknown> }
	| { status: "empty"; data: Record<string, unknown> }
	| { status: "failed"; failure: WigoloFailure };

// Codes taken from wigolo 0.2.1 dist. Anything not listed is a plain tool error:
// it is reported, but it does not trigger fallback.
const INFRA_CODES = new Set([
	"upstream_error",
	"http_error",
	"total_timeout",
	"browser_engine_unavailable",
	"playwright_not_installed",
	"playwright_fetch_failed",
]);
const BLOCKED_CODES = new Set(["fetch_failed", "blocked_by_challenge"]);
const NATIVE_MODULE_PATTERN = /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|better_sqlite3|run wigolo warmup/;

export function classifyWigoloFailure(options: {
	stdout: string;
	stderr: string;
	exitCode?: number;
	execError?: ExecError;
	tool: "search" | "fetch" | "research";
}): WigoloFailure | undefined {
	const { stdout, stderr, execError, tool } = options;
	if (execError) {
		return { kind: "infra", code: execError.code.toLowerCase(), message: execError.message, retryable: false };
	}
	const combined = `${stderr}\n${stdout}`;
	if (NATIVE_MODULE_PATTERN.test(combined)) {
		return { kind: "infra", code: "native_module", message: firstLine(combined, NATIVE_MODULE_PATTERN), retryable: false };
	}
	if (/SQLITE_BUSY/.test(combined)) {
		return { kind: "infra", code: "sqlite_busy", message: "wigolo cache was busy", retryable: true };
	}
	const payload = parseWigoloStdout(stdout);
	const code = payload && typeof (payload as { error?: unknown }).error === "string"
		? String((payload as { error: string }).error)
		: undefined;
	const message = payload && typeof (payload as { message?: unknown }).message === "string"
		? String((payload as { message: string }).message)
		: code ?? "";
	if (code === "invalid_input" || code === "invalid_url") {
		return { kind: "invalid", code, message, retryable: false };
	}
	if (code && BLOCKED_CODES.has(code)) {
		return { kind: "blocked", code, message, retryable: false };
	}
	if (code && INFRA_CODES.has(code)) {
		return { kind: "infra", code, message, retryable: false };
	}
	if (code) {
		return { kind: "error", code, message, retryable: false };
	}
	if (payload === undefined) {
		return { kind: "infra", code: "unparsable_output", message: `wigolo ${tool} returned no parseable JSON`, retryable: false };
	}
	if ((options.exitCode ?? 0) !== 0) {
		return { kind: "infra", code: `exit_${options.exitCode}`, message: firstLine(stderr || stdout, /./), retryable: false };
	}
	return undefined;
}

function firstLine(text: string, pattern: RegExp): string {
	const hit = text.split("\n").find((line) => pattern.test(line));
	return (hit ?? text.split("\n")[0] ?? "").trim().slice(0, 300);
}

// wigolo search returns `results: []` and `engines_used: []` when nothing was
// reachable. Results with engines_used present are a real, if empty, answer.
export function isEmptySearch(data: Record<string, unknown>): boolean {
	const results = Array.isArray(data.results) ? data.results : [];
	const engines = Array.isArray(data.engines_used) ? data.engines_used : [];
	return results.length === 0 && engines.length === 0;
}

export type Semaphore = <T>(task: () => Promise<T>) => Promise<T>;

export function createSemaphore(slots: number): Semaphore {
	let active = 0;
	const queue: Array<() => void> = [];
	const next = () => {
		if (active >= slots) return;
		const resume = queue.shift();
		if (resume) {
			active++;
			resume();
		}
	};
	return async <T>(task: () => Promise<T>): Promise<T> => {
		if (active >= slots) await new Promise<void>((resolve) => queue.push(resolve));
		else active++;
		try {
			return await task();
		} finally {
			active--;
			next();
		}
	};
}

export type WigoloRunOptions = {
	exec: Exec;
	bin: string;
	timeoutMs: number;
	semaphore: Semaphore;
	sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One wigolo invocation. A busy SQLite cache (other subagents share ~/.wigolo)
// gets a single jittered retry before the caller decides about fallback.
export async function runWigolo(
	options: WigoloRunOptions,
	args: string[],
	tool: "search" | "fetch" | "research",
): Promise<WigoloOutcome> {
	const sleep = options.sleep ?? defaultSleep;
	const attempt = () =>
		options.semaphore(async () => {
			try {
				const result = await options.exec(options.bin, args, {
					timeoutMs: options.timeoutMs,
					env: { ...process.env, LOG_LEVEL: "error" },
				});
				return { ...result, execError: undefined as ExecError | undefined };
			} catch (error) {
				return { stdout: "", stderr: "", exitCode: undefined, execError: error as ExecError };
			}
		});

	let run = await attempt();
	let failure = classifyWigoloFailure({ ...run, tool });
	if (failure?.retryable) {
		await sleep(200 + Math.floor(Math.random() * 400));
		run = await attempt();
		failure = classifyWigoloFailure({ ...run, tool });
	}
	if (failure) return { status: "failed", failure };

	const data = parseWigoloStdout(run.stdout) as Record<string, unknown>;
	if (tool === "search" && isEmptySearch(data)) return { status: "empty", data };
	return { status: "ok", data };
}
