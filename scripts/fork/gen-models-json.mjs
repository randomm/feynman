#!/usr/bin/env node
// Fork-owned. Regenerates ~/.feynman/agent/models.json with the custom providers
// this fork relies on. Safe to re-run; it backs up any existing file.
//
//   node scripts/fork/gen-models-json.mjs
//
// Needs NEBIUS_API_KEY and TRAIL_OPENERS_LLM_KEY to exist as env vars only so the
// generated file can *reference* them ($VAR). Keys are never written to disk.
//
// Metadata provenance - nothing here is hand-guessed:
//   compat / reasoning / input   <- Pi's own huggingface.json catalogue, which uses
//                                   the exact same model ids as Nebius
//   cost                         <- Nebius public /api/public/models_info
//   contextWindow                <- Nebius models_info max_model_len, overridden by
//                                   values probed against the live API where the two
//                                   disagree (models_info reports a placeholder 8000
//                                   for several 1M-context models)
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
const HF_CATALOGUE = join(REPO, "node_modules/@earendil-works/pi-ai/dist/providers/data/huggingface.json");
const OUT = join(homedir(), ".feynman/agent/models.json");
const NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
const NEBIUS_INFO_URL = "https://tokenfactory.nebius.com/api/public/models_info";

// Context windows verified by probing the live Nebius API. Where Nebius's own
// models_info disagrees (it reports max_model_len=8000 for several of these),
// the probed value is what the endpoint actually enforces.
const PROBED_CONTEXT = {
	"deepseek-ai/DeepSeek-V4-Pro": 1048576,
	"deepseek-ai/DeepSeek-V4-Flash": 1048576,
	"moonshotai/Kimi-K3": 1048576,
	"moonshotai/Kimi-K2.7-Code": 262144,
	"zai-org/GLM-5.2": 1048576,
	"zai-org/GLM-5.1": 202752,
	"MiniMaxAI/MiniMax-M3": 1048576,
	"MiniMaxAI/MiniMax-M2.5": 196608,
	"Qwen/Qwen3-32B": 40960,
	"openai/gpt-oss-120b": 131072,
	"meta-llama/Llama-3.3-70B-Instruct": 131072,
};

// Feynman sends ~25k tokens of fixed overhead per request (~9.6k system prompt +
// ~15.4k of tool definitions, measured on the wire). A model needs materially more
// context than that to be useful, so anything below this is dropped with a reason.
const MIN_CONTEXT_WINDOW = 100_000;

// Nebius's reasoning parser does not handle these: they emit raw <think> blocks
// into message.content instead of reasoning_content, which wastes output tokens and
// pollutes answers. Verified by direct API probe.
const BROKEN_REASONING_PARSE = new Set(["Qwen/Qwen3-32B"]);

// Pi's huggingface.json entry is wrong for these; verified against the live endpoint.
const REASONING_OVERRIDE = { "Qwen/Qwen3-Next-80B-A3B-Thinking": true };

// Nebius ids for which Pi ships an exact-id catalogue entry (so compat is authoritative).
const NEBIUS_MODELS = [
	"deepseek-ai/DeepSeek-V4-Pro",
	"deepseek-ai/DeepSeek-V4-Flash",
	"moonshotai/Kimi-K3",
	"moonshotai/Kimi-K2.7-Code",
	"moonshotai/Kimi-K2.6",
	"zai-org/GLM-5.2",
	"zai-org/GLM-5.1",
	"MiniMaxAI/MiniMax-M3",
	"MiniMaxAI/MiniMax-M2.5",
	"Qwen/Qwen3-Next-80B-A3B-Thinking",
	"Qwen/Qwen3-32B",
	"openai/gpt-oss-120b",
	"meta-llama/Llama-3.3-70B-Instruct",
];

const TRAIL_OPENERS_BASE_URL = "https://llm.trailopeners.com/v1";

function flattenCatalogue(raw) {
	const flat = {};
	for (const api of Object.keys(raw)) for (const [id, model] of Object.entries(raw[api])) flat[id] = model;
	return flat;
}

async function fetchJson(url, headers = {}) {
	const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
	return response.json();
}

const hf = flattenCatalogue(JSON.parse(readFileSync(HF_CATALOGUE, "utf8")));

const infoRaw = await fetchJson(NEBIUS_INFO_URL);
const infoArr = Array.isArray(infoRaw) ? infoRaw : infoRaw.data || infoRaw.models || Object.values(infoRaw)[0];
// A model can list several flavors, including fine-tuning ones that report a
// placeholder max_model_len of 8000. Keep the flavor with the largest context so a
// fine-tune entry never masks the real inference limit.
const nebiusInfo = {};
for (const model of infoArr) {
	for (const flavor of model.flavors || []) {
		const existing = nebiusInfo[flavor.model_id];
		if (!existing || (flavor.max_model_len ?? 0) > (existing.max_model_len ?? 0)) {
			nebiusInfo[flavor.model_id] = flavor;
		}
	}
}

