import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("vendored runtime uses a committed exact dependency lock", () => {
	const settings = JSON.parse(
		readFileSync(join(root, ".feynman", "settings.json"), "utf8"),
	) as { packages: string[] };
	const rootLock = JSON.parse(
		readFileSync(join(root, "package-lock.json"), "utf8"),
	) as { packages: Record<string, { version?: string }> };
	const runtimeLock = JSON.parse(
		readFileSync(join(root, ".feynman", "runtime-package-lock.json"), "utf8"),
	) as {
		lockfileVersion: number;
		packages: Record<string, { dependencies?: Record<string, string>; version?: string }>;
	};

	const expected = Object.fromEntries(settings.packages.map((source) => {
		const spec = source.slice("npm:".length);
		const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)@(.+)$/);
		assert.ok(match, `runtime package is not exact: ${source}`);
		return [match[1], match[2]];
	}));
	for (const packageName of [
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-tui",
		"brace-expansion",
		"typebox",
		"undici",
	]) {
		const version = rootLock.packages[`node_modules/${packageName}`]?.version;
		if (version) expected[packageName] = version;
	}

	assert.equal(runtimeLock.lockfileVersion, 3);
	assert.deepEqual(runtimeLock.packages[""].dependencies, expected);
	assert.equal(
		runtimeLock.packages["node_modules/@hono/node-server"]?.version,
		"2.0.12",
	);
	assert.equal(runtimeLock.packages["node_modules/undici"]?.version, "8.9.0");
	for (const [packagePath, entry] of Object.entries(runtimeLock.packages)) {
		if (packagePath.endsWith("/pi-coding-agent/node_modules/brace-expansion")) {
			assert.equal(entry.version, "5.0.9");
		}
		if (packagePath.endsWith("/pi-coding-agent/node_modules/undici")) {
			assert.equal(entry.version, "8.9.0");
		}
	}
});

test("runtime build hashes its lock and pruning logic and installs with npm ci", () => {
	const source = readFileSync(
		join(root, "scripts", "prepare-runtime-workspace.mjs"),
		"utf8",
	);
	assert.match(source, /runtime-package-lock\.json/);
	assert.match(source, /prune-runtime-deps\.mjs/);
	assert.match(source, /"ci"/);
	assert.match(source, /--refresh-lock/);
	assert.match(source, /--save-exact/);
	assert.match(source, /workspacePackagesMatch/);
	assert.match(source, /runtimeArchiveMatches/);
	assert.match(source, /computeRuntimeInputHash/);
	assert.match(source, /computeRuntimeTreeHash/);
	assert.match(source, /filesMatch/);
	assert.match(source, /runtime-workspace\.sha256/);
	assert.match(source, /createDeterministicTarGz/);
	assert.match(source, /--rebuild/);
});
