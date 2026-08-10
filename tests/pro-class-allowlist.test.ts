// FORK-OWNED TEST. See FORK.md.
//
// Feynman disables "Pro-class" models as a cost guard (src/model/catalog.ts).
// The pattern matches on the literal word "pro", which false-positives on
// open-weight models whose *name* happens to contain it without being a
// premium tier — notably deepseek-ai/DeepSeek-V4-Pro, which on Nebius costs
// $1.75/$3.50 per Mtok, i.e. cheaper than moonshotai/Kimi-K3 ($3/$15) that the
// guard happily allows.
//
// This fork narrows the guard with an allowlist. These tests are the tripwire:
// if an upstream sync drops the fork patch, `npm test` fails loudly instead of
// the model silently disappearing from `feynman model list` again.
import test from "node:test";
import assert from "node:assert/strict";
import { isProClassModelSpec } from "../src/model/catalog.js";

test("allowlisted DeepSeek-V4-Pro is not treated as Pro-class", () => {
	assert.equal(isProClassModelSpec("nebius/deepseek-ai/DeepSeek-V4-Pro"), false);
});

test("allowlist matching is case-insensitive", () => {
	assert.equal(isProClassModelSpec("nebius/deepseek-ai/deepseek-v4-pro"), false);
});

test("allowlist works regardless of which provider serves the model", () => {
	assert.equal(isProClassModelSpec("huggingface/deepseek-ai/DeepSeek-V4-Pro"), false);
});

test("genuine Pro-tier models are still guarded", () => {
	assert.equal(isProClassModelSpec("google/gemini-2.5-pro"), true);
	assert.equal(isProClassModelSpec("openai/o1-pro"), true);
});

test("FEYNMAN_ALLOW_PRO_MODELS extends the allowlist at runtime", () => {
	const previous = process.env.FEYNMAN_ALLOW_PRO_MODELS;
	try {
		assert.equal(isProClassModelSpec("google/gemini-2.5-pro"), true);
		process.env.FEYNMAN_ALLOW_PRO_MODELS = "google/gemini-2.5-pro";
		assert.equal(isProClassModelSpec("google/gemini-2.5-pro"), false);
	} finally {
		if (previous === undefined) delete process.env.FEYNMAN_ALLOW_PRO_MODELS;
		else process.env.FEYNMAN_ALLOW_PRO_MODELS = previous;
	}
});

test("non-Pro models are unaffected", () => {
	assert.equal(isProClassModelSpec("nebius/moonshotai/Kimi-K3"), false);
	assert.equal(isProClassModelSpec("cerebras/zai-glm-4.7"), false);
});
