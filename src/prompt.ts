import { readFileSync } from "node:fs";
import { effectiveAttention, findCandidates, hasFinder, kindOf } from "./candidates.ts";
import { loadBlueprints } from "./blueprints.ts";
import { repoChecks } from "./repo.ts";
import { onPath } from "./run.ts";
import { latestDecisions, readDecisions } from "./store.ts";

const LEAN = readFileSync(new URL("../prompts/lean.md", import.meta.url), "utf8").trim();

/** A self-contained prompt for one candidate, for whichever agent has tokens to spare. */
export async function prompt(repo: string, id: string): Promise<string> {
  const blueprintName = id.split("/")[0];
  const blueprint = loadBlueprints().find((each) => each.name === blueprintName);
  if (!blueprint) throw new Error(`no blueprint named ${blueprintName}`);
  if (!hasFinder(blueprint))
    throw new Error(`${blueprint.name} has no finder built yet (${blueprint.finder})`);
  const [{ candidates, error }] = await findCandidates(repo, [blueprint]);
  if (error) throw new Error(`${blueprint.name} finder failed: ${error}`);
  const candidate = candidates.find((each) => each.id === id);
  if (!candidate) throw new Error(`${id} isn't a current candidate. Run workwork to list them.`);

  const checks = repoChecks(repo);
  const attention = effectiveAttention(blueprint, checks);
  const past = latestDecisions(readDecisions(repo)).get(id);
  const scan = blueprint.finder === "scan";
  const batch = kindOf(blueprint) === "batch";
  // A scan's findings get their own ids, so its commits, branches and issues name those.
  const each = scan ? `${blueprint.name}/<path>` : id;
  const branch = scan
    ? `workwork/${blueprint.name}/<area>`
    : `workwork/${id.replace(/[^\w./@-]+/g, "-")}`;
  const keep = `workwork decide ${id} keep "<one sentence why>"`;
  const subject = batch
    ? `This candidate is a batch of related files, read together so a change can cross them:\n\n${candidate.files!.map((file) => `- \`${file}\``).join("\n")}\n\nIf nothing in them should change`
    : `This candidate is \`${candidate.key}\`. If nothing should change`;

  return `# workwork: ${id}

Repo: ${repo}
Blueprint: ${blueprint.name}
Candidate: ${batch ? candidate.key : candidate.title || candidate.key}
Attention: ${attention}${attention === "decide" ? "" : ". You may raise it if the change needs more of the user's attention than that; never lower it"}.
${past ? `Past decision: ${past.decision} on ${past.date.slice(0, 10)}${past.reason ? `, "${past.reason}"` : ""}. It informs, it doesn't forbid: if the code changed so the reason no longer holds, go ahead and quote it in the PR.\n` : ""}
## Task

${blueprint.prompt}

${
  scan
    ? `This is a scan: search the whole repo for what the task describes. Report only findings worth the user's attention; none is a fine result. Each finding gets its own id, \`${blueprint.name}/<path>\`, where <path> is the file it is mostly about. When the scan is done, whatever it found, run \`workwork decide ${id} keep "<what you found, with PR or issue numbers>"\` so it isn't repeated until the code changes.`
    : `${subject}, change nothing and run \`${keep}\` so it isn't offered again until it changes.`
}

${
  batch && onPath("engram")
    ? "Before removing code whose purpose is unclear, run `engram explain <file>:<start>-<end>` to find the conversation that added it: that separates a fallback for a case that can't happen from a real safeguard.\n\n"
    : ""
}Start with the shortest credible pass; stop when more work is unlikely to change the result.

Everything here is a default: attention, scope, grouping, even doing it at all. When you deviate, say why in one sentence in the PR body.

## Done when

- ${blueprint.done[0].toUpperCase()}${blueprint.done.slice(1)}.
- Checks in this repo: ${checks.length ? checks.map((check) => `\`${check}\``).join(", ") : "none. So nothing here can have attention none; say so under Checks"}.${attention === "none" ? "\n- none holds only if those checks pass; if they don't, raise the attention to skim." : ""}

## Deliver

${
  attention === "decide"
    ? `If the answer is a product decision rather than code, don't open a PR. Open a GitHub issue labeled \`workwork\` (create the label if it's missing) with what, why, the cost of each option and the one question the user has to answer, in a few lines, and end its body with the line \`Workwork: ${each}\`.\n\nIf it is code:\n\n`
    : ""
}- Branch \`${branch}\` from the default branch. Never push to the default branch or to a fork.
- One commit per ${scan ? "finding" : batch ? "change, so one can be reverted alone" : "candidate"}, conventional style, ending with the trailer line \`Workwork: ${each}\`.
- Push and open ${scan ? "one PR per area, never mixing attention," : "a PR"} labeled \`workwork\` (create the label if it's missing). Its body has these headings, with \`None\` under an empty one:
  \`## Summary\`, \`## Changes\`, \`## Checks\`, \`## Assumptions\`
  and ends with the lines \`Attention: ${attention}\`, \`Blueprint: ${blueprint.name}\`, \`Done check: ${blueprint.done}\`.

## Standard

${LEAN}
`;
}
