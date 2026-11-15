import { readFileSync } from "node:fs";
import { effectiveLevel, findCandidates, hasFinder } from "./candidates.ts";
import { loadPlays } from "./plays.ts";
import { repoChecks } from "./repo.ts";
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
  const branch = `workwork/${id.replace(/[^\w./@-]+/g, "-")}`;

  return `# workwork: ${id}

Repo: ${repo}
Play: ${play.name}
Candidate: ${candidate.title}
Level: ${level}${level === "decide" ? "" : ". You may raise it if the change needs more of the user's attention than that; never lower it"}.
${past ? `Past decision: ${past.decision} on ${past.date.slice(0, 10)}${past.reason ? `, "${past.reason}"` : ""}. It informs, it doesn't forbid: if the code changed so the reason no longer holds, go ahead and quote it in the PR.\n` : ""}
## Task

${play.prompt}

Start with the shortest credible pass; stop when more work is unlikely to change the result.

Everything here is a default: level, scope, grouping, even doing it at all. When you deviate, say why in one sentence in the PR body. If nothing should change, change nothing and answer KEEP with one sentence why.

## Done when

- ${play.done[0].toUpperCase()}${play.done.slice(1)}.
- Checks in this repo: ${checks.length ? checks.map((check) => `\`${check}\``).join(", ") : "none. Nothing can be auto here; say so under Checks"}.${level === "auto" ? "\n- auto holds only if those checks pass; if they don't, raise the level to skim." : ""}

## Deliver

${
  level === "decide"
    ? "If the answer is a product decision rather than code, don't open a PR. Reply with what, why, the cost of each option and the one question the user has to answer, in a few lines.\n\nIf it is code:\n\n"
    : ""
}- Branch \`${branch}\` from the default branch. Never push to the default branch or to a fork.
- One commit for this candidate, conventional style, ending with the trailer line \`Workwork: ${id}\`.
- Push and open a PR labeled \`workwork\` (create the label if it's missing). Its body has these headings, with \`None\` under an empty one:
  \`## Summary\`, \`## Changes\`, \`## Checks\`, \`## Assumptions\`
  and ends with the lines \`Level: ${level}\`, \`Play: ${play.name}\`, \`Done check: ${play.done}\`.

## Standard

${LEAN}
`;
}
