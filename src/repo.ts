import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./plays.ts";
import { gitQuery, onPath, run } from "./run.ts";

export function repoRoot(dir: string): string {
  const root = gitQuery(dir, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error("not inside a git repository");
  return root;
}

/** The mechanical checks this repo has. Without any, nothing can be auto. */
export function repoChecks(repo: string): string[] {
  const path = join(repo, "package.json");
  const pkg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const packageManager = existsSync(join(repo, "pnpm-lock.yaml")) ? "pnpm" : "npm";
  return [
    deps["vite-plus"] ? "vp check" : undefined,
    existsSync(join(repo, ".kit.json")) && onPath("kit") ? "kit check" : undefined,
    pkg.scripts?.test ? `${packageManager} test` : undefined,
  ].filter((check) => check !== undefined);
}

/**
 * Repos under `root` whose origin is one of the GitHub user's own, not forked or archived: the only
 * ones --all works in. Folder names listed in <config>/skip (one per line) aren't searched.
 */
export async function ownedRepos(root: string): Promise<string[]> {
  const args = ["repo", "list", "--source", "--no-archived", "--limit", "5000"];
  const { code, stdout, stderr } = await run(
    "gh",
    [...args, "--json", "nameWithOwner", "--jq", ".[].nameWithOwner"],
    root,
  );
  if (code !== 0) throw new Error(`--all needs gh to know which repos are yours: ${stderr.trim()}`);
  const own = new Set(stdout.toLowerCase().split("\n").filter(Boolean));
  return findRepos(root, 4, skipped()).filter((repo) =>
    own.has(githubName(gitQuery(repo, ["remote", "get-url", "origin"]) ?? "")),
  );
}

function githubName(url: string): string {
  return /github\.com[:/](.+?)(?:\.git)?\/?$/.exec(url)?.[1].toLowerCase() ?? "";
}

function skipped(): Set<string> {
  const file = join(configDir(), "skip");
  const names = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  return new Set(["node_modules", ...names.map((name) => name.trim()).filter(Boolean)]);
}

function findRepos(dir: string, depth: number, skip: Set<string>): string[] {
  const dotGit = join(dir, ".git");
  // A .git file marks a worktree or submodule: its repo is listed from where it lives.
  if (existsSync(dotGit)) return statSync(dotGit).isDirectory() ? [dir] : [];
  if (depth === 0) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !skip.has(entry.name))
    .flatMap((entry) => findRepos(join(dir, entry.name), depth - 1, skip));
}
