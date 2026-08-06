export declare const PI_RUNTIME_CORRECTNESS_PATCH_TARGETS: Readonly<{
	codingAgent: readonly string[];
	piAi: readonly string[];
}>;
export declare const PI_RUNTIME_CORRECTNESS_REQUIRED_VERSION: "0.83.0";
export declare const PI_RUNTIME_CORRECTNESS_PATCH_MARKERS: Readonly<{
	agentSession: string;
	sessionManager: string;
	transformMessages: string;
}>;
export declare const PI_RUNTIME_CORRECTNESS_REQUIRED_FRAGMENTS: Readonly<{
	agentSession: readonly string[];
	sessionManager: readonly string[];
	transformMessages: readonly string[];
}>;
export declare function assertPiRuntimeCorrectnessVersion(version: string | undefined, surface: string): void;
export declare function assertPiRuntimeCorrectnessPatchSource(
	source: string,
	target: "agentSession" | "sessionManager" | "transformMessages",
	surface?: string,
): void;
export declare function patchPiAgentSessionSource(source: string): string;
export declare function patchPiSessionManagerSource(source: string): string;
export declare function patchPiTransformMessagesSource(source: string): string;
