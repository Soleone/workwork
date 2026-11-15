import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LEVELS = ["auto", "skim", "decide"] as const;
export type Level = (typeof LEVELS)[number];

export type Play = {
  name: string;
  level: Level;
  /** Finder name, optionally followed by an argument: "outdated patch". */
  finder: string;
  done: string;
  /** Listed only when asked for by name. */
  onRequest: boolean;
  prompt: string;
};

const BUILT_IN = fileURLToPath(new URL("../plays", import.meta.url));

/** The user's plays and settings: $DATA/apps/workwork when DATA is set, else ~/.config/workwork. */
export function configDir(): string {
  if (process.env.DATA) return join(process.env.DATA, "apps", "workwork");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "workwork");
}

/** Built-in plays, then the user's: a user play replaces the built-in one of the same name. */
export function loadPlays(): Play[] {
  const byName = new Map<string, Play>();
  for (const dir of [BUILT_IN, join(configDir(), "plays")]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
      const play = parsePlay(join(dir, file));
      byName.set(play.name, play);
    }
  }
  return [...byName.values()].sort(
    (a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.name.localeCompare(b.name),
  );
}

function parsePlay(file: string): Play {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
  if (!match) throw new Error(`${file}: expected frontmatter between --- lines`);
  const fields = new Map(
    match[1].split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
  );
  const level = fields.get("level") as Level;
  if (!LEVELS.includes(level))
    throw new Error(`${file}: level must be one of ${LEVELS.join(", ")}`);
  const name = fields.get("name");
  const done = fields.get("done");
  if (!name || !done) throw new Error(`${file}: name and done are required`);
  return {
    name,
    level,
    finder: fields.get("finder") || "scan",
    done,
    onRequest: fields.get("on-request") === "true",
    prompt: match[2].trim(),
  };
}
