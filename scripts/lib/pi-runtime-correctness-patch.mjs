/**
 * Temporary Pi 0.83.0 correctness patches for:
 * - https://github.com/earendil-works/pi/issues/7150
 * - https://github.com/earendil-works/pi/issues/7053
 *
 * Removal condition: delete this patch once a supported released Pi version
 * rejects prompts during standalone/manual compaction and eagerly persists
 * finalized parallel tool results while restoring them in tool-call order.
 */
export const PI_RUNTIME_CORRECTNESS_PATCH_TARGETS = Object.freeze({
	codingAgent: Object.freeze([
		"dist/core/agent-session.js",
		"dist/core/session-manager.js",
	]),
	piAi: Object.freeze(["dist/api/transform-messages.js"]),
});
export const PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION = "0.83.0";
export const PI_RUNTIME_CORRECTNESS_PATCH_MARKERS = Object.freeze({
	agentSession: "Feynman Pi 0.83.0 correctness patch: issues #7150 and #7053",
	sessionManager: "Feynman Pi 0.83.0 correctness patch: restore eager tool results",
	transformMessages: "Feynman Pi 0.83.0 correctness patch: order eager tool results",
});
export const PI_RUNTIME_CORRECTNESS_REQUIRED_FRAGMENTS = Object.freeze({
	agentSession: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.agentSession,
		'const feynmanToolResultIdBeforeExtensions = event.type === "message_end" && event.message.role === "toolResult"',
		"const entryId = this.sessionManager.appendMessage(toolResult);",
		"this._feynmanEagerlyPersistedToolResults.set(event.toolCallId, {",
		"await this._emitExtensionEvent(event);",
		"event.message.toolCallId = feynmanToolResultIdBeforeExtensions;",
		"const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;",
		"this.sessionManager.replaceMessage(eagerlyPersisted.entryId, event.message);",
		"if (this._compactionAbortController !== undefined && !this.isStreaming) {",
		'throw new Error("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.");',
	]),
	sessionManager: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.sessionManager,
		"function restoreFeynmanToolResultsInSourceOrder(messages) {",
		"activeBatch.results.set(message.toolCallId, message);",
		"restored.push(toolResult);",
		"replaceMessage(entryId, message) {",
		`this.byId.set(entryId, replacement);
        this._rewriteFile();`,
		"const messages = restoreFeynmanToolResultsInSourceOrder(buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages));",
	]),
	transformMessages: Object.freeze([
		PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.transformMessages,
		"let pendingToolResults = new Map();",
		"const flushFeynmanToolResults = () => {",
		"const toolResult = pendingToolResults.get(toolCall.id);",
		"result.push(toolResult ?? {",
		"pendingToolResults.set(msg.toolCallId, msg);",
		`if (msg.role === "assistant") {
            flushFeynmanToolResults();`,
		`else if (msg.role === "user") {
            flushFeynmanToolResults();`,
		`    }
    flushFeynmanToolResults();
`,
	]),
});

const PI_RUNTIME_CORRECTNESS_ORDERED_FRAGMENTS = Object.freeze({
	agentSession: Object.freeze([
		"const entryId = this.sessionManager.appendMessage(toolResult);",
		"await this._emitExtensionEvent(event);",
		"event.message.toolCallId = feynmanToolResultIdBeforeExtensions;",
		"const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;",
		"this.sessionManager.replaceMessage(eagerlyPersisted.entryId, event.message);",
	]),
	sessionManager: Object.freeze([
		"function restoreFeynmanToolResultsInSourceOrder(messages) {",
		"const messages = restoreFeynmanToolResultsInSourceOrder(buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages));",
	]),
	transformMessages: Object.freeze([
		"const flushFeynmanToolResults = () => {",
		"pendingToolResults.set(msg.toolCallId, msg);",
	]),
});

const AGENT_SESSION_MARKER = PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.agentSession;
const SESSION_MANAGER_MARKER = PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.sessionManager;
const TRANSFORM_MESSAGES_MARKER = PI_RUNTIME_CORRECTNESS_PATCH_MARKERS.transformMessages;

export function assertPiRuntimeCorrectnessVersion(version, surface) {
	if (version !== PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION) {
		throw new Error(
			`Unsupported Pi runtime correctness patch ${surface}: expected ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION}, found ${version ?? "missing"}`,
		);
	}
}

