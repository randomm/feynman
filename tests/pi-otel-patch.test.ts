import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { patchPiOtelSource } from "../scripts/lib/pi-otel-patch.mjs";

test("patchPiOtelSource strips cwd attributes from pi-otel spans and resources", () => {
	const attrs = 'export const ATTR_PI_CWD = "pi.cwd";\nexport const ATTR_PI_TURN_COUNT = "pi.turn_count";';
	const spans = "const attrs = {\n            [ATTR_SYSTEM]: GEN_AI_SYSTEM_PI,\n            [ATTR_PI_CWD]: this.opts.cwd,\n        };";
	const sdk = 'import { Resource } from "@opentelemetry/resources";\nimport { ATTR_PI_CWD } from "../attrs.js";\nconst resource = new Resource({\n        [ATTR_SERVICE_NAME]: cfg.serviceName,\n        [ATTR_PI_CWD]: cfg.cwd,\n    });\n    // OTLP endpoints always carry an explicit port; refuse to fall back to\n    // 80/443, which could silently green-light an unrelated service.\n    if (!u.port)\n        return Promise.resolve(false);\n    return probeTcp(u.hostname || "127.0.0.1", Number(u.port), timeoutMs);';
	const index = "tracker = new SpanTracker({\n            tracer,\n            captureContent: cfg.captureContent,\n            cwd: cfg.cwd,\n            sessionId: () => sessionIdRef,\n        });\nattributes: {\n                    [ATTR_SYSTEM]: GEN_AI_SYSTEM_PI,\n                    [ATTR_PI_CWD]: cfg.cwd,\n                    \"service.name\": cfg.serviceName,\n                }\nif (await probeEndpoint(cfg.endpoint)) {";

	assert.doesNotMatch(patchPiOtelSource("dist/attrs.js", attrs), /ATTR_PI_CWD|pi\.cwd/);
	assert.doesNotMatch(patchPiOtelSource("dist/spans.js", spans), /ATTR_PI_CWD|this\.opts\.cwd/);
	assert.doesNotMatch(patchPiOtelSource("dist/otel/sdk.js", sdk), /ATTR_PI_CWD|cfg\.cwd/);
	assert.doesNotMatch(patchPiOtelSource("dist/index.js", index), /ATTR_PI_CWD|cfg\.cwd/);
	assert.match(
		patchPiOtelSource("dist/index.js", index),
		/if \(await probeEndpoint\(cfg\.endpoint, 300, cfg\.headers\)\)/,
	);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /import \* as otelResources from "@opentelemetry\/resources"/);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /const resource = createFeynmanResource\(\{/);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /u\.protocol === "https:" \? 443/);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /FEYNMAN_POSTHOG_KEY/);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /method: "OPTIONS"/);
});

test("patchPiOtelSource supports both OpenTelemetry 1.x and 2.x resource APIs", () => {
	for (const source of [
		`import { Resource } from "@opentelemetry/resources";
const resource = new Resource({});`,
		`import { resourceFromAttributes } from "@opentelemetry/resources";
const resource = resourceFromAttributes({});`,
	]) {
		const patched = patchPiOtelSource("dist/otel/sdk.js", source);

		assert.match(patched, /typeof otelResources\.resourceFromAttributes === "function"/);
		assert.match(patched, /new otelResources\.Resource\(attributes\)/);
		assert.match(patched, /const resource = createFeynmanResource\(\{\}\)/);
	}
});

test("patchPiOtelSource makes pi-otel honor trace-specific OTLP env vars", () => {
	const config = `    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const headers = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    };`;
	const patched = patchPiOtelSource("dist/config.js", config);

	assert.match(patched, /process\.env\.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT \?\?/);
	assert.match(patched, /process\.env\.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL \?\?/);
	assert.match(patched, /parseKvList\(process\.env\.OTEL_EXPORTER_OTLP_TRACES_HEADERS\)/);
	assert.match(patched, /process\.env\.OTEL_EXPORTER_OTLP_ENDPOINT \?\?/);
});

