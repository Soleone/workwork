import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveLevel, findCandidates, hasFinder, type Candidate } from "./candidates.ts";
import { syncHistory } from "./outcomes.ts";
import { LEVELS, loadPlays, type Level, type Play } from "./plays.ts";
import { repoChecks } from "./repo.ts";
import { gitQuery } from "./run.ts";
import { latestDecisions, type Decision } from "./store.ts";

const SHOWN_PER_PLAY = 5;

export type ListOptions = { play?: string; allHistory?: boolean };

/** One repo's candidates, grouped by play, cheapest attention first. */
export async function listing(
  repo: string,
  label: string,
  options: ListOptions,
): Promise<{ text: string; count: number; failed: number }> {
  const plays = selectPlays(options.play);
  const [results, history] = await Promise.all([
    findCandidates(repo, plays.filter(hasFinder)),
    syncHistory(repo),
  ]);
  const latest = latestDecisions(history.decisions);
  const checks = repoChecks(repo);
  const churn = churnByFile(repo);
  const perLevel = new Map<Level, number>();
  const blocks: string[] = [];
  let hidden = 0;

  for (const { play, candidates, error } of results) {
    const level = effectiveLevel(play, checks);
    if (error) blocks.push(`${level.padEnd(6)} ${play.name}: finder failed: ${error}`);
    const rows = candidates.flatMap((candidate) => {
      const past = pastNote(repo, candidate, latest.get(candidate.id), history.inProgress);
      if (past.hidden && !options.allHistory) {
        hidden++;
        return [];
      }
      const text = [clip(candidate.title, 110), signals(repo, candidate, churn), past.note];
      return [{ id: candidate.id, text: text.filter(Boolean).join(" · ") }];
    });
    if (rows.length === 0) continue;
    perLevel.set(level, (perLevel.get(level) ?? 0) + rows.length);
    const shown = options.play ? rows : rows.slice(0, SHOWN_PER_PLAY);
    const width = Math.min(48, Math.max(...shown.map(({ id }) => id.length)));
    blocks.push(
      [
        `${level.padEnd(6)} ${play.name} (${rows.length}) · done: ${play.done}`,
        ...shown.map(({ id, text }) => `  ${id.padEnd(width)}  ${text}`),
        ...(rows.length > shown.length
          ? [`  … ${rows.length - shown.length} more: workwork --play ${play.name}`]
          : []),
      ].join("\n"),
    );
  }

  const count = [...perLevel.values()].reduce((sum, n) => sum + n, 0);
  const levels = LEVELS.filter((level) => perLevel.has(level)).map(
    (level) => `${perLevel.get(level)} ${level}`,
  );
  const header = count
    ? `${label}: ${count} candidate${count === 1 ? "" : "s"} (${levels.join(", ")}) · checks: ${checks.join(", ") || "none, so nothing is auto"}`
    : `${label}: nothing to do`;
  const unrun = plays
    .filter((play) => !hasFinder(play))
    .map((play) => `${play.name} (${play.finder})`);
  const footer = [
    hidden ? `${hidden} hidden by past decisions or open PRs (--all-history shows them).` : "",
    unrun.length ? `Not run, finder not built yet: ${unrun.join(", ")}.` : "",
  ].filter(Boolean);
  const failed = results.filter((result) => result.error).length;
  return { text: [header, ...blocks, ...footer].join("\n\n"), count, failed };
}

function selectPlays(name: string | undefined): Play[] {
  const plays = loadPlays();
  if (!name) return plays.filter((play) => !play.onRequest);
  const play = plays.find((candidate) => candidate.name === name);
  if (!play)
    throw new Error(`no play named ${name}. Plays: ${plays.map((each) => each.name).join(", ")}`);
  return [play];
}

/** Rejections and open PRs hide a candidate; a deferral hides it until its file changes. */
function pastNote(
  repo: string,
  candidate: Candidate,
  decision: Decision | undefined,
  inProgress: Set<string>,
): { hidden: boolean; note?: string } {
  if (inProgress.has(candidate.id)) return { hidden: true, note: "open PR or issue" };
  if (!decision) return { hidden: false };
  const said = `${decision.date.slice(0, 10)}${decision.reason ? `: "${clip(decision.reason, 80)}"` : ""}`;
  if (decision.decision === "reject") return { hidden: true, note: `rejected ${said}` };
  if (decision.decision === "accept") return { hidden: false, note: `accepted ${said}` };
  const changed =
    gitQuery(repo, [
      "diff",
      "--quiet",
      decision.commit,
      "--",
      ...(candidate.file ? [candidate.file] : []),
    ]) === undefined;
  return changed
    ? { hidden: false, note: `deferred ${said}, changed since` }
    : { hidden: true, note: `deferred ${said}` };
}

/** Size and churn, for candidates that are about one file (not, say, a package listed in package.json). */
function signals(repo: string, candidate: Candidate, churn: Map<string, number>): string {
  const { file, key } = candidate;
  if (!file || (key !== file && !key.startsWith(`${file}#`))) return "";
  const path = join(repo, file);
  if (!existsSync(path)) return "file missing";
  const lines = readFileSync(path, "utf8").split("\n").length;
  return `${lines} lines, ${churn.get(file) ?? 0} commits/90d`;
}

function churnByFile(repo: string): Map<string, number> {
  const counts = new Map<string, number>();
  const log = gitQuery(repo, ["log", "--since=90.days", "--name-only", "--format="]) ?? "";
  for (const file of log.split("\n").filter(Boolean)) counts.set(file, (counts.get(file) ?? 0) + 1);
  return counts;
}

function clip(text: string, length: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
