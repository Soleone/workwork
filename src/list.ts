import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  effectiveAttention,
  findCandidates,
  hasFinder,
  kindOf,
  type Candidate,
  type Kind,
} from "./candidates.ts";
import { syncHistory } from "./outcomes.ts";
import { ATTENTION, loadBlueprints, type Attention, type Blueprint } from "./blueprints.ts";
import { repoChecks } from "./repo.ts";
import { gitQuery } from "./run.ts";
import { latestDecisions, type Decision, type Verdict } from "./store.ts";

const SHOWN_PER_PLAY = 5;

export type ListOptions = { blueprint?: string; allHistory?: boolean; compact?: boolean };

type Row = { id: string; title: string; text: string; note?: string; changed?: boolean };
type Group = { blueprint: Blueprint; attention: Attention; rows: Row[]; error?: string };

/** A shown candidate, for --json. `repo` is absolute so a script can run `workwork prompt` there. */
export type Listed = {
  repo: string;
  label: string;
  id: string;
  blueprint: string;
  attention: Attention;
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
  const candidates = ATTENTION.flatMap((attention) =>
    groups
      .filter((group) => group.attention === attention)
      .flatMap(({ blueprint, rows }) =>
        rows.map(({ id, title }) => ({
          repo,
          label,
          id,
          blueprint: blueprint.name,
          attention,
          kind: kindOf(blueprint),
          title,
        })),
      ),
  );
  const errors = groups.flatMap(({ blueprint, error }) =>
    error ? [`${label} ${blueprint.name}: finder failed: ${error}`] : [],
  );
  return { candidates, errors };
}

/** One repo's candidates, grouped by blueprint, cheapest attention first. Compact is one line per attention, for --all. */
export async function listing(
  repo: string,
  label: string,
  options: ListOptions,
): Promise<{ text: string; count: number; failed: number }> {
  const { blueprints, groups, hidden, checks } = await grouped(repo, options);
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const counts = ATTENTION.flatMap((attention) => {
    const n = groups
      .filter((group) => group.attention === attention)
      .reduce((sum, group) => sum + group.rows.length, 0);
    return n ? [`${n} ${attention}`] : [];
  });
  const header = count
    ? `${label}: ${count} candidate${count === 1 ? "" : "s"} (${counts.join(", ")}) · checks: ${checks.join(", ") || "none, so everything gets at least a skim"}`
    : `${label}: nothing to do`;
  const failed = groups.filter((group) => group.error).length;
  if (options.compact) return { text: [header, ...compactLines(groups)].join("\n"), count, failed };

  const unrun = blueprints
    .filter((blueprint) => !hasFinder(blueprint))
    .map((blueprint) => `${blueprint.name} (${blueprint.finder})`);
  const footer = [
    hidden ? `${hidden} hidden by past decisions or open PRs (--all-history shows them).` : "",
    unrun.length ? `Not run, no such finder: ${unrun.join(", ")}.` : "",
    options.blueprint ? "" : onRequestNote(),
  ].filter(Boolean);
  const blocks = ATTENTION.flatMap((attention) => {
    const atAttention = groups.filter((group) => group.attention === attention);
    const scans = atAttention.filter((group) => group.blueprint.finder === "scan" && !group.error);
    return [
      ...atAttention
        .filter((group) => !scans.includes(group))
        .flatMap((group) => fullBlock(group, options.blueprint !== undefined)),
      ...scanBlock(attention, scans),
    ];
  });
  return { text: [header, ...blocks, ...footer].join("\n\n"), count, failed };
}

async function grouped(repo: string, options: ListOptions) {
  const blueprints = selectBlueprints(options.blueprint);
  const [results, history] = await Promise.all([
    findCandidates(repo, blueprints.filter(hasFinder)),
    syncHistory(repo),
  ]);
  const latest = latestDecisions(history.decisions);
  const checks = repoChecks(repo);
  const churn = churnByFile(repo);
  let hidden = 0;

  const groups: Group[] = results.map(({ blueprint, candidates, error }) => {
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
    return { blueprint, attention: effectiveAttention(blueprint, checks), rows, error };
  });
  return { blueprints, groups, hidden, checks };
}

