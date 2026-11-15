import { finders, type Found } from "./finders.ts";
import type { Level, Play } from "./plays.ts";

export type Candidate = Found & { id: string };
export type PlayResult = { play: Play; candidates: Candidate[]; error?: string };

export function hasFinder(play: Play): boolean {
  return finderOf(play).name in finders;
}

/** Runs each play's finder. A failing finder is reported with its play instead of failing the listing. */
export function findCandidates(repo: string, plays: Play[]): Promise<PlayResult[]> {
  return Promise.all(
    plays.map(async (play) => {
      const { name, arg } = finderOf(play);
      try {
        const found = await finders[name](repo, arg);
        return {
          play,
          candidates: found.map((item) => ({ ...item, id: `${play.name}/${item.key}` })),
        };
      } catch (error) {
        return { play, candidates: [], error: (error as Error).message.split("\n")[0] };
      }
    }),
  );
}

/** auto requires a mechanical check that passed, so a repo without checks gets skim instead. */
export function effectiveLevel(play: Play, checks: string[]): Level {
  return play.level === "auto" && checks.length === 0 ? "skim" : play.level;
}

function finderOf(play: Play): { name: string; arg?: string } {
  const [name, arg] = play.finder.split(/\s+/, 2);
  return { name, arg };
}
