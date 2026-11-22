import { readFileSync } from "node:fs";
import { effectiveLevel, findCandidates, hasFinder, kindOf } from "./candidates.ts";
import { loadPlays } from "./plays.ts";
import { repoChecks } from "./repo.ts";
import { onPath } from "./run.ts";
import { latestDecisions, readDecisions } from "./store.ts";

const LEAN = readFileSync(new URL("../prompts/lean.md", import.meta.url), "utf8").trim();

/** A self-contained prompt for one candidate, for whichever agent has tokens to spare. */
export async function prompt(repo: string, id: string): Promise<string> {
  const playName = id.split("/")[0];
  const play = loadPlays().find((each) => each.name === playName);
  if (!play) throw new Error(`no play named ${playName}`);
  if (!hasFinder(play)) throw new Error(`${play.name} has no finder built yet (${play.finder})`);
  const [{ candidates, error }] = await findCandidates(repo, [play]);
  if (error) throw new Error(`${play.name} finder failed: ${error}`);
  const candidate = candidates.find((each) => each.id === id);
  if (!candidate) throw new Error(`${id} isn't a current candidate. Run workwork to list them.`);

  const checks = repoChecks(repo);
  const level = effectiveLevel(play, checks);
  const past = latestDecisions(readDecisions(repo)).get(id);
  const scan = play.finder === "scan";
  const rotation = kindOf(play) === "rotation";
  // A scan's findings get their own ids, so its commits, branches and issues name those.
  const each = scan ? `${play.name}/<path>` : id;
  const branch = scan
    ? `workwork/${play.name}/<area>`
    : `workwork/${id.replace(/[^\w./@-]+/g, "-")}`;
  const keep = `workwork decide ${id} keep "<one sentence why>"`;
  const subject = rotation
    ? `This candidate is a batch of related files, read together so a change can cross them:\n\n${candidate.files!.map((file) => `- \`${file}\``).join("\n")}\n\nIf nothing in them should change`
    : `This candidate is \`${candidate.key}\`. If nothing should change`;

  return `# workwork: ${id}

Repo: ${repo}
Play: ${play.name}
Candidate: ${rotation ? candidate.key : candidate.title || candidate.key}
Level: ${level}${level === "decide" ? "" : ". You may raise it if the change needs more of the user's attention than that; never lower it"}.
${past ? `Past decision: ${past.decision} on ${past.date.slice(0, 10)}${past.reason ? `, "${past.reason}"` : ""}. It informs, it doesn't forbid: if the code changed so the reason no longer holds, go ahead and quote it in the PR.\n` : ""}
## Task

${play.prompt}

${
  scan
    ? `This is a scan: search the whole repo for what the task describes. Report only findings worth the user's attention; none is a fine result. Each finding gets its own id, \`${play.name}/<path>\`, where <path> is the file it is mostly about. When the scan is done, whatever it found, run \`workwork decide ${id} keep "<what you found, with PR or issue numbers>"\` so it isn't repeated until the code changes.`
    : `${subject}, change nothing and run \`${keep}\` so it isn't offered again until it changes.`
}

${
  rotation && onPath("engram")
    ? "Before removing code whose purpose is unclear, run `engram explain <file>:<start>-<end>` to find the conversation that added it: that separates a fallback for a case that can't happen from a real safeguard.\n\n"
    : ""
}Start with the shortest credible pass; stop when more work is unlikely to change the result.

Everything here is a default: level, scope, grouping, even doing it at all. When you deviate, say why in one sentence in the PR body.

## Done when

- ${play.done[0].toUpperCase()}${play.done.slice(1)}.
- Checks in this repo: ${checks.length ? checks.map((check) => `\`${check}\``).join(", ") : "none. Nothing can be auto here; say so under Checks"}.${level === "auto" ? "\n- auto holds only if those checks pass; if they don't, raise the level to skim." : ""}

## Deliver

${
  level === "decide"
    ? `If the answer is a product decision rather than code, don't open a PR. Open a GitHub issue labeled \`workwork\` (create the label if it's missing) with what, why, the cost of each option and the one question the user has to answer, in a few lines, and end its body with the line \`Workwork: ${each}\`.\n\nIf it is code:\n\n`
    : ""
}- Branch \`${branch}\` from the default branch. Never push to the default branch or to a fork.
- One commit per ${scan ? "finding" : rotation ? "change, so one can be reverted alone" : "candidate"}, conventional style, ending with the trailer line \`Workwork: ${each}\`.
- Push and open ${scan ? "one PR per area, never mixing levels," : "a PR"} labeled \`workwork\` (create the label if it's missing). Its body has these headings, with \`None\` under an empty one:
  \`## Summary\`, \`## Changes\`, \`## Checks\`, \`## Assumptions\`
  and ends with the lines \`Level: ${level}\`, \`Play: ${play.name}\`, \`Done check: ${play.done}\`.

## Standard

${LEAN}
`;
}
