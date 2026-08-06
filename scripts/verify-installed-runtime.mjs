import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	fauxAssistantMessage,
	fauxToolCall,
	registerFauxProvider,
	streamSimple,
} from "@earendil-works/pi-ai/compat";
import { Compile } from "typebox/compile";

import {
	observeChildProcessClose,
	terminateChildProcessTree,
} from "./lib/child-process-cleanup.mjs";
import { resolveChildProcessCommand } from "./lib/child-process-command.mjs";

const EXPECTED_FEYNMAN_COMMANDS = Object.freeze([
	"capabilities",
	"commands",
	"feynman-model",
	"help",
	"init",
	"outputs",
	"service-tier",
	"thinking",
	"tools",
]);
const EXPECTED_FEYNMAN_TOOLS = Object.freeze([
	"alpha_annotate_paper",
	"alpha_ask_paper",
	"alpha_get_paper",
	"alpha_list_annotations",
	"alpha_read_code",
	"alpha_search",
	"feynman_connector_call",
	"feynman_connector_tools",
	"feynman_model_endpoint_call",
	"feynman_open_chemistry_sketcher",
	"feynman_science_database_search",
	"feynman_workbench_context",
	"hf_dataset_info",
	"hf_repo_files",
	"hf_repo_read_file",
]);

const packageRoot = resolve(import.meta.dirname, "..");
const defaultBinaryPath = resolve(process.argv[2] ?? resolve(packageRoot, "bin", "feynman.js"));

function normalizedPath(path) {
	return `${path ?? ""}`.replaceAll("\\", "/");
}

function namesFromToolOptions(options) {
	return options
		.filter((option) => option.endsWith("[extension]"))
		.map((option) => option.split(" — ")[0])
		.sort();
}