export function assertPiRuntimeCorrectnessPatchSource(source, target, surface = target) {
	const required = PI_RUNTIME_CORRECTNESS_REQUIRED_FRAGMENTS[target];
	const ordered = PI_RUNTIME_CORRECTNESS_ORDERED_FRAGMENTS[target];
	if (!required || !ordered) {
		throw new Error(`Unknown Pi runtime correctness target: ${target}`);
	}
	for (const fragment of required) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete Pi runtime correctness patch ${surface}: missing ${fragment}`);
		}
	}
	let previousIndex = -1;
	for (const fragment of ordered) {
		const index = source.indexOf(fragment);
		if (index <= previousIndex) {
			throw new Error(`Incomplete Pi runtime correctness patch ${surface}: out of order ${fragment}`);
		}
		previousIndex = index;
	}
}

function replaceRequired(source, original, replacement, label) {
	const first = source.indexOf(original);
	if (first === -1 || source.indexOf(original, first + original.length) !== -1) {
		throw new Error(
			`Unsupported Pi ${PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION} ${label} layout; remove or update the runtime correctness patch`,
		);
	}
	return source.replace(original, replacement);
}

const AGENT_SESSION_HELPERS = `
// ${AGENT_SESSION_MARKER}
function createFeynmanToolResultMessage(event) {
    return {
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.result.content ?? [],
        details: event.result.details,
        usage: event.result.usage,
        ...(event.result.addedToolNames?.length ? { addedToolNames: event.result.addedToolNames } : {}),
        isError: event.isError,
        timestamp: Date.now(),
    };
}
function hasSameFeynmanToolResultPayload(left, right) {
    return (left.toolCallId === right.toolCallId &&
        left.toolName === right.toolName &&
        left.isError === right.isError &&
        isDeepStrictEqual(left.content, right.content) &&
        isDeepStrictEqual(left.details, right.details) &&
        isDeepStrictEqual(left.usage, right.usage) &&
        isDeepStrictEqual(left.addedToolNames, right.addedToolNames));
}
function serializeFeynmanToolResultPayload(message) {
    return JSON.stringify({
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content,
        details: message.details,
        usage: message.usage,
        addedToolNames: message.addedToolNames,
        isError: message.isError,
    });
}
`;

const AGENT_SESSION_LEGACY_EAGER_PERSISTENCE = `        // A finalized result must be durable before a parallel sibling settles.
        // Public message_end events remain ordered by the assistant's tool calls.
        if (event.type === "tool_execution_end") {
            const toolResult = createFeynmanToolResultMessage(event);
            const entryId = this.sessionManager.appendMessage(toolResult);
            this._feynmanEagerlyPersistedToolResults.set(event.toolCallId, {
                entryId,
                message: toolResult,
                serializedPayload: this.sessionManager.isPersisted()
                    ? serializeFeynmanToolResultPayload(toolResult)
                    : undefined,
            });
        }
`;

const AGENT_SESSION_EAGER_PERSISTENCE = `        // A finalized result must be durable before a parallel sibling settles.
        // Persist before extension dispatch so a completed tool survives a blocked handler.
        // Public message_end events remain ordered by the assistant's tool calls.
        if (event.type === "tool_execution_end") {
            const toolResult = createFeynmanToolResultMessage(event);
            const entryId = this.sessionManager.appendMessage(toolResult);
            this._feynmanEagerlyPersistedToolResults.set(event.toolCallId, {
                entryId,
                message: toolResult,
                serializedPayload: this.sessionManager.isPersisted()
                    ? serializeFeynmanToolResultPayload(toolResult)
                    : undefined,
            });
        }
`;

const AGENT_SESSION_EXTENSION_BOUNDARY = `        const feynmanToolResultIdBeforeExtensions = event.type === "message_end" && event.message.role === "toolResult"
            ? event.message.toolCallId
            : undefined;
${AGENT_SESSION_EAGER_PERSISTENCE}        // Emit to extensions first
        await this._emitExtensionEvent(event);
        // Tool result identity is protocol-bound to the assistant's original call.
        // Preserve it when an extension returns a same-role replacement with another ID.
        if (feynmanToolResultIdBeforeExtensions !== undefined &&
            event.type === "message_end" &&
            event.message.role === "toolResult" &&
            event.message.toolCallId !== feynmanToolResultIdBeforeExtensions) {
            event.message.toolCallId = feynmanToolResultIdBeforeExtensions;
        }
`;

const ORIGINAL_MESSAGE_PERSISTENCE = `            else if (event.message.role === "user" ||
                event.message.role === "assistant" ||
                event.message.role === "toolResult") {
                // Regular LLM message - persist as SessionMessageEntry
                this.sessionManager.appendMessage(event.message);
            }`;

const PATCHED_MESSAGE_PERSISTENCE = `            else if (event.message.role === "toolResult") {
                const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;
                const eagerlyPersisted = this._feynmanEagerlyPersistedToolResults.get(eagerToolCallId);
                this._feynmanEagerlyPersistedToolResults.delete(eagerToolCallId);
                const payloadUnchanged = eagerlyPersisted?.serializedPayload !== undefined
                    ? eagerlyPersisted.serializedPayload === serializeFeynmanToolResultPayload(event.message)
                    : eagerlyPersisted
                        ? hasSameFeynmanToolResultPayload(eagerlyPersisted.message, event.message)
                        : false;
                if (eagerlyPersisted && !payloadUnchanged) {
                    this.sessionManager.replaceMessage(eagerlyPersisted.entryId, event.message);
                }
                else if (!eagerlyPersisted) {
                    this.sessionManager.appendMessage(event.message);
                }
            }
            else if (event.message.role === "user" || event.message.role === "assistant") {
                // Regular LLM message - persist as SessionMessageEntry
                this.sessionManager.appendMessage(event.message);
            }`;

const MANUAL_COMPACTION_GUARD = `            // Manual compaction rebuilds agent state from SessionManager on completion.
            // Reject prompts that would otherwise enter detached state and then be lost.
            // Auto-compaction uses a separate controller and keeps queued steer/follow-up behavior.
            if (this._compactionAbortController !== undefined && !this.isStreaming) {
                throw new Error("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.");
            }
`;

export function patchPiAgentSessionSource(source) {
	if (source.includes(AGENT_SESSION_MARKER)) {
		try {
			assertPiRuntimeCorrectnessPatchSource(source, "agentSession");
			return source;
		} catch {
			let upgraded = replaceRequired(
				source,
				`        // Emit to extensions first
        await this._emitExtensionEvent(event);
${AGENT_SESSION_LEGACY_EAGER_PERSISTENCE}`,
				AGENT_SESSION_EXTENSION_BOUNDARY,
				"legacy agent-session extension boundary",
			);
			upgraded = replaceRequired(
				upgraded,
				`                const eagerlyPersisted = this._feynmanEagerlyPersistedToolResults.get(event.message.toolCallId);
                this._feynmanEagerlyPersistedToolResults.delete(event.message.toolCallId);`,
				`                const eagerToolCallId = feynmanToolResultIdBeforeExtensions ?? event.message.toolCallId;
                const eagerlyPersisted = this._feynmanEagerlyPersistedToolResults.get(eagerToolCallId);
                this._feynmanEagerlyPersistedToolResults.delete(eagerToolCallId);`,
				"legacy agent-session eager result lookup",
			);
			assertPiRuntimeCorrectnessPatchSource(upgraded, "agentSession");
			return upgraded;
		}
	}

	let patched = replaceRequired(
		source,
		'import { basename, dirname } from "node:path";\n',
		'import { basename, dirname } from "node:path";\nimport { isDeepStrictEqual } from "node:util";\n',
		"agent-session import",
	);
	patched = replaceRequired(
		patched,
		"// ============================================================================\n// Constants\n// ============================================================================\n",
		`${AGENT_SESSION_HELPERS}\n// ============================================================================\n// Constants\n// ============================================================================\n`,
		"agent-session helper",
	);
	patched = replaceRequired(
		patched,
		"    _eventListeners = [];\n",
		"    _eventListeners = [];\n    _feynmanEagerlyPersistedToolResults = new Map();\n",
		"agent-session state",
	);
	patched = replaceRequired(
		patched,
		"        // Emit to extensions first\n        await this._emitExtensionEvent(event);\n",
		AGENT_SESSION_EXTENSION_BOUNDARY,
		"agent-session extension boundary",
	);
	patched = replaceRequired(
		patched,
		ORIGINAL_MESSAGE_PERSISTENCE,
		PATCHED_MESSAGE_PERSISTENCE,
		"agent-session message persistence",
	);
	patched = replaceRequired(
		patched,
		"            // Emit input event for extension interception (before skill/template expansion)\n",
		`${MANUAL_COMPACTION_GUARD}            // Emit input event for extension interception (before skill/template expansion)\n`,
		"agent-session prompt preflight",
	);
	assertPiRuntimeCorrectnessPatchSource(patched, "agentSession");
	return patched;
}

