export declare const RUNTIME_INPUT_FILES: readonly string[];

export declare function parseExactRuntimePackageSpec(spec: string): {
	name: string;
	version: string;
};

export declare function workspacePackagesMatch(
	nodeModulesPath: string,
	packageSpecs: string[],
): boolean;
export declare function runtimeManifestPackagesMatch(
	nodeModulesPath: string,
	manifestPackageSpecs: string[],
	configuredPackageSpecs?: string[],
): boolean;

export declare function computeFileSha256(path: string): string;
export declare function computeRuntimeInputHash(
	rootPath: string,
	inputFiles?: readonly string[],
): string;
export declare function computeRuntimeTreeHash(rootPath: string): string;
export declare function computeRuntimeArchiveTreeHash(archivePath: string): string;
export declare function writeFileSha256(path: string, digestPath: string): string;
export declare function verifyFileSha256(path: string, digestPath: string): boolean;
export declare function filesMatch(leftPath: string, rightPath: string): boolean;
export declare function readArchiveEntry(
	archivePath: string,
	entryPath: string,
): string | undefined;

export declare function runtimeArchiveMatches(options: {
	archivePath: string;
	digestPath: string;
	lockPath: string;
	manifestPath: string;
	packageSpecs: string[];
	runtimeInputHash: string;
}): boolean;
