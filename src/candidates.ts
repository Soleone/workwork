import { finders, type Found } from "./finders.ts";
import type { Attention, Blueprint } from "./blueprints.ts";

export type Candidate = Found & { id: string };
export type BlueprintResult = { blueprint: Blueprint; candidates: Candidate[]; error?: string };

export function hasFinder(blueprint: Blueprint): boolean {
  return finderOf(blueprint).name in finders;
}

/** Runs each blueprint's finder. A failing finder is reported with its blueprint instead of failing the listing. */
export function findCandidates(repo: string, blueprints: Blueprint[]): Promise<BlueprintResult[]> {
  return Promise.all(
    blueprints.map(async (blueprint) => {
      const { name, arg } = finderOf(blueprint);
      try {
        const found = await finders[name](repo, arg);
        return {
          blueprint,
          candidates: found.map((item) => ({ ...item, id: `${blueprint.name}/${item.key}` })),
        };
      } catch (error) {
        return { blueprint, candidates: [], error: (error as Error).message.split("\n")[0] };
      }
    }),
  );
}

/**
 * What a candidate is based on. finding: a tool reported this exact thing (an outdated package, an
 * unused export, a TODO). batch: related files read together, with nothing known to be wrong in them.
 * scan: the whole repo, for an agent to search. Batches and scans say where to look, not that anyone has.
 */
export type Kind = "finding" | "batch" | "scan";

export function kindOf(blueprint: Blueprint): Kind {
  const { name } = finderOf(blueprint);
  return name === "scan" || name === "batch" ? name : "finding";
}

/** none requires a mechanical check that passed, so a repo without checks gets skim instead. */
export function effectiveAttention(blueprint: Blueprint, checks: string[]): Attention {
  return blueprint.attention === "none" && checks.length === 0 ? "skim" : blueprint.attention;
}

function finderOf(blueprint: Blueprint): { name: string; arg?: string } {
  const [name, arg] = blueprint.finder.split(/\s+/, 2);
  return { name, arg };
}