const SESSION_MANAGER_HELPER = `
// ${SESSION_MANAGER_MARKER}
function restoreFeynmanToolResultsInSourceOrder(messages) {
    const batchesByAssistantIndex = new Map();
    const associatedResultIndexes = new Set();
    let activeBatch;
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.role === "assistant") {
            activeBatch = undefined;
            if (message.stopReason === "error" || message.stopReason === "aborted")
                continue;
            const toolCallIds = message.content.filter((block) => block.type === "toolCall").map((block) => block.id);
            if (toolCallIds.length > 0) {
                activeBatch = { toolCallIds, results: new Map() };
                batchesByAssistantIndex.set(i, activeBatch);
            }
            continue;
        }
        if (message.role === "toolResult" && activeBatch?.toolCallIds.includes(message.toolCallId)) {
            activeBatch.results.set(message.toolCallId, message);
            associatedResultIndexes.add(i);
        }
    }
    const restored = [];
    for (let i = 0; i < messages.length; i++) {
        if (associatedResultIndexes.has(i))
            continue;
        const message = messages[i];
        restored.push(message);
        const batch = batchesByAssistantIndex.get(i);
        if (!batch)
            continue;
        for (const toolCallId of batch.toolCallIds) {
            const toolResult = batch.results.get(toolCallId);
            if (toolResult)
                restored.push(toolResult);
        }
    }
    return restored;
}
`;