function fullBlock({ blueprint, attention, rows, error }: Group, showAll: boolean): string[] {
  if (error) return [`${attention.padEnd(6)} ${blueprint.name}: finder failed: ${error}`];
  if (rows.length === 0) return [];
  const shown = showAll ? rows : rows.slice(0, SHOWN_PER_PLAY);
  const width = Math.min(48, Math.max(...shown.map(({ id }) => id.length)));
  return [
    [
      `${attention.padEnd(6)} ${blueprint.name} (${rows.length}) · done: ${blueprint.done}`,
      ...shown.map(({ id, text }) => `  ${id.padEnd(width)}  ${text}`),
      ...(rows.length > shown.length
        ? [`  … ${rows.length - shown.length} more: workwork --blueprint ${blueprint.name}`]
        : []),
    ].join("\n"),
  ];
}

/** Scans have one candidate each, the whole repo, so they share a block. */
function scanBlock(attention: Attention, scans: Group[]): string[] {
  const rows = scans.flatMap((group) =>
    group.rows.map((row) => ({ ...row, done: group.blueprint.done })),
  );
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map(({ id }) => id.length));
  return [
    [
      `${attention.padEnd(6)} scans (${rows.length}) · each searches the whole repo · done:`,
      ...rows.map(
        ({ id, done, note }) =>
          `  ${id.padEnd(width)}  ${[done, note].filter(Boolean).join(" · ")}`,
      ),
    ].join("\n"),
  ];
}

function compactLines(groups: Group[]): string[] {
  const lines = ATTENTION.flatMap((attention) => {
    const atAttention = groups.filter(
      (group) => group.attention === attention && group.rows.length,
    );
    const scans = atAttention.filter((group) => group.blueprint.finder === "scan").length;
    const blueprints = [
      ...atAttention
        .filter((group) => group.blueprint.finder !== "scan")
        .map((group) => `${group.blueprint.name} ${group.rows.length}`),
      ...(scans ? [`${scans} scan${scans === 1 ? "" : "s"}`] : []),
    ];
    return blueprints.length ? [`  ${attention.padEnd(6)} ${blueprints.join(" · ")}`] : [];
  });
  const failures = groups.filter((group) => group.error);
  if (failures.length)
    lines.push(
      `  failed ${failures.map((group) => `${group.blueprint.name} (${group.error})`).join(" · ")}`,
    );
  return lines;
}

/** Blueprints kept out of the default listing, so they can still be found. */
export function onRequestNote(): string {
  const names = loadBlueprints()
    .filter((blueprint) => blueprint.onRequest)
    .map((blueprint) => blueprint.name);
  return names.length ? `On request: ${names.join(", ")} (workwork --blueprint <name>).` : "";
}

function selectBlueprints(name: string | undefined): Blueprint[] {
  const blueprints = loadBlueprints();
  if (!name) return blueprints.filter((blueprint) => !blueprint.onRequest);
  const blueprint = blueprints.find((candidate) => candidate.name === name);
  if (!blueprint)
    throw new Error(
      `no blueprint named ${name}. Blueprints: ${blueprints.map((each) => each.name).join(", ")}`,
    );
  return [blueprint];
}

const PAST: Record<Verdict, string> = {
  accept: "accepted",
  reject: "rejected",
  defer: "deferred",
  keep: "kept",
};

/** Rejections and open PRs hide a candidate; any other verdict hides it until one of its files changes. */
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
    gitQuery(repo, ["diff", "--quiet", decision.commit, "--", ...(candidate.files ?? [])]) ===
    undefined;
  return changed
    ? { hidden: false, note: `${note}, changed since`, changed }
    : { hidden: true, note };
}

/** Size and churn, for candidates about their files (not, say, a package listed in package.json). */
function signals(repo: string, candidate: Candidate, churn: Map<string, number>): string {
  const { files, key } = candidate;
  if (!files || (key !== files[0] && !key.startsWith(`${files[0]}#`))) return "";
  const present = files.filter((file) => existsSync(join(repo, file)));
  if (present.length === 0) return "file missing";
  const lines = present.reduce(
    (sum, file) => sum + readFileSync(join(repo, file), "utf8").trimEnd().split("\n").length,
    0,
  );
  const commits = files.reduce((sum, file) => sum + (churn.get(file) ?? 0), 0);
  return [
    ...(files.length > 1 ? [`${files.length} files`] : []),
    plural(lines, "line"),
    `${plural(commits, "commit")}/90d`,
  ].join(", ");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
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