test("patchPiOtelSource silently skips a blocked Feynman-managed collector", () => {
	const index = `        if (await probeEndpoint(cfg.endpoint)) {
            wireSdk(cfg);
        }
        else {
            notify(\`pi-otel: OTLP endpoint \${cfg.endpoint} not reachable — run /otel start to launch a dashboard, or /otel connect <endpoint> to wire elsewhere.\`);
        }`;
	const sdk = `export function probeEndpoint(endpoint, timeoutMs = 300) {
    let u;
    try {
        u = new URL(endpoint);
    }
    catch {
        return Promise.resolve(false);
    }
    // OTLP endpoints always carry an explicit port; refuse to fall back to
    // 80/443, which could silently green-light an unrelated service.
    if (!u.port)
        return Promise.resolve(false);
    return probeTcp(u.hostname || "127.0.0.1", Number(u.port), timeoutMs);
}`;

	const patchedIndex = patchPiOtelSource("dist/index.js", index);
	const patchedSdk = patchPiOtelSource("dist/otel/sdk.js", sdk);

	assert.match(patchedIndex, /if \(!process\.env\.FEYNMAN_POSTHOG_KEY\)/);
	assert.match(patchedIndex, /probeEndpoint\(cfg\.endpoint, 300, cfg\.headers\)/);
	assert.match(patchedSdk, /process\.env\.FEYNMAN_POSTHOG_KEY/);
	assert.match(patchedSdk, /probeEndpoint\(endpoint, timeoutMs = 300, headers = \{\}\)/);
	assert.match(patchedSdk, /fetch\(u, \{ method: "OPTIONS", headers, signal: controller\.signal \}\)/);
	assert.match(patchedSdk, /\.then\(\(response\) => response\.ok, \(\) => false\)/);
});

test("patchPiOtelSource rejects retriable HTTP failures before exporters start", async () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-pi-otel-probe-"));
	const modulePath = resolve(root, "sdk.mjs");
	const sdk = `export function probeTcp() {
    return Promise.resolve(true);
}
export function probeEndpoint(endpoint, timeoutMs = 300) {
    let u;
    try {
        u = new URL(endpoint);
    }
    catch {
        return Promise.resolve(false);
    }
    const defaultPort = u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : undefined;
    const port = u.port ? Number(u.port) : defaultPort;
    if (!port)
        return Promise.resolve(false);
    return probeTcp(u.hostname || "127.0.0.1", port, timeoutMs);
}`;
	writeFileSync(modulePath, patchPiOtelSource("dist/otel/sdk.js", sdk), "utf8");

	let status = 503;
	let method = "";
	let authorization = "";
	const server = createServer((request, response) => {
		method = request.method ?? "";
		authorization = request.headers.authorization ?? "";
		response.writeHead(status).end();
	});
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	assert.ok(address && typeof address === "object");
	const previousKey = process.env.FEYNMAN_POSTHOG_KEY;
	process.env.FEYNMAN_POSTHOG_KEY = "test-project-token";

	try {
		const { probeEndpoint } = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
			probeEndpoint: (endpoint: string, timeoutMs: number, headers: Record<string, string>) => Promise<boolean>;
		};
		const endpoint = `http://127.0.0.1:${address.port}/i/v0/ai/otel`;
		assert.equal(
			await probeEndpoint(endpoint, 1_000, { Authorization: "Bearer test-project-token" }),
			false,
		);
		assert.equal(method, "OPTIONS");
		assert.equal(authorization, "Bearer test-project-token");

		status = 204;
		assert.equal(
			await probeEndpoint(endpoint, 1_000, { Authorization: "Bearer test-project-token" }),
			true,
		);
	} finally {
		if (previousKey === undefined) {
			delete process.env.FEYNMAN_POSTHOG_KEY;
		} else {
			process.env.FEYNMAN_POSTHOG_KEY = previousKey;
		}
		await new Promise<void>((resolveClose, rejectClose) => {
			server.close((error) => error ? rejectClose(error) : resolveClose());
		});
		rmSync(root, { recursive: true, force: true });
	}
});

test("patchPiOtelSource is idempotent", () => {
	const source = `import { Resource } from "@opentelemetry/resources";
import { ATTR_PI_CWD } from "../attrs.js";
const resource = new Resource({
        [ATTR_SERVICE_NAME]: cfg.serviceName,
        [ATTR_PI_CWD]: cfg.cwd,
    });
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const headers = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    };`;
	const once = patchPiOtelSource("dist/otel/sdk.js", source);
	const twice = patchPiOtelSource("dist/otel/sdk.js", once);
	const configOnce = patchPiOtelSource("dist/config.js", source);
	const configTwice = patchPiOtelSource("dist/config.js", configOnce);

	assert.doesNotMatch(once, /ATTR_PI_CWD|cfg\.cwd/);
	assert.equal(twice, once);
	assert.equal(configTwice, configOnce);
});