const SESSION_MANAGER_REPLACE_MESSAGE = `    /**
     * Replace an eagerly persisted message without appending a second billable entry.
     * Feynman uses this only when a message_end extension rewrites a finalized tool result.
     */
    replaceMessage(entryId, message) {
        const existing = this.byId.get(entryId);
        if (!existing || existing.type !== "message") {
            throw new Error(\`Cannot replace missing session message entry: \${entryId}\`);
        }
        const index = this.fileEntries.findIndex((entry) => entry.type === "message" && entry.id === entryId);
        if (index === -1) {
            throw new Error(\`Cannot replace unindexed session message entry: \${entryId}\`);
        }
        const replacement = { ...existing, message };
        this.fileEntries[index] = replacement;
        this.byId.set(entryId, replacement);
        this._rewriteFile();
    }
`;

export function patchPiSessionManagerSource(source) {
	if (source.includes(SESSION_MANAGER_MARKER)) {
		assertPiRuntimeCorrectnessPatchSource(source, "sessionManager");
		return source;
	}
	let patched = replaceRequired(
		source,
		"/**\n * Build the active, compaction-aware session entry list.\n",
		`${SESSION_MANAGER_HELPER}\n/**\n * Build the active, compaction-aware session entry list.\n`,
		"session-manager helper",
	);
	patched = replaceRequired(
		patched,
		"    /** Append a thinking level change as child of current leaf, then advance leaf. Returns entry id. */\n",
		`${SESSION_MANAGER_REPLACE_MESSAGE}    /** Append a thinking level change as child of current leaf, then advance leaf. Returns entry id. */\n`,
		"session-manager message replacement",
	);
	patched = replaceRequired(
		patched,
		"    const messages = buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages);\n",
		"    const messages = restoreFeynmanToolResultsInSourceOrder(buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages));\n",
		"session-manager context restoration",
	);
	assertPiRuntimeCorrectnessPatchSource(patched, "sessionManager");
	return patched;
}

