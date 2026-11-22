// Decisions live on an orphan `meta` branch, written with git plumbing so the working tree is never
// touched. Two machines appending at once conflict only at the end of the file, so lines are unioned.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitQuery } from "./run.ts";

/** keep: an agent looked and nothing should change. Every verdict but reject lasts until the code changes. */
export const VERDICTS = ["accept", "reject", "defer", "keep"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type Decision = {
  id: string;
  path: string;
  commit: string;
  decision: Verdict;
  reason: string;
  source: "pr" | "issue" | "chat" | "agent";
  /** The PR or issue number, for decisions folded in from GitHub. */
  ref?: string;
  date: string;
};

const LOCAL = "refs/heads/meta";
const REMOTE = "refs/remotes/origin/meta";
const FILE = "workwork/decisions.jsonl";

export function readDecisions(repo: string): Decision[] {
  fetchMeta(repo);
  return storedLines(repo)
    .map((line) => JSON.parse(line) as Decision)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Newest decision per id. */
export function latestDecisions(decisions: Decision[]): Map<string, Decision> {
  return new Map(decisions.map((decision) => [decision.id, decision]));
}

/** Appends decisions to the meta branch and pushes it. Returns where they landed. */
export function recordDecisions(repo: string, decisions: Decision[]): string {
  for (let attempt = 1; ; attempt++) {
    fetchMeta(repo);
    commitLines(
      repo,
      unique([...storedLines(repo), ...decisions.map((decision) => JSON.stringify(decision))]),
    );
    if (!hasOrigin(repo)) return "the local meta branch (no origin remote)";
    const push = spawnSync("git", ["push", "-q", "origin", "meta"], {
      cwd: repo,
      encoding: "utf8",
    });
    if (push.status === 0) return "origin/meta";
    // A rejected push usually means another machine pushed first: fetch, union and try once more.
    if (attempt === 2)
      throw new Error(
        `recorded in the local meta branch, but pushing it failed:\n${push.stderr.trim()}`,
      );
  }
}

function hasOrigin(repo: string): boolean {
  return gitQuery(repo, ["remote", "get-url", "origin"]) !== undefined;
}

function fetchMeta(repo: string): void {
  if (!hasOrigin(repo)) return;
  const result = spawnSync("git", ["fetch", "-q", "origin", `+meta:${REMOTE}`], {
    cwd: repo,
    encoding: "utf8",
  });
  if (result.status !== 0 && !result.stderr.includes("couldn't find remote ref")) {
    console.error(
      `workwork: couldn't fetch origin/meta, using local decisions only (${result.stderr.trim().split("\n")[0]})`,
    );
  }
}

function tip(repo: string, ref: string): string | undefined {
  return gitQuery(repo, ["rev-parse", "-q", "--verify", ref]);
}

function storedLines(repo: string): string[] {
  const tips = [LOCAL, REMOTE].filter((ref) => tip(repo, ref));
  return unique(
    tips.flatMap((ref) =>
      (gitQuery(repo, ["show", `${ref}:${FILE}`]) ?? "").split("\n").filter(Boolean),
    ),
  );
}

function commitLines(repo: string, lines: string[]): void {
  const local = tip(repo, LOCAL);
  const remote = tip(repo, REMOTE);
  const blob = git(repo, ["hash-object", "-w", "--stdin"], { input: `${lines.join("\n")}\n` });
  const index = join(tmpdir(), `workwork-${process.pid}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    // Start from the shared tree so files other tools keep on meta survive.
    const base = remote ?? local;
    git(repo, ["read-tree", ...(base ? [base] : ["--empty"])], { env });
    git(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${FILE}`], { env });
    const tree = git(repo, ["write-tree"], { env });
    const parents = metaParents(repo, local, remote).flatMap((parent) => ["-p", parent]);
    git(repo, [
      "update-ref",
      LOCAL,
      git(repo, ["commit-tree", tree, ...parents, "-m", "workwork: record decisions"]),
    ]);
  } finally {
    rmSync(index, { force: true });
  }
}

function metaParents(
  repo: string,
  local: string | undefined,
  remote: string | undefined,
): string[] {
  if (!local || !remote || local === remote)
    return [local ?? remote].filter((parent) => parent !== undefined);
  if (isAncestor(repo, local, remote)) return [remote];
  if (isAncestor(repo, remote, local)) return [local];
  return [local, remote];
}

function isAncestor(repo: string, ancestor: string, of: string): boolean {
  return gitQuery(repo, ["merge-base", "--is-ancestor", ancestor, of]) !== undefined;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
