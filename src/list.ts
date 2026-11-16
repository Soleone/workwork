import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  effectiveLevel,
  findCandidates,
  hasFinder,
  kindOf,
  type Candidate,
  type Kind,
} from "./candidates.ts";
import { syncHistory } from "./outcomes.ts";
import { LEVELS, loadPlays, type Level, type Play } from "./plays.ts";
import { repoChecks } from "./repo.ts";
import { gitQuery } from "./run.ts";
import { latestDecisions, type Decision, type Verdict } from "./store.ts";

const SHOWN_PER_PLAY = 5;

export type ListOptions = { play?: string; allHistory?: boolean; compact?: boolean };

type Row = { id: string; title: string; text: string; note?: string; changed?: boolean };
type Group = { play: Play; level: Level; rows: Row[]; error?: string };

/** A shown candidate, for --json. `repo` is absolute so a script can run `workwork prompt` there. */
export type Listed = {
  repo: string;
  label: string;
  id: string;
  play: string;
  level: Level;
  kind: Kind;
  title: string;
};

/** One repo's shown candidates, cheapest attention first, with failed finders kept apart. */
export async function listed(
  repo: string,
  label: string,
  options: ListOptions,
): Promise<{ candidates: Listed[]; errors: string[] }> {
  const { groups } = await grouped(repo, options);
  const candidates = LEVELS.flatMap((level) =>
    groups
      .filter((group) => group.level === level)
      .flatMap(({ play, rows }) =>
        rows.map(({ id, title }) => ({
          repo,
          label,
          id,
          play: play.name,
          level,
          kind: kindOf(play),
          title,
        })),
      ),
  );
  const errors = groups.flatMap(({ play, error }) =>
    error ? [`${label} ${play.name}: finder failed: ${error}`] : [],
  );
  return { candidates, errors };
}

/** One repo's candidates, grouped by play, cheapest attention first. Compact is one line per level, for --all. */
export async function listing(
  repo: string,
  label: string,
  options: ListOptions,
): Promise<{ text: string; count: number; failed: number }> {
  const { plays, groups, hidden, checks } = await grouped(repo, options);
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const levels = LEVELS.flatMap((level) => {
    const n = groups
      .filter((group) => group.level === level)
      .reduce((sum, group) => sum + group.rows.length, 0);
    return n ? [`${n} ${level}`] : [];
  });
  const header = count
    ? `${label}: ${count} candidate${count === 1 ? "" : "s"} (${levels.join(", ")}) · checks: ${checks.join(", ") || "none, so nothing is auto"}`
    : `${label}: nothing to do`;
  const failed = groups.filter((group) => group.error).length;
  if (options.compact) return { text: [header, ...compactLines(groups)].join("\n"), count, failed };

  const unrun = plays
    .filter((play) => !hasFinder(play))
    .map((play) => `${play.name} (${play.finder})`);
  const footer = [
    hidden ? `${hidden} hidden by past decisions or open PRs (--all-history shows them).` : "",
    unrun.length ? `Not run, no such finder: ${unrun.join(", ")}.` : "",
    options.play ? "" : onRequestNote(),
  ].filter(Boolean);
  const blocks = LEVELS.flatMap((level) => {
    const atLevel = groups.filter((group) => group.level === level);
    const scans = atLevel.filter((group) => group.play.finder === "scan" && !group.error);
    return [
      ...atLevel
        .filter((group) => !scans.includes(group))
        .flatMap((group) => fullBlock(group, options.play !== undefined)),
      ...scanBlock(level, scans),
    ];
  });
  return { text: [header, ...blocks, ...footer].join("\n\n"), count, failed };
}

async function grouped(repo: string, options: ListOptions) {
  const plays = selectPlays(options.play);
  const [results, history] = await Promise.all([
    findCandidates(repo, plays.filter(hasFinder)),
    syncHistory(repo),
  ]);
  const latest = latestDecisions(history.decisions);
  const checks = repoChecks(repo);
  const churn = churnByFile(repo);
  let hidden = 0;

  const groups: Group[] = results.map(({ play, candidates, error }) => {
    const rows = candidates.flatMap((candidate) => {
      const past = pastNote(repo, candidate, latest.get(candidate.id), history.inProgress);
      if (past.hidden && !options.allHistory) {
        hidden++;
        return [];
      }
      const text = [clip(candidate.title, 110), signals(repo, candidate, churn), past.note];
      return [
        {
          id: candidate.id,
          title: candidate.title,
          text: text.filter(Boolean).join(" · "),
          note: past.note,
          changed: past.changed,
        },
      ];
    });
    // Changed since its last verdict comes first, then the finder's own order.
    rows.sort((a, b) => Number(b.changed ?? false) - Number(a.changed ?? false));
    return { play, level: effectiveLevel(play, checks), rows, error };
  });
  return { plays, groups, hidden, checks };
}

