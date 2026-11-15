#!/usr/bin/env node
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { listing } from "./list.ts";
import { syncHistory } from "./outcomes.ts";
import { prompt } from "./prompt.ts";
import { ownedRepos, repoRoot } from "./repo.ts";
import { git } from "./run.ts";
import { recordDecisions, VERDICTS, type Verdict } from "./store.ts";

const USAGE = `workwork: find agent work, sorted by how much human attention it needs

  workwork [--play <name>] [--all-history]     candidates in this repo
  workwork --all                               candidates in every repo of yours under $SRC
  workwork prompt <id>                         a self-contained prompt for one candidate
  workwork decide <id> accept|reject|defer ["reason in the user's words"]
  workwork history [--rejected] [--play <name>]

Levels: auto (a check defines correct; a digest is enough), skim (same behavior, small diff;
skim and accept), decide (changes behavior or needs product judgment).`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: "boolean" },
      play: { type: "string" },
      "all-history": { type: "boolean" },
      rejected: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...args] = positionals;
  if (values.help) return console.log(USAGE);
  if (command === undefined)
    return list(values.all ?? false, { play: values.play, allHistory: values["all-history"] });
  if (command === "prompt")
    return console.log(await prompt(repoRoot("."), required(args[0], "an id")));
  if (command === "decide") return decide(args);
  if (command === "history") return history(values.rejected ?? false, values.play);
  throw new Error(`unknown command ${command}\n\n${USAGE}`);
}

async function list(all: boolean, options: { play?: string; allHistory?: boolean }): Promise<void> {
  const src = process.env.SRC ?? join(homedir(), "src");
  const repos = all ? await ownedRepos(src) : [repoRoot(".")];
  let total = 0;
  // Repos run one at a time: some finders (kit check) are heavy enough on their own.
  for (const repo of repos) {
    const label = repo.startsWith(src) ? relative(src, repo) : repo;
    const { text, count } = await listing(repo, label, options);
    console.log(`${text}\n`);
    total += count;
  }
  if (total) console.log(`Ready to work: ${all ? "cd <repo> && " : ""}workwork prompt <id>`);
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
      source: "chat",
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

function required(value: string | undefined, what: string): string {
  if (!value) throw new Error(`missing ${what}\n\n${USAGE}`);
  return value;
}

main().catch((error: Error) => {
  console.error(`workwork: ${error.message}`);
  process.exitCode = 1;
});
