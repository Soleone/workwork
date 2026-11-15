import { execFileSync, spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export type Result = { code: number; stdout: string; stderr: string };

/** Runs a tool to completion. A nonzero exit is a result, not an error: knip and pnpm outdated exit 1 on findings. */
export function run(cmd: string, args: string[], cwd: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function onPath(cmd: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, cmd), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function git(
  repo: string,
  args: string[],
  options: { input?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  }).trimEnd();
}

/** For git questions answered by the exit code: undefined means no (or failed). */
export function gitQuery(repo: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trimEnd() : undefined;
}
