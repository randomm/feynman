import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiWebAccessVersion,
	PI_WEB_ACCESS_REQUIRED_VERSION,
	patchPiWebAccessSource,
} from "../scripts/lib/pi-web-access-patch.mjs";

test("package artifact verification checks every pi-web-access patch target", () => {
	const source = readFileSync(
		join(import.meta.dirname, "..", "scripts", "verify-package-artifact.mjs"),
		"utf8",
	);

	assert.match(source, /PI_WEB_ACCESS_PATCH_TARGETS\.map\(\(relativePath\) =>/);
	assert.match(source, /`npm\/node_modules\/pi-web-access\/\$\{relativePath\}`/);
});

test("patchPiWebAccessSource rewrites legacy Pi web-search config paths", () => {
	const input = [
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		'const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("perplexity.ts", input);

	assert.match(patched, /FEYNMAN_WEB_SEARCH_CONFIG/);
	assert.match(patched, /PI_WEB_SEARCH_CONFIG/);
});

test("patchPiWebAccessSource keeps current upstream config helpers on Feynman's exact config file", () => {
	const input = [
		'import { join } from "node:path";',
		"export function getWebSearchConfigDir(): string {",
		"\tif (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;",
		'\treturn "/tmp/.pi";',
		"}",
		"export function getWebSearchConfigPath(): string {",
		'\treturn join(getWebSearchConfigDir(), "web-search.json");',
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("utils.ts", input);

	assert.match(patched, /process\.env\.FEYNMAN_WEB_SEARCH_CONFIG\?\.trim\(\)/);
	assert.match(patched, /process\.env\.PI_WEB_SEARCH_CONFIG\?\.trim\(\)/);
	assert.match(patched, /configuredPath \|\| join\(getWebSearchConfigDir\(\), "web-search\.json"\)/);
	assert.equal(patchPiWebAccessSource("utils.ts", patched), patched);
});

test("patchPiWebAccessSource updates index.ts directory handling", () => {
	const input = [
		'import { existsSync, mkdirSync } from "node:fs";',
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		'const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		'const dir = join(homedir(), ".pi");',
		'pi.registerCommand("search", { description: "Browse stored web search results" });',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /import \{ dirname, join \} from "node:path";/);
	assert.match(patched, /const dir = dirname\(WEB_SEARCH_CONFIG_PATH\);/);
	assert.match(patched, /pi\.registerCommand\("web-results",/);
	assert.doesNotMatch(patched, /pi\.registerCommand\("search",/);
});

test("patchPiWebAccessSource defaults workflow to none for index.ts without disabling explicit summary-review", () => {
	const input = [
		'function resolveWorkflow(input: unknown, hasUI: boolean): WebSearchWorkflow {',
		'\tif (!hasUI) return "none";',
		'\tif (typeof input === "string" && input.trim().toLowerCase() === "none") return "none";',
		'\treturn "summary-review";',
		'}',
		'const configWorkflow = loadConfigForExtensionInit().workflow;',
		'const workflow = resolveWorkflow(params.workflow ?? configWorkflow, ctx?.hasUI !== false);',
		'workflow: Type.Optional(',
		'\tStringEnum(["none", "summary-review"], {',
		'\t\tdescription: "Search workflow mode: none = no curator, summary-review = open curator with auto summary draft (default)",',
		'\t}),',
		'),',
		'Searches auto-open the interactive browser curator and stream results live; set workflow to "none" to skip curation or "auto-summary" for a model-generated summary without the browser curator. Without a configured provider, auto-selects OpenAI, Exa, Gemini API, or Gemini Web. When SearXNG is configured, it is preferred first.',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /params\.workflow \?\? configWorkflow \?\? "none"/);
	assert.match(patched, /return "summary-review";/);
	assert.match(patched, /summary-review = open curator with auto summary draft \(opt-in\)/);
	assert.match(patched, /or opt-in Gemini Web/);
	assert.match(patched, /Searches return directly by default/);
	assert.match(patched, /set workflow to "summary-review" to open the interactive browser curator/);
});

test("patchPiWebAccessSource disables Gemini Web cookie access by default", () => {
	const input = [
		"interface GeminiWebConfig {",
		"\tchromeProfile?: string;",
		"}",
		"let raw: { chromeProfile?: unknown };",
		"cachedConfig = {",
		"\t\tchromeProfile: normalizeChromeProfile(raw.chromeProfile),",
		"\t};",
		"function normalizeChromeProfile(value: unknown): string | undefined {",
		'\tif (typeof value !== "string") return undefined;',
		"\tconst normalized = value.trim();",
		"\treturn normalized.length > 0 ? normalized : undefined;",
		"}",
		"function getChromeProfileFromConfig(): string | undefined {",
		"\treturn loadConfig().chromeProfile;",
		"}",
		"export async function isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null> {",
		"\tconst result = await getGoogleCookies({",
		"\t\tprofile: normalizeChromeProfile(chromeProfile) ?? getChromeProfileFromConfig(),",
		"\t\trequiredCookies: REQUIRED_COOKIES,",
		"\t});",
		"\tif (!result) return null;",
		"\treturn result.cookies;",
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("gemini-web.ts", input);

	assert.match(patched, /geminiBrowser\?: boolean/);
	assert.match(patched, /normalizeBooleanFlag\(raw\.geminiBrowser \?\? raw\.allowBrowserAuth \?\? raw\.browserAuth\)/);
	assert.match(patched, /if \(!config\.geminiBrowser\) return null/);
	assert.doesNotMatch(patched, /getChromeProfileFromConfig\(\)/);
});

test("patchPiWebAccessSource keeps Gemini Web config opt-in across current upstream aliases", () => {
	const input = [
		'import { existsSync, readFileSync } from "node:fs";',
		'import { homedir } from "node:os";',
		'import { join } from "node:path";',
		'const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"interface GeminiWebConfig {",
		"\tchromeProfile?: string;",
		"\tallowBrowserCookies?: boolean;",
		"}",
		"function loadConfig(): GeminiWebConfig {",
		'\tlet raw: { chromeProfile?: unknown; allowBrowserCookies?: unknown };',
		"\ttry {",
		'\t\traw = JSON.parse(rawText) as { chromeProfile?: unknown; allowBrowserCookies?: unknown };',
		"\t} catch {}",
		"\tcachedConfig = {",
		"\t\tchromeProfile: normalizeChromeProfile(raw.chromeProfile),",
		"\t\tallowBrowserCookies: raw.allowBrowserCookies === true,",
		"\t};",
		"\treturn cachedConfig;",
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("gemini-web-config.ts", input);

	assert.match(patched, /process\.env\.FEYNMAN_WEB_SEARCH_CONFIG/);
	assert.match(patched, /geminiBrowser\?: boolean/);
	assert.match(patched, /allowBrowserAuth\?: boolean/);
	assert.match(patched, /browserAuth\?: boolean/);
	assert.match(patched, /function normalizeBooleanFlag/);
	assert.match(patched, /normalizeBooleanFlag\(raw\.allowBrowserCookies\) \|\| normalizeBooleanFlag\(raw\.geminiBrowser\)/);
});

test("patchPiWebAccessSource changes Gemini search browser fallback messaging to opt-in", () => {
	const input = [
		'throw new Error("Gemini search unavailable. Either:\\n" +',
		'\t"  1. Set GEMINI_API_KEY in ~/.pi/web-search.json\\n" +',
		'\t"  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for routing\\n" +',
		'\t"  3. Sign into gemini.google.com in a supported Chromium-based browser"',
		");",
		'throw new Error("No search provider available. Either:\\n" +',
		'\t"  1. Set perplexityApiKey in ~/.pi/web-search.json\\n" +',
		'\t"  5. Sign into gemini.google.com in a supported Chromium-based browser"',
		");",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("gemini-search.ts", input);

	assert.doesNotMatch(patched, /Sign into gemini\.google\.com/);
	assert.match(patched, /Opt into Gemini Web browser-cookie access/);
	assert.match(patched, /\\"geminiBrowser\\": true/);
});

test("patchPiWebAccessSource is idempotent", () => {
	const input = [
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		'const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
	].join("\n");

	const once = patchPiWebAccessSource("perplexity.ts", input);
	const twice = patchPiWebAccessSource("perplexity.ts", once);

	assert.equal(twice, once);
});

test("patchPiWebAccessSource binds nested web model calls to Pi's resolved session scope", async () => {
	const scopeSource = [
		'import { existsSync, readFileSync } from "node:fs";',
		'import { homedir } from "node:os";',
		'import { join } from "node:path";',
		"",
		'const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);',
		"",
		"interface SummaryModelScopeContext {",
		"\tcwd: string;",
		"\tisProjectTrusted(): boolean;",
		"}",
		"",
		"export interface ModelLike {",
		"\tprovider: string;",
		"\tid: string;",
		"}",
		"",
		"function getAgentDir(): string {",
		'\treturn process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");',
		"}",
		"",
		"function readSettings(path: string): Record<string, unknown> {",
		"\tif (!existsSync(path)) return {};",
		'\tconst raw = readFileSync(path, "utf8");',
		"\ttry {",
		"\t\treturn JSON.parse(raw) as Record<string, unknown>;",
		"\t} catch (err) {",
		"\t\tconst message = err instanceof Error ? err.message : String(err);",
		"\t\tthrow new Error(`Failed to parse ${path}: ${message}`);",
		"\t}",
		"}",
		"",
		"export function loadEnabledModelPatterns(ctx: SummaryModelScopeContext): string[] | null {",
		'\tconst globalSettings = readSettings(join(getAgentDir(), "settings.json"));',
		"\tconst projectSettings = ctx.isProjectTrusted()",
		'\t\t? readSettings(join(ctx.cwd, ".pi", "settings.json"))',
		"\t\t: {};",
		'\tconst value = Object.hasOwn(projectSettings, "enabledModels")',
		"\t\t? projectSettings.enabledModels",
		"\t\t: globalSettings.enabledModels;",
		"\tif (value === undefined) return null;",
		'\tif (!Array.isArray(value)) throw new Error("enabledModels must be an array");',
		"\treturn value",
		'\t\t.filter((item): item is string => typeof item === "string")',
		"\t\t.map(item => item.trim())",
		"\t\t.filter(Boolean);",
		"}",
		"",
		"export function summaryModelValue(model: ModelLike): string {",
		"\treturn `${model.provider}/${model.id}`;",
		"}",
	].join("\n");

	const patchedScope = patchPiWebAccessSource("summary-model-scope.ts", scopeSource);
	assert.match(patchedScope, /scopedModels: readonly \{ model: ModelLike \}\[\]/);
	assert.match(patchedScope, /ctx\.scopedModels\.length === 0/);
	assert.match(patchedScope, /ctx\.scopedModels\.map\(\(\{ model \}\) => summaryModelValue\(model\)\)/);
	assert.match(patchedScope, /export function modelMatchesScopedModels/);
	assert.match(patchedScope, /"xhigh", "max"/);
	assert.doesNotMatch(patchedScope, /readSettings|PI_CODING_AGENT_DIR|\.pi.*settings\.json/);
	assert.equal(patchPiWebAccessSource("summary-model-scope.ts", patchedScope), patchedScope);

	const fixtureRoot = mkdtempSync(join(tmpdir(), "feynman-web-model-scope-"));
	const fixturePath = join(fixtureRoot, "summary-model-scope.ts");
	writeFileSync(fixturePath, patchedScope, "utf8");
	try {
		const scopeModule = await import(`${pathToFileURL(fixturePath).href}?v=${Date.now()}`);
		assert.deepEqual(
			scopeModule.loadEnabledModelPatterns({
				scopedModels: [{ model: { provider: "openai", id: "gpt-5.5" } }],
			}),
			["openai/gpt-5.5"],
		);
		assert.equal(scopeModule.loadEnabledModelPatterns({ scopedModels: [] }), null);
		assert.equal(
			scopeModule.modelMatchesScopedModels(
				{ provider: "openai", id: "gpt-5.5" },
				[{ model: { provider: "openai", id: "gpt-5.5" } }],
			),
			true,
		);
		assert.equal(
			scopeModule.modelMatchesScopedModels(
				{ provider: "openai", id: "gpt-5.5" },
				[{ model: { provider: "anthropic", id: "claude-opus-4-7" } }],
			),
			false,
		);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}

	const summaryReviewSource =
		'export type SummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry" | "cwd" | "isProjectTrusted">;';
	const patchedReview = patchPiWebAccessSource("summary-review.ts", summaryReviewSource);
	assert.match(patchedReview, /"modelRegistry" \| "scopedModels" \| "cwd"/);
	assert.equal(patchPiWebAccessSource("summary-review.ts", patchedReview), patchedReview);
});

test("patchPiWebAccessSource uses direct Pi session-scope membership at every nested model call", () => {
	const pageQuerySource = [
		'import { loadEnabledModelPatterns, modelMatchesEnabledPatterns } from "./summary-model-scope.ts";',
		"function resolveModel(ctx, model) {",
		"\tif (!modelMatchesEnabledPatterns(model, loadEnabledModelPatterns(ctx))) throw new Error();",
		"}",
	].join("\n");
	const patchedPageQuery = patchPiWebAccessSource("page-query.ts", pageQuerySource);
	assert.match(patchedPageQuery, /import \{ modelMatchesScopedModels \}/);
	assert.match(patchedPageQuery, /modelMatchesScopedModels\(model, ctx\.scopedModels\)/);
	assert.doesNotMatch(patchedPageQuery, /loadEnabledModelPatterns|modelMatchesEnabledPatterns/);

	const summaryReviewSource = [
		'import { findModelWithProviderRouting, loadEnabledModelPatterns, modelMatchesEnabledPatterns } from "./summary-model-scope.ts";',
		'export type SummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry" | "cwd" | "isProjectTrusted">;',
		"async function resolve(ctx) {",
		"\tconst enabledModelPatterns = loadEnabledModelPatterns(ctx);",
		"\tif (!modelMatchesEnabledPatterns(model, enabledModelPatterns)) throw new Error();",
		"}",
	].join("\n");
	const patchedReview = patchPiWebAccessSource("summary-review.ts", summaryReviewSource);
	assert.match(patchedReview, /modelMatchesScopedModels\(model, ctx\.scopedModels\)/);
	assert.doesNotMatch(patchedReview, /loadEnabledModelPatterns|modelMatchesEnabledPatterns/);
});

test("patchPiWebAccessSource carries Pi scoped models into every nested summary context", () => {
	const input = [
		"const first: SummaryGenerationContext = {",
		"\tmodel: ctx.model,",
		"\tmodelRegistry: ctx.modelRegistry,",
		"\tcwd: ctx.cwd,",
		"\tisProjectTrusted: () => ctx.isProjectTrusted(),",
		"};",
		"const second: SummaryGenerationContext = {",
		"\t\tmodel: ctx.model,",
		"\t\tmodelRegistry: ctx.modelRegistry,",
		"\t\tcwd: ctx.cwd,",
		"\t\tisProjectTrusted: () => ctx.isProjectTrusted(),",
		"};",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);
	assert.equal(patched.match(/get scopedModels\(\) \{ return ctx\.scopedModels; \}/g)?.length, 2);
	assert.doesNotMatch(patched, /scopedModels: ctx\.scopedModels/);
	assert.equal(patchPiWebAccessSource("index.ts", patched), patched);

	const runnable = patchPiWebAccessSource("index.ts", [
		"const summaryContext = {",
		"\tmodelRegistry: ctx.modelRegistry,",
		"\tcwd: ctx.cwd,",
		"};",
		"return summaryContext;",
	].join("\n"));
	const firstScope = [{ model: { provider: "openai", id: "gpt-5.5" } }];
	const secondScope = [{ model: { provider: "anthropic", id: "claude-haiku-4-5" } }];
	const ctx = { modelRegistry: {}, cwd: "/tmp", scopedModels: firstScope };
	const summaryContext = Function("ctx", runnable)(ctx);
	assert.equal(summaryContext.scopedModels, firstScope);
	ctx.scopedModels = secondScope;
	assert.equal(summaryContext.scopedModels, secondScope);
});

test("pi-web-access patch is exact-version gated and rejects unknown model-scope layouts", () => {
	assert.equal(PI_WEB_ACCESS_REQUIRED_VERSION, "0.18.0");
	assert.doesNotThrow(() => assertPiWebAccessVersion("0.18.0", "test"));
	assert.throws(
		() => assertPiWebAccessVersion("0.19.0", "future"),
		/expected 0\.18\.0, found 0\.19\.0/,
	);

	const futureSource = [
		'import { existsSync, readFileSync } from "node:fs";',
		'import { homedir } from "node:os";',
		'import { join } from "node:path";',
		'const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);',
		"interface SummaryModelScopeContext {",
		"\tcwd: string;",
		"\tisProjectTrusted(): boolean;",
		"}",
		"function getAgentDir(): string {",
		'\treturn process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");',
		"}",
		"function futureScopeHelper(): string { return \"preserve-me\"; }",
		"export function loadEnabledModelPatterns(): string[] | null { return null; }",
	].join("\n");
	assert.throws(
		() => patchPiWebAccessSource("summary-model-scope.ts", futureSource),
		/Unsupported pi-web-access 0\.18\.0 summary model scope layout/,
	);
	assert.match(futureSource, /futureScopeHelper/);
});

test("patchPiWebAccessSource bounds web_search query calls with a deadline in index.ts", () => {
	const input = [
		"const MAX_INLINE_CONTENT = 30000; // Content returned directly to agent",
		"",
		"async function run() {",
		"\t\t\t\t\tconst response = await search(queryList[qi], {",
		"\t\t\t\t\t\tprovider: requestedProvider,",
		"\t\t\t\t\t});",
		"\t\t\t\tconst { answer, results, inlineContent, provider } = await search(query, {",
		"\t\t\t\t\tprovider: resolvedProvider,",
		"\t\t\t\t});",
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /const SEARCH_CALL_TIMEOUT_MS = 90000;/);
	assert.match(patched, /async function searchWithDeadline\(/);
	assert.match(patched, /const response = await searchWithDeadline\(queryList\[qi\], \{/);
	assert.match(patched, /await searchWithDeadline\(query, \{/);
	assert.doesNotMatch(patched, /await search\(/);

	const twice = patchPiWebAccessSource("index.ts", patched);
	assert.equal(twice, patched);
});

test("patchPiWebAccessSource keeps current fetched PDF scratch files inside the project", () => {
	const source = [
		'import { join, basename } from "node:path";',
		'import { tmpdir } from "node:os";',
		'const DEFAULT_OUTPUT_DIR = join(tmpdir(), "pi-web-pdf");',
	].join("\n");

	const patched = patchPiWebAccessSource("pdf-extract.ts", source);

	assert.match(patched, /FEYNMAN_FETCH_CACHE_DIR/);
	assert.match(patched, /process\.cwd\(\).*\.feynman.*cache.*fetch-content/);
	assert.doesNotMatch(patched, /tmpdir|pi-web-pdf/);
	assert.equal(patchPiWebAccessSource("pdf-extract.ts", patched), patched);
});
