export declare const PI_WEB_ACCESS_REQUIRED_VERSION: "0.18.0";
export const PI_WEB_ACCESS_PATCH_TARGETS: string[];
export declare function assertPiWebAccessVersion(version: string | undefined, surface: string): void;
export declare function assertPiWebAccessPatchedSources(
	sources: ReadonlyMap<string, string>,
	surface?: string,
): void;
export declare function patchPiWebAccessSources(
	sources: ReadonlyMap<string, string>,
	surface?: string,
): Map<string, string>;
export function patchPiWebAccessSource(relativePath: string, source: string): string;
