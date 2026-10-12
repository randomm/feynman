import { execFile } from "node:child_process";

export type ExecOptions = {
	timeoutMs: number;
	env?: NodeJS.ProcessEnv;
};

export type ExecResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

// Injectable so tests can drive the router without spawning a real binary.
export type Exec = (file: string, args: string[], options: ExecOptions) => Promise<ExecResult>;

export class ExecError extends Error {
	readonly code: "ENOENT" | "ETIMEOUT" | "EXEC_FAILED";
	readonly stderr: string;

	constructor(code: ExecError["code"], message: string, stderr = "") {
		super(message);
		this.name = "ExecError";
		this.code = code;
		this.stderr = stderr;
	}
}

// A non-zero exit is not an error here: wigolo writes its JSON error object to
// stdout and exits 1, so we resolve with stdout and let the caller classify it.
export const execFileRunner: Exec = (file, args, options) =>
	new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				timeout: options.timeoutMs,
				maxBuffer: 50 * 1024 * 1024, // 50 MB stdout buffer limit
				env: options.env,
			},
			(error, stdout, stderr) => {
				const out = String(stdout ?? "");
				const err = String(stderr ?? "");
				if (!error) {
					resolve({ stdout: out, stderr: err, exitCode: 0 });
					return;
				}
				const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals | null };
				if (failure.code === "ENOENT") {
					reject(new ExecError("ENOENT", `${file} not found on PATH`, err));
					return;
				}
				if (failure.killed && failure.signal) {
					reject(new ExecError("ETIMEOUT", `${file} timed out after ${options.timeoutMs} ms`, err));
					return;
				}
				if (typeof failure.code === "number") {
					resolve({ stdout: out, stderr: err, exitCode: failure.code });
					return;
				}
				reject(new ExecError("EXEC_FAILED", failure.message, err));
			},
		);
	});
