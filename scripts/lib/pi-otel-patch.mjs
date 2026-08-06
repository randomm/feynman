export const PI_OTEL_PATCH_TARGETS = [
	"dist/attrs.js",
	"dist/config.js",
	"dist/index.js",
	"dist/otel/sdk.js",
	"dist/spans.js",
];

export function patchPiOtelSource(relativePath, source) {
	let patched = source;

	if (relativePath === "dist/index.js") {
		patched = patched
			.replace(" ATTR_PI_CWD,", "")
			.replace("\n                    [ATTR_PI_CWD]: cfg.cwd,", "")
			.replace("\n            cwd: cfg.cwd,", "")
			.replace(
				"if (await probeEndpoint(cfg.endpoint)) {",
				"if (await probeEndpoint(cfg.endpoint, 300, cfg.headers)) {",
			);
		if (!patched.includes("if (!process.env.FEYNMAN_POSTHOG_KEY)")) {
			patched = patched.replace(
				"            notify(`pi-otel: OTLP endpoint ${cfg.endpoint} not reachable — run /otel start to launch a dashboard, or /otel connect <endpoint> to wire elsewhere.`);",
				"            if (!process.env.FEYNMAN_POSTHOG_KEY)\n                notify(`pi-otel: OTLP endpoint ${cfg.endpoint} not reachable — run /otel start to launch a dashboard, or /otel connect <endpoint> to wire elsewhere.`);",
			);
		}
	}

	if (relativePath === "dist/otel/sdk.js") {
		const compatibleResourceImport = `import * as otelResources from "@opentelemetry/resources";
const createFeynmanResource = (attributes) => typeof otelResources.resourceFromAttributes === "function"
    ? otelResources.resourceFromAttributes(attributes)
    : new otelResources.Resource(attributes);`;
		patched = patched
			// pi-otel can resolve its declared OpenTelemetry 1.x dependency in
			// the agent workspace or Feynman's hoisted 2.x runtime dependency.
			.replace('import { Resource } from "@opentelemetry/resources";', compatibleResourceImport)
			.replace('import { resourceFromAttributes } from "@opentelemetry/resources";', compatibleResourceImport)
			.replace('import { ATTR_PI_CWD } from "../attrs.js";\n', "")
			.replace("\n        [ATTR_PI_CWD]: cfg.cwd,", "")
			.replace("const resource = new Resource({", "const resource = createFeynmanResource({")
			.replace("const resource = resourceFromAttributes({", "const resource = createFeynmanResource({")
			.replace(
				"export function probeEndpoint(endpoint, timeoutMs = 300) {",
				"export function probeEndpoint(endpoint, timeoutMs = 300, headers = {}) {",
			)
			.replace(
				"    // OTLP endpoints always carry an explicit port; refuse to fall back to\n    // 80/443, which could silently green-light an unrelated service.\n    if (!u.port)\n        return Promise.resolve(false);\n    return probeTcp(u.hostname || \"127.0.0.1\", Number(u.port), timeoutMs);",
				"    const defaultPort = u.protocol === \"https:\" ? 443 : u.protocol === \"http:\" ? 80 : undefined;\n    const port = u.port ? Number(u.port) : defaultPort;\n    if (!port)\n        return Promise.resolve(false);\n    return probeTcp(u.hostname || \"127.0.0.1\", port, timeoutMs);",
			);
		const oldFeynmanHttpProbe = `    if (process.env.FEYNMAN_POSTHOG_KEY && (u.protocol === "https:" || u.protocol === "http:")) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        timeout.unref?.();
        return fetch(u, { method: "HEAD", signal: controller.signal })
            .then(() => true, () => false)
            .finally(() => clearTimeout(timeout));
    }`;
		const feynmanHttpProbe = `    if (process.env.FEYNMAN_POSTHOG_KEY && (u.protocol === "https:" || u.protocol === "http:")) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        timeout.unref?.();
        return fetch(u, { method: "OPTIONS", headers, signal: controller.signal })
            .then((response) => response.ok, () => false)
            .finally(() => clearTimeout(timeout));
    }`;
		patched = patched.replace(oldFeynmanHttpProbe, feynmanHttpProbe);
		if (!patched.includes("method: \"OPTIONS\"")) {
			patched = patched.replace(
				"    const defaultPort = u.protocol === \"https:\" ? 443 : u.protocol === \"http:\" ? 80 : undefined;",
				`${feynmanHttpProbe}\n    const defaultPort = u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : undefined;`,
			);
		}
	}

	if (relativePath === "dist/config.js") {
		patched = patched
			.replace(
				"    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??\n        merged?.endpoint ??\n        \"http://127.0.0.1:4317\";",
				"    const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??\n        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??\n        merged?.endpoint ??\n        \"http://127.0.0.1:4317\";",
			)
			.replace(
				"    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);",
				"    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);",
			);
		if (!patched.includes("process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS")) {
			patched = patched.replace(
				"        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),",
				"        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),\n        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),",
			);
		}
	}

	if (relativePath === "dist/spans.js") {
		patched = patched
			.replace(" ATTR_PI_CWD,", "")
			.replace("\n            [ATTR_PI_CWD]: this.opts.cwd,", "");
	}

	if (relativePath === "dist/attrs.js") {
		patched = patched.replace('export const ATTR_PI_CWD = "pi.cwd";\n', "");
	}

	return patched;
}
