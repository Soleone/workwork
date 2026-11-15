import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

// Forks live in opensource/; tries/ and trash/ aren't worth agent tokens.
const SKIPPED = new Set(["node_modules", "opensource", "tries", "trash"]);

/** Repos under `src` whose origin is the GitHub user's own: the only ones workwork works in with --all. */
export async function ownedRepos(src: string): Promise<string[]> {
  const { code, stdout, stderr } = await run("gh", ["api", "user", "--jq", ".login"], src);
  if (code !== 0) throw new Error(`--all needs gh to know which repos are yours: ${stderr.trim()}`);
  const own = new RegExp(`github\\.com[:/]${stdout.trim()}/`, "i");
  return findRepos(src, 4).filter((repo) =>
    own.test(gitQuery(repo, ["remote", "get-url", "origin"]) ?? ""),
  );
}

function findRepos(dir: string, depth: number): string[] {
  const dotGit = join(dir, ".git");
  // A .git file marks a worktree or submodule: its repo is listed from where it lives.
  if (existsSync(dotGit)) return statSync(dotGit).isDirectory() ? [dir] : [];
  if (depth === 0) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED.has(entry.name),
    )
    .flatMap((entry) => findRepos(join(dir, entry.name), depth - 1));
}
