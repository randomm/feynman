import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAlphaTools } from "./research-tools/alpha.js";
import { registerCurrentDateResearchContext } from "./research-tools/current-date.js";
import { registerDiscoveryCommands } from "./research-tools/discovery.js";
import { registerDocxFallback } from "./research-tools/docx-fallback.js";
import { installFeynmanHeader } from "./research-tools/header.js";
import { registerHelpCommand } from "./research-tools/help.js";
import { registerHuggingFaceTools } from "./research-tools/huggingface.js";
import { registerLaunchNotice } from "./research-tools/launch-notice.js";
import { registerModelErrorHint } from "./research-tools/model-error-hint.js";
import { registerInitCommand, registerOutputsCommand } from "./research-tools/project.js";
import { registerParallelTools } from "./parallel-search/parallel.js";
import { registerServiceTierControls } from "./research-tools/service-tier.js";
import { registerScienceDatabaseTools } from "./research-tools/science-databases.js";
import { registerResearchTelemetry } from "./research-tools/telemetry.js";

export default function researchTools(pi: ExtensionAPI): void {
	const cache: { agentSummaryPromise?: Promise<{ agents: string[]; chains: string[] }> } = {};

	// Pi 0.66.x folds post-switch/resume lifecycle into session_start.
	pi.on("session_start", async (_event, ctx) => {
		await installFeynmanHeader(pi, ctx, cache);
	});

	registerAlphaTools(pi);
	registerCurrentDateResearchContext(pi);
	registerHuggingFaceTools(pi);
	registerDiscoveryCommands(pi);
	registerDocxFallback(pi);
	registerHelpCommand(pi);
	registerInitCommand(pi);
	registerLaunchNotice(pi);
	registerModelErrorHint(pi);
	registerOutputsCommand(pi);
	registerParallelTools(pi);
	registerServiceTierControls(pi);
	registerScienceDatabaseTools(pi);
	registerResearchTelemetry(pi);
}
