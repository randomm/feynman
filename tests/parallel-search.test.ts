import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

test("parallel-search module exports registerParallelTools function", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	assert.strictEqual(typeof parallelModule.registerParallelTools, "function");
});

test("parallel-search registers three tools", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	const toolsRegistered: string[] = [];

	const pi = {
		registerTool: (toolConfig: any) => {
			toolsRegistered.push(toolConfig.name);
		},
	} as unknown as ExtensionAPI;

	parallelModule.registerParallelTools(pi);

	assert.strictEqual(toolsRegistered.length, 3);
	assert.ok(toolsRegistered.includes("parallel_search"));
	assert.ok(toolsRegistered.includes("parallel_fetch"));
	assert.ok(toolsRegistered.includes("parallel_research"));
});

test("parallel_search tool has correct configuration", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let toolConfig: any = null;

	const pi = {
		registerTool: (config: any) => {
			if (config.name === "parallel_search") {
				toolConfig = config;
			}
		},
	} as unknown as ExtensionAPI;

	parallelModule.registerParallelTools(pi);

	assert.ok(toolConfig);
	assert.strictEqual(toolConfig.label, "Parallel Search");
	assert.strictEqual(typeof toolConfig.description, "string");
	assert.ok(toolConfig.description.includes("parallel-cli"));
	assert.strictEqual(typeof toolConfig.parameters.properties.objective.type, "string");
	assert.strictEqual(toolConfig.parameters.properties.objective.type, "string");
});

test("parallel_fetch tool has correct configuration", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let toolConfig: any = null;

	const pi = {
		registerTool: (config: any) => {
			if (config.name === "parallel_fetch") {
				toolConfig = config;
			}
		},
	} as unknown as ExtensionAPI;

	parallelModule.registerParallelTools(pi);

	assert.ok(toolConfig);
	assert.strictEqual(toolConfig.label, "Parallel Fetch");
	assert.ok(
		toolConfig.description.toLowerCase().includes("extract"),
		"Description should mention extracting",
	);
	assert.ok(
		toolConfig.description.toLowerCase().includes("markdown"),
		"Description should mention markdown",
	);
	assert.strictEqual(typeof toolConfig.parameters.properties.url.type, "string");
});

test("parallel_research tool has correct configuration", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let toolConfig: any = null;

	const pi = {
		registerTool: (config: any) => {
			if (config.name === "parallel_research") {
				toolConfig = config;
			}
		},
	} as unknown as ExtensionAPI;

	parallelModule.registerParallelTools(pi);

	assert.ok(toolConfig);
	assert.strictEqual(toolConfig.label, "Parallel Research");
	assert.ok(toolConfig.description.includes("slow"));
	assert.ok(toolConfig.description.includes("last resort"));
	assert.strictEqual(typeof toolConfig.parameters.properties.question.type, "string");
});

test("parallel_search tool has execute function", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let executeFn: any = null;

	const pi = {
		registerTool: (config: any) => {
			if (config.name === "parallel_search") {
				executeFn = config.execute;
			}
		},
	} as unknown as ExtensionAPI;

	parallelModule.registerParallelTools(pi);

	assert.strictEqual(typeof executeFn, "function");
});

test("parallel_fetch tool has execute function", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let executeFn: any = null;

	const pi = {
		registerTool: (config: any) => {
			if (config.name === "parallel_fetch") {
				executeFn = config.execute;
			}
		},
	} as unknown as ExtensionAPI;

	parallelModule.registerParallelTools(pi);

	assert.strictEqual(typeof executeFn, "function");
});

test("parallel_research tool has execute function", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let executeFn: any = null;

	const pi = {
		registerTool: (config: any) => {
			if (config.name === "parallel_research") {
				executeFn = config.execute;
			}
		},
	} as unknown as ExtensionAPI;

	parallelModule.registerParallelTools(pi);

	assert.strictEqual(typeof executeFn, "function");
});

test("parallel_search validates maxResults rejects invalid values", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let executeFn: any = null;

	const pi = {
		registerTool: (config: any) => {
			if (config.name === "parallel_search") {
				executeFn = config.execute;
			}
		},
	} as unknown as ExtensionAPI;

	parallelModule.registerParallelTools(pi);

	await assert.rejects(
		() => executeFn("id", { objective: "test", maxResults: -5 }),
		/maxResults must be a positive integer/,
	);
});

test("parallel_search validates maxResults rejects zero", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let executeFn: any = null;
	const pi = { registerTool: (config: any) => { if (config.name === "parallel_search") executeFn = config.execute; } } as unknown as ExtensionAPI;
	parallelModule.registerParallelTools(pi);
	await assert.rejects(
		() => executeFn("id", { objective: "test", maxResults: 0 }),
		/maxResults must be a positive integer/,
	);
});

test("parallel_search validates maxResults rejects NaN", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let executeFn: any = null;
	const pi = { registerTool: (config: any) => { if (config.name === "parallel_search") executeFn = config.execute; } } as unknown as ExtensionAPI;
	parallelModule.registerParallelTools(pi);
	await assert.rejects(
		() => executeFn("id", { objective: "test", maxResults: Number.NaN }),
		/maxResults must be a positive integer/,
	);
});

test("parallel_search validates maxResults rejects Infinity", async () => {
	const parallelModule = await import("../extensions/parallel-search/parallel.js");
	let executeFn: any = null;
	const pi = { registerTool: (config: any) => { if (config.name === "parallel_search") executeFn = config.execute; } } as unknown as ExtensionAPI;
	parallelModule.registerParallelTools(pi);
	await assert.rejects(
		() => executeFn("id", { objective: "test", maxResults: Infinity }),
		/maxResults must be a positive integer/,
	);
});