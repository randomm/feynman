import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settings } from "@clack/prompts";

import "../src/setup/prompts.js";

function runWithoutModel(args: string[]) {
	const home = mkdtempSync(join(tmpdir(), "feynman-first-run-"));
	try {
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/_API_KEY$|_TOKEN$/.test(key)));
		const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
			cwd: process.cwd(),
			encoding: "utf8",
			env: { ...env, FEYNMAN_HOME: home, HOME: home, FEYNMAN_TELEMETRY: "0" },
			input: "",
			maxBuffer: 1024 * 1024,
		});
		return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

test("typing a question into a setup menu does not move the selection", () => {
	for (const key of ["h", "j", "k", "l"]) assert.equal(settings.aliases.has(key), false, key);
});

test("a prompt with no model configured says how to add one and that it was not sent", () => {
	const { status, output } = runWithoutModel(["-p", "what is attention"]);
	assert.equal(status, 1);
	assert.match(output, /No model is set up yet/);
	assert.match(output, /feynman model login/);
	assert.match(output, /ANTHROPIC_API_KEY/);
	assert.match(output, /Your question was not sent\./);
	assert.doesNotMatch(output, /Use \/login|node_modules/);
});

test("help lists options without a duplicate getting-started block or a legacy label", () => {
	const { output } = runWithoutModel(["--help"]);
	assert.match(output, /◆ Options/);
	assert.doesNotMatch(output, /Legacy Flags|Getting Started/);
});