const nebiusModels = [];
for (const id of NEBIUS_MODELS) {
	const base = hf[id];
	const nb = nebiusInfo[id];
	if (!base) { console.error(`skip ${id}: no Pi catalogue entry (upstream changed?)`); continue; }
	if (!nb) { console.error(`skip ${id}: Nebius no longer serves it`); continue; }

	// models_info reports a placeholder max_model_len of 8000 for several models whose
	// endpoint actually serves far more (Kimi-K2.6: 8000 reported, 262144 real). Take the
	// larger of max_model_len and context_window_k*1000 — the latter never over-states,
	// so a wrong guess errs toward a smaller, safe context rather than failing requests.
	const contextWindow =
		PROBED_CONTEXT[id] ??
		Math.max(nb.max_model_len ?? 0, (nb.context_window_k ?? 0) * 1000) ??
		base.contextWindow;
	if (contextWindow < MIN_CONTEXT_WINDOW) {
		console.error(`skip ${id}: context ${contextWindow} < ${MIN_CONTEXT_WINDOW}; Feynman's ~25k-token prompt leaves too little room`);
		continue;
	}
	if (BROKEN_REASONING_PARSE.has(id)) {
		console.error(`skip ${id}: Nebius emits raw <think> into content instead of reasoning_content`);
		continue;
	}

	const tps = nb.tokens_per_second ? `, ${Math.round(nb.tokens_per_second)} tok/s` : "";
	const entry = {
		id,
		name: `${nb.model_name || id.split("/").pop()} (Nebius ${nb.regions?.[0]?.name ?? "?"}${tps})`,
		reasoning: REASONING_OVERRIDE[id] ?? base.reasoning ?? false,
		input: base.input ?? ["text"],
		cost: {
			input: nb.input_price_per_million_tokens ?? 0,
			output: nb.output_price_per_million_tokens ?? 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow,
		// Nebius rejects max_tokens > context.
		maxTokens: Math.min(base.maxTokens ?? 32768, contextWindow),
	};
	if (base.compat) entry.compat = base.compat;
	if (base.thinkingLevelMap) entry.thinkingLevelMap = base.thinkingLevelMap;
	nebiusModels.push(entry);
	console.error(`ok  ${id.padEnd(38)} ctx=${String(contextWindow).padStart(7)} $${entry.cost.input}/${entry.cost.output} per M  ${nb.regions?.[0]?.name ?? "?"}`);
}

// Trail Openers runs vLLM, which reports max_model_len over /v1/models - so the
// live server is the source of truth for both the model list and its context.
//
// Thinking is deliberately OFF (reasoning: false), matching the hand-maintained Pi
// config at ~/.pi/agent/models.json. Beyond parity, the endpoint rejects
// reasoning_effort "high" ("Supported types are xhigh (default), medium, and low"),
// and Feynman's researcher agent runs at `thinking: high` - so enabling reasoning
// here would fail every research delegation. low/medium/xhigh are accepted.
const toKey = process.env.TRAIL_OPENERS_LLM_KEY;
const toModels = [];
try {
	const listed = await fetchJson(`${TRAIL_OPENERS_BASE_URL}/models`, toKey ? { Authorization: `Bearer ${toKey}` } : {});
	for (const m of listed.data || []) {
		const contextWindow = m.max_model_len ?? 262144;
		toModels.push({
			id: m.id,
			name: `${m.id.split("/").pop()} (Trail Openers H100)`,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow,
			maxTokens: Math.min(32768, contextWindow),
			compat: {
				supportsReasoningEffort: true,
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
		});
		console.error(`ok  ${m.id.padEnd(38)} ctx=${String(contextWindow).padStart(7)} (Trail Openers, live)`);
	}
} catch (error) {
	console.error(`WARN Trail Openers unreachable (${error.message}); leaving that provider out.`);
}

const providers = {
	nebius: {
		api: "openai-completions",
		baseUrl: NEBIUS_BASE_URL,
		apiKey: "$NEBIUS_API_KEY",
		models: nebiusModels,
	},
};
if (toModels.length > 0) {
	providers["trailopeners-h100"] = {
		api: "openai-completions",
		baseUrl: TRAIL_OPENERS_BASE_URL,
		apiKey: "$TRAIL_OPENERS_LLM_KEY",
		models: toModels,
	};
}

if (existsSync(OUT)) {
	copyFileSync(OUT, `${OUT}.bak`);
	console.error(`\nbacked up existing models.json -> ${OUT}.bak`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ providers }, null, 2)}\n`, "utf8");
chmodSync(OUT, 0o600); // may contain headers; keep user-only regardless
console.error(`\nwrote ${OUT}`);
console.error(`  nebius: ${nebiusModels.length} models | trailopeners-h100: ${toModels.length} models`);
console.error("verify with: feynman model list");