function fullBlock({ play, level, rows, error }: Group, showAll: boolean): string[] {
  if (error) return [`${level.padEnd(6)} ${play.name}: finder failed: ${error}`];
  if (rows.length === 0) return [];
  const shown = showAll ? rows : rows.slice(0, SHOWN_PER_PLAY);
  const width = Math.min(48, Math.max(...shown.map(({ id }) => id.length)));
  return [
    [
      `${level.padEnd(6)} ${play.name} (${rows.length}) · done: ${play.done}`,
      ...shown.map(({ id, text }) => `  ${id.padEnd(width)}  ${text}`),
      ...(rows.length > shown.length
        ? [`  … ${rows.length - shown.length} more: workwork --play ${play.name}`]
        : []),
    ].join("\n"),
  ];
}

/** Scans have one candidate each, the whole repo, so they share a block. */
function scanBlock(level: Level, scans: Group[]): string[] {
  const rows = scans.flatMap((group) =>
    group.rows.map((row) => ({ ...row, done: group.play.done })),
  );
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map(({ id }) => id.length));
  return [
    [
      `${level.padEnd(6)} scans (${rows.length}) · each searches the whole repo · done:`,
      ...rows.map(
        ({ id, done, note }) =>
          `  ${id.padEnd(width)}  ${[done, note].filter(Boolean).join(" · ")}`,
      ),
    ].join("\n"),
  ];
}

function compactLines(groups: Group[]): string[] {
  const lines = LEVELS.flatMap((level) => {
    const atLevel = groups.filter((group) => group.level === level && group.rows.length);
    const scans = atLevel.filter((group) => group.play.finder === "scan").length;
    const plays = [
      ...atLevel
        .filter((group) => group.play.finder !== "scan")
        .map((group) => `${group.play.name} ${group.rows.length}`),
      ...(scans ? [`${scans} scan${scans === 1 ? "" : "s"}`] : []),
    ];
    return plays.length ? [`  ${level.padEnd(6)} ${plays.join(" · ")}`] : [];
  });
  const failures = groups.filter((group) => group.error);
  if (failures.length)
    lines.push(
      `  failed ${failures.map((group) => `${group.play.name} (${group.error})`).join(" · ")}`,
    );
  return lines;
}

/** Plays kept out of the default listing, so they can still be found. */
export function onRequestNote(): string {
  const names = loadPlays()
    .filter((play) => play.onRequest)
    .map((play) => play.name);
  return names.length ? `On request: ${names.join(", ")} (workwork --play <name>).` : "";
}

function selectPlays(name: string | undefined): Play[] {
  const plays = loadPlays();
  if (!name) return plays.filter((play) => !play.onRequest);
  const play = plays.find((candidate) => candidate.name === name);
  if (!play)
    throw new Error(`no play named ${name}. Plays: ${plays.map((each) => each.name).join(", ")}`);
  return [play];
}

const PAST: Record<Verdict, string> = {
  accept: "accepted",
  reject: "rejected",
  defer: "deferred",
  keep: "kept",
};

/** Rejections and open PRs hide a candidate; any other verdict hides it until its file changes. */
function pastNote(
  repo: string,
  candidate: Candidate,
  decision: Decision | undefined,
  inProgress: Set<string>,
): { hidden: boolean; note?: string; changed?: boolean } {
  if (inProgress.has(candidate.id)) return { hidden: true, note: "open PR or issue" };
  if (!decision) return { hidden: false };
  const note = `${PAST[decision.decision]} ${decision.date.slice(0, 10)}${decision.reason ? `: "${clip(decision.reason, 80)}"` : ""}`;
  if (decision.decision === "reject") return { hidden: true, note };
  const changed =
    gitQuery(repo, [
      "diff",
      "--quiet",
      decision.commit,
      "--",
      ...(candidate.file ? [candidate.file] : []),
    ]) === undefined;
  return changed
    ? { hidden: false, note: `${note}, changed since`, changed }
    : { hidden: true, note };
}

/** Size and churn, for candidates that are about one file (not, say, a package listed in package.json). */
function signals(repo: string, candidate: Candidate, churn: Map<string, number>): string {
  const { file, key } = candidate;
  if (!file || (key !== file && !key.startsWith(`${file}#`))) return "";
  const path = join(repo, file);
  if (!existsSync(path)) return "file missing";
  const lines = readFileSync(path, "utf8").trimEnd().split("\n").length;
  const commits = churn.get(file) ?? 0;
  return `${lines} line${lines === 1 ? "" : "s"}, ${commits} commit${commits === 1 ? "" : "s"}/90d`;
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