export async function verifyRpcSurface(options = {}) {
	const binaryPath = resolve(options.binaryPath ?? defaultBinaryPath);
	const spawnProcess = options.spawnProcess ?? spawn;
	const terminateProcessTree = options.terminateProcessTree ?? terminateChildProcessTree;
	const verificationTimeoutMs = options.timeoutMs ?? 45 * 60_000;
	const home = mkdtempSync(resolve(tmpdir(), "feynman-installed-rpc-"));
	const invocation = resolveChildProcessCommand(binaryPath, ["--mode", "rpc"]);
	let stderr = "";
	let stdoutBuffer = "";
	let commandsVerified = false;
	let toolsVerified = false;
	let schemaSummaryVerified = false;
	let promptAccepted = false;
	let stdinEnded = false;

	try {
		await new Promise((resolvePromise, rejectPromise) => {
			const child = spawnProcess(invocation.command, invocation.args, {
				cwd: home,
				detached: process.platform !== "win32",
				env: {
					...process.env,
					DO_NOT_TRACK: "1",
					FEYNMAN_HOME: home,
					FEYNMAN_TELEMETRY: "0",
					HOME: home,
				},
				shell: invocation.shell,
				windowsVerbatimArguments: invocation.windowsVerbatimArguments,
				stdio: ["pipe", "pipe", "pipe"],
			});
			const closePromise = observeChildProcessClose(child);
			let settling = false;
			let timeout;
			const fail = async (failure) => {
				if (settling) return;
				settling = true;
				clearTimeout(timeout);
				const primaryError =
					failure instanceof Error ? failure : new Error(String(failure));
				try {
					await terminateProcessTree(child, { closePromise });
					rejectPromise(primaryError);
				} catch (cleanupError) {
					const aggregate = new AggregateError(
						[primaryError, cleanupError],
						`${primaryError.message}; installed RPC cleanup also failed`,
					);
					aggregate.cause = primaryError;
					rejectPromise(aggregate);
				}
			};
			timeout = setTimeout(() => {
				void fail(
					new Error(
						`Installed RPC verification timed out. commands=${commandsVerified} tools=${toolsVerified} schema=${schemaSummaryVerified}\n${stderr}`,
					),
				);
			}, verificationTimeoutMs);

			const writeRecord = (record) => {
				if (settling) return;
				try {
					child.stdin.write(`${JSON.stringify(record)}\n`);
				} catch (error) {
					void fail(error);
				}
			};

			const finishInput = () => {
				if (
					!stdinEnded &&
					commandsVerified &&
					toolsVerified &&
					schemaSummaryVerified &&
					promptAccepted
				) {
					stdinEnded = true;
					try {
						child.stdin.end();
					} catch (error) {
						void fail(error);
					}
				}
			};
			const handleRecord = (record) => {
				if (
					record.type === "response" &&
					record.command === "get_commands" &&
					record.id === "feynman-command-inventory"
				) {
					assert.equal(record.success, true, record.error);
					const commands = Array.isArray(record.data?.commands)
						? record.data.commands
						: [];
					const feynmanCommands = commands
						.filter((command) =>
							normalizedPath(command.sourceInfo?.path).endsWith("/extensions/research-tools.ts"),
						)
						.map((command) => command.name)
						.sort();
					assert.deepEqual(feynmanCommands, [...EXPECTED_FEYNMAN_COMMANDS]);
					commandsVerified = true;
					finishInput();
					return;
				}
				if (
					record.type === "extension_ui_request" &&
					record.method === "select" &&
					record.title === "Tools"
				) {
					const options = Array.isArray(record.options) ? record.options : [];
					assert.deepEqual(namesFromToolOptions(options), [...EXPECTED_FEYNMAN_TOOLS]);
					const alphaGetPaper = options.find((option) =>
						option.startsWith("alpha_get_paper — "),
						);
						assert.ok(alphaGetPaper, "RPC /tools omitted alpha_get_paper");
						toolsVerified = true;
						writeRecord({
							type: "extension_ui_response",
							id: record.id,
							value: alphaGetPaper,
						});
						return;
					}
				if (
					record.type === "extension_ui_request" &&
					record.method === "notify" &&
					typeof record.message === "string" &&
					record.message.startsWith("alpha_get_paper:")
				) {
					assert.equal(
						record.message,
						"alpha_get_paper: paper, fullText, section, sections",
					);
					schemaSummaryVerified = true;
					finishInput();
					return;
				}
				if (
					record.type === "response" &&
					record.command === "prompt" &&
					record.id === "feynman-tool-browser"
				) {
					assert.equal(record.success, true, record.error);
					promptAccepted = true;
					finishInput();
				}
			};

			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk) => {
				stdoutBuffer += chunk;
				while (true) {
					const newlineIndex = stdoutBuffer.indexOf("\n");
					if (newlineIndex === -1) break;
					const line = stdoutBuffer.slice(0, newlineIndex);
					stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
					if (!line.trim()) continue;
					try {
						handleRecord(JSON.parse(line));
					} catch (error) {
						void fail(error);
						return;
					}
				}
			});
			child.stdin.once("error", (error) => {
				void fail(error);
			});
			child.once("error", (error) => {
				void fail(error);
			});
			child.once("exit", (code, signal) => {
				if (settling) return;
				if (
					code !== 0 ||
					signal ||
					!commandsVerified ||
					!toolsVerified ||
					!schemaSummaryVerified ||
					!promptAccepted
				) {
					void fail(
						new Error(
							`Installed RPC verification failed: code=${code} signal=${signal} commands=${commandsVerified} tools=${toolsVerified} schema=${schemaSummaryVerified} prompt=${promptAccepted}\n${stderr}`,
						),
					);
				}
			});
			child.once("close", (code, signal) => {
				if (settling) return;
				clearTimeout(timeout);
				if (
					code !== 0 ||
					signal ||
					!commandsVerified ||
					!toolsVerified ||
					!schemaSummaryVerified ||
					!promptAccepted
				) {
					void fail(
						new Error(
							`Installed RPC verification failed: code=${code} signal=${signal} commands=${commandsVerified} tools=${toolsVerified} schema=${schemaSummaryVerified} prompt=${promptAccepted}\n${stderr}`,
						),
					);
					return;
				}
				settling = true;
				resolvePromise();
			});

			writeRecord({
				id: "feynman-command-inventory",
				type: "get_commands",
			});
			writeRecord({
				id: "feynman-tool-browser",
				type: "prompt",
				message: "/tools",
			});
		});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

