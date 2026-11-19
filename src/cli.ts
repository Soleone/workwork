#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { listed, listing, onRequestNote, type Listed } from "./list.ts";
import { syncHistory } from "./outcomes.ts";
import { loadPlays } from "./plays.ts";
import { prompt } from "./prompt.ts";
import { ownedRepos, repoRoot } from "./repo.ts";
import { git, onPath } from "./run.ts";
import { recordDecisions, VERDICTS, type Verdict } from "./store.ts";

const USAGE = `workwork: find agent work, sorted by how much human attention it needs

  workwork [--play <name>] [--all-history]   candidates in this repo
  workwork --all                             a summary for every repo of yours under $SRC
                                             (or under this directory when SRC isn't set)
  workwork [--all] --json                    the shown candidates as a JSON array, for scripts;
                                             failed finders go to stderr
  workwork plays [--json]                    every play with its level and what it does
  workwork prompt <id>                       a self-contained prompt for one candidate
  workwork decide <id> <verdict> ["reason"]  accept, reject or defer, in the user's words;
                                             keep when an agent looked and nothing should change
  workwork history [--rejected] [--play <name>]

Levels: auto (a check defines correct; a digest is enough), skim (same behavior, small diff;
skim and accept), decide (changes behavior or needs product judgment).`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: "boolean" },
      json: { type: "boolean" },
      play: { type: "string" },
      "all-history": { type: "boolean" },
      rejected: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...args] = positionals;
  if (values.help) return console.log(USAGE);
  if (values.version) return console.log(version());
  const options = { play: values.play, allHistory: values["all-history"] };
  if (command === undefined && values.json) return json(values.all ?? false, options);
  if (command === undefined) return list(values.all ?? false, options);
  if (command === "plays") return plays(values.json ?? false);
  if (command === "prompt")
    return console.log(await prompt(repoRoot("."), required(args[0], "an id")));
  if (command === "decide") return decide(args);
  if (command === "history") return history(values.rejected ?? false, values.play);
  throw new Error(`unknown command ${command}\n\n${USAGE}`);
}

// Repos are labeled relative to here.
const SRC = process.env.SRC ?? process.cwd();

async function list(all: boolean, options: { play?: string; allHistory?: boolean }): Promise<void> {
  warnStaleEngram();
  if (!all) {
    const repo = repoRoot(".");
    const { text, count } = await listing(repo, label(repo), options);
    console.log(text);
    if (count) console.log("\nReady to work: workwork prompt <id>");
    return;
  }
  const repos = await ownedRepos(SRC);
  if (repos.length === 0) return console.log(`No repos of yours under ${SRC}.`);
  let idle = 0;
  // Repos run one at a time: some finders (kit check) are heavy enough on their own.
  for (const repo of repos) {
    const { text, count, failed } = await listing(repo, label(repo), {
      ...options,
      compact: true,
    });
    if (count + failed === 0) idle++;
    else console.log(text);
  }
  if (idle) console.log(`${idle} other repos: nothing to do.`);
  console.log(
    `\n${[onRequestNote(), "Details: cd <repo> && workwork"].filter(Boolean).join("\n")}`,
  );
}

async function json(all: boolean, options: { play?: string; allHistory?: boolean }): Promise<void> {
  const repos = all ? await ownedRepos(SRC) : [repoRoot(".")];
  const candidates: Listed[] = [];
  for (const repo of repos) {
    const found = await listed(repo, label(repo), options);
    candidates.push(...found.candidates);
    for (const error of found.errors) console.error(`workwork: ${error}`);
  }
  console.log(JSON.stringify(candidates, null, 2));
}

function plays(json: boolean): void {
  const shown = loadPlays().map(({ name, level, description, onRequest }) => ({
    name,
    level,
    description,
    onRequest,
  }));
  if (json) return console.log(JSON.stringify(shown, null, 2));
  const width = Math.max(...shown.map(({ name }) => name.length));
  for (const play of shown)
    console.log(
      `${play.name.padEnd(width)}  ${play.level.padEnd(6)}  ${play.description}${play.onRequest ? " (on request)" : ""}`,
    );
}

function decide([id, verdict, ...words]: string[]): void {
  const slash = required(id, "an id").indexOf("/");
  if (slash < 1) throw new Error(`ids look like <play>/<path>, got ${id}`);
  if (!VERDICTS.includes(verdict as Verdict))
    throw new Error(`decide needs one of ${VERDICTS.join(", ")}`);
  const repo = repoRoot(".");
  const reason = words.join(" ");
  const commit = git(repo, ["rev-parse", "HEAD"]);
  const date = new Date().toISOString();
  const where = recordDecisions(repo, [
    {
      id,
      play: id.slice(0, slash),
      path: id.slice(slash + 1),
      commit,
      decision: verdict as Verdict,
      reason,
      source: verdict === "keep" ? "agent" : "chat",
      date,
    },
  ]);
  console.log(`Recorded ${verdict} for ${id} in ${where}.`);
}

async function history(rejectedOnly: boolean, play: string | undefined): Promise<void> {
  const { decisions } = await syncHistory(repoRoot("."));
  const shown = decisions
    .filter(
      (decision) =>
        (!rejectedOnly || decision.decision === "reject") && (!play || decision.play === play),
    )
    .reverse();
  if (shown.length === 0) return console.log("No decisions recorded.");
  for (const decision of shown) {
    const source = decision.ref ? `${decision.source} ${decision.ref}` : decision.source;
    console.log(
      `${decision.date.slice(0, 10)}  ${decision.decision.padEnd(6)}  ${decision.id}  (${source})${decision.reason ? `  "${decision.reason}"` : ""}`,
    );
  }
}

/** Prompts point agents at engram for why code exists; a stale index gives them old answers. */
function warnStaleEngram(): void {
  const index = join(homedir(), ".engram", "index.sqlite");
  if (!onPath("engram") || !existsSync(index)) return;
  const days = Math.floor((Date.now() - statSync(index).mtimeMs) / 86_400_000);
  if (days > 7)
    console.error(
      `workwork: the engram index is ${days} days old (engram ingest, or engram watch)`,
    );
}

function label(repo: string): string {
  const path = relative(SRC, repo);
  return path && !path.startsWith("..") ? path : repo;
}

function version(): string {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
}

function required(value: string | undefined, what: string): string {
  if (!value) throw new Error(`missing ${what}\n\n${USAGE}`);
  return value;
}

main().catch((error: Error) => {
  console.error(`workwork: ${error.message}`);
  process.exitCode = 1;
});