const ORIGINAL_TRANSFORM_SECOND_PASS = `    // Second pass: insert synthetic empty tool results for orphaned tool calls
    // This preserves thinking signatures and satisfies API requirements
    const result = [];
    let pendingToolCalls = [];
    let existingToolResultIds = new Set();
    const insertSyntheticToolResults = () => {
        if (pendingToolCalls.length > 0) {
            for (const tc of pendingToolCalls) {
                if (!existingToolResultIds.has(tc.id)) {
                    result.push({
                        role: "toolResult",
                        toolCallId: tc.id,
                        toolName: tc.name,
                        content: [{ type: "text", text: "No result provided" }],
                        isError: true,
                        timestamp: Date.now(),
                    });
                }
            }
            pendingToolCalls = [];
            existingToolResultIds = new Set();
        }
    };
    for (let i = 0; i < transformed.length; i++) {
        const msg = transformed[i];
        if (msg.role === "assistant") {
            // If we have pending orphaned tool calls from a previous assistant, insert synthetic results now
            insertSyntheticToolResults();
            // Skip errored/aborted assistant messages entirely.
            // These are incomplete turns that shouldn't be replayed:
            // - May have partial content (reasoning without message, incomplete tool calls)
            // - Replaying them can cause API errors (e.g., OpenAI "reasoning without following item")
            // - The model should retry from the last valid state
            const assistantMsg = msg;
            if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
                continue;
            }
            // Track tool calls from this assistant message
            const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
            if (toolCalls.length > 0) {
                pendingToolCalls = toolCalls;
                existingToolResultIds = new Set();
            }
            result.push(msg);
        }
        else if (msg.role === "toolResult") {
            existingToolResultIds.add(msg.toolCallId);
            result.push(msg);
        }
        else if (msg.role === "user") {
            // User message interrupts tool flow - insert synthetic results for orphaned calls
            insertSyntheticToolResults();
            result.push(msg);
        }
        else {
            result.push(msg);
        }
    }
    // If the conversation ends with unresolved tool calls, synthesize results now.
    insertSyntheticToolResults();
`;

const PATCHED_TRANSFORM_SECOND_PASS = `    // ${TRANSFORM_MESSAGES_MARKER}
    // Order results by assistant source calls and synthesize only unresolved calls.
    // Eager persistence can store parallel results in completion order.
    const result = [];
    let pendingToolCalls = [];
    let pendingToolResults = new Map();
    const flushFeynmanToolResults = () => {
        if (pendingToolCalls.length > 0) {
            for (const toolCall of pendingToolCalls) {
                const toolResult = pendingToolResults.get(toolCall.id);
                result.push(toolResult ?? {
                    role: "toolResult",
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    content: [{ type: "text", text: "No result provided" }],
                    isError: true,
                    timestamp: Date.now(),
                });
            }
            pendingToolCalls = [];
            pendingToolResults = new Map();
        }
    };
    for (let i = 0; i < transformed.length; i++) {
        const msg = transformed[i];
        if (msg.role === "assistant") {
            flushFeynmanToolResults();
            // Skip errored/aborted assistant messages entirely.
            // These are incomplete turns that shouldn't be replayed:
            // - May have partial content (reasoning without message, incomplete tool calls)
            // - Replaying them can cause API errors (e.g., OpenAI "reasoning without following item")
            // - The model should retry from the last valid state
            const assistantMsg = msg;
            if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
                continue;
            }
            const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
            if (toolCalls.length > 0) {
                pendingToolCalls = toolCalls;
                pendingToolResults = new Map();
            }
            result.push(msg);
        }
        else if (msg.role === "toolResult") {
            if (pendingToolCalls.some((toolCall) => toolCall.id === msg.toolCallId)) {
                pendingToolResults.set(msg.toolCallId, msg);
            }
            else {
                result.push(msg);
            }
        }
        else if (msg.role === "user") {
            flushFeynmanToolResults();
            result.push(msg);
        }
        else {
            result.push(msg);
        }
    }
    flushFeynmanToolResults();
`;

export function patchPiTransformMessagesSource(source) {
	if (source.includes(TRANSFORM_MESSAGES_MARKER)) {
		assertPiRuntimeCorrectnessPatchSource(source, "transformMessages");
		return source;
	}
	const patched = replaceRequired(
		source,
		ORIGINAL_TRANSFORM_SECOND_PASS,
		PATCHED_TRANSFORM_SECOND_PASS,
		"transform-messages second pass",
	);
	assertPiRuntimeCorrectnessPatchSource(patched, "transformMessages");
	return patched;
}