export async function verifyInstalledSchemas() {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-installed-schemas-"));
	const extensionPath = resolve(packageRoot, "extensions", "research-tools.ts");
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
		packages: [],
	});
	let inventorySession;
	let probeSession;
	const faux = registerFauxProvider();

	try {
		const inventoryLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			additionalExtensionPaths: [extensionPath],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await inventoryLoader.reload();
		assert.deepEqual(
			inventoryLoader.getExtensions().errors,
			[],
			"Installed extension loader reported errors",
		);
		const inventory = await createAgentSession({
			cwd: root,
			agentDir: root,
			resourceLoader: inventoryLoader,
			sessionManager: SessionManager.inMemory(root),
			settingsManager,
			noTools: "builtin",
		});
		inventorySession = inventory.session;
		const installedTools = inventorySession
			.getAllTools()
			.filter((tool) =>
				normalizedPath(tool.sourceInfo?.path).endsWith("/extensions/research-tools.ts"),
			);
		assert.deepEqual(
			installedTools
				.map((tool) => tool.name)
				.sort(),
			[...EXPECTED_FEYNMAN_TOOLS],
		);
		for (const tool of installedTools) {
			assert.doesNotThrow(
				() => Compile(tool.parameters),
				`Installed TypeBox schema did not compile: ${tool.name}`,
			);
		}
		assert.deepEqual(
			inventory.extensionsResult.extensions
				.filter((extension) =>
					normalizedPath(extension.path).endsWith("/extensions/research-tools.ts"),
				)
				.flatMap((extension) => [...extension.commands.keys()])
				.sort(),
			[...EXPECTED_FEYNMAN_COMMANDS],
		);
		const alphaGetPaper = installedTools.find((tool) => tool.name === "alpha_get_paper");
		assert.ok(alphaGetPaper, "Installed extension omitted alpha_get_paper");
		let observedArguments;
		let executeCalls = 0;
		const probeLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await probeLoader.reload();
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall(
					"feynman_typebox_probe",
					{ paper: "2401.00001", sections: ["methodology", "results"] },
					{ id: "valid-typebox-probe" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"feynman_typebox_probe",
					{ paper: "2401.00001", sections: null },
					{ id: "malformed-typebox-probe" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		const modelRuntime = {
			hasConfiguredAuth: () => true,
			checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			isUsingOAuth: () => false,
			streamSimple,
		};
		const probe = await createAgentSession({
			cwd: root,
			agentDir: root,
			modelRuntime,
			model: faux.getModel(),
			resourceLoader: probeLoader,
			sessionManager: SessionManager.inMemory(root),
			settingsManager,
			tools: ["feynman_typebox_probe"],
			customTools: [{
				name: "feynman_typebox_probe",
				label: "Feynman TypeBox Probe",
				description: "Validates the installed alpha_get_paper schema.",
				parameters: alphaGetPaper.parameters,
				execute: async (_toolCallId, parameters) => {
					executeCalls += 1;
					observedArguments = parameters;
					return {
						content: [{ type: "text", text: "validated" }],
						details: {},
					};
				},
			}],
		});
		probeSession = probe.session;
		await probeSession.prompt("exercise the installed tool schema", {
			expandPromptTemplates: false,
		});
		const toolResult = probeSession.messages.find(
			(message) =>
				message.role === "toolResult" &&
				message.toolCallId === "valid-typebox-probe",
		);
		assert.ok(toolResult, "Pi did not emit the installed schema probe result");
		assert.equal(toolResult.isError, false);
		assert.deepEqual(observedArguments, {
			paper: "2401.00001",
			sections: ["methodology", "results"],
		});
		const malformedResult = probeSession.messages.find(
			(message) =>
				message.role === "toolResult" &&
				message.toolCallId === "malformed-typebox-probe",
		);
		assert.ok(malformedResult, "Pi did not emit the malformed-argument schema probe result");
		assert.equal(malformedResult.isError, true);
		assert.equal(executeCalls, 1, "Malformed arguments reached the custom tool execute function");
	} finally {
		probeSession?.dispose();
		inventorySession?.dispose();
		faux.unregister();
		rmSync(root, { recursive: true, force: true });
	}
}

async function main() {
	await verifyRpcSurface();
	await verifyInstalledSchemas();
	console.log(JSON.stringify({
		binary: defaultBinaryPath,
		commands: EXPECTED_FEYNMAN_COMMANDS.length,
		tools: EXPECTED_FEYNMAN_TOOLS.length,
		typeboxSchemas: EXPECTED_FEYNMAN_TOOLS.length,
		typeboxOptionalArray: "passed",
		typeboxMalformedArguments: "rejected",
	}));
}

export function isDirectExecution(
	entryPath = process.argv[1],
	modulePath = fileURLToPath(import.meta.url),
) {
	if (!entryPath) return false;
	try {
		return realpathSync(entryPath) === realpathSync(modulePath);
	} catch {
		return resolve(entryPath) === resolve(modulePath);
	}
}

if (isDirectExecution()) {
	await main();
}
