import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ATTENTION = ["none", "skim", "decide"] as const;
export type Attention = (typeof ATTENTION)[number];

export type Blueprint = {
  name: string;
  attention: Attention;
  /** One sentence on what the blueprint does, for people choosing what to run. */
  description: string;
  /** Finder name, optionally followed by an argument: "outdated patch". */
  finder: string;
  done: string;
  /** Listed only when asked for by name. */
  onRequest: boolean;
  prompt: string;
  /** The user's own, saved in their config folder rather than shipped with workwork. */
  custom: boolean;
};

const BUILT_IN = fileURLToPath(new URL("../blueprints", import.meta.url));

/** The user's blueprints and settings: $DATA/apps/workwork when DATA is set, else ~/.config/workwork. */
export function configDir(): string {
  if (process.env.DATA) return join(process.env.DATA, "apps", "workwork");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "workwork");
}

const yours = () => join(configDir(), "blueprints");

/**
 * Built-in blueprints, then the user's: a user blueprint replaces the built-in one of the same name.
 * Blueprints were called plays before 0.3, so the user's old plays folder is still read.
 */
export function loadBlueprints(): Blueprint[] {
  const byName = new Map<string, Blueprint>();
  for (const dir of [BUILT_IN, join(configDir(), "plays"), yours()]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
      const path = join(dir, file);
      const blueprint = parseBlueprint(readFileSync(path, "utf8"), path, dir !== BUILT_IN);
      byName.set(blueprint.name, blueprint);
    }
  }
  return [...byName.values()].sort(
    (a, b) =>
      ATTENTION.indexOf(a.attention) - ATTENTION.indexOf(b.attention) ||
      a.name.localeCompare(b.name),
  );
}

/** Writes one of the user's blueprints, replacing any of theirs with that name. */
export function saveBlueprint(blueprint: Omit<Blueprint, "custom">): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(blueprint.name))
    throw new Error(
      `a blueprint name is lowercase letters, digits and dashes, got ${blueprint.name}`,
    );
  const { prompt, onRequest, ...fields } = blueprint;
  const lines = Object.entries({ ...fields, "on-request": onRequest })
    .filter(([, value]) => value !== "" && value !== false)
    .map(([key, value]) => `${key}: ${String(value)}`);
  if (lines.some((line) => line.includes("\n"))) throw new Error("only the prompt can span lines");
  const text = `---\n${lines.join("\n")}\n---\n\n${prompt.trim()}\n`;
  const file = join(yours(), `${blueprint.name}.md`);
  parseBlueprint(text, file, true);
  mkdirSync(yours(), { recursive: true });
  writeFileSync(file, text);
  return file;
}

export function deleteBlueprint(name: string): void {
  const file = join(yours(), `${name}.md`);
  if (!existsSync(file)) throw new Error(`no blueprint of yours named ${name}`);
  rmSync(file);
}

function parseBlueprint(text: string, file: string, custom: boolean): Blueprint {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file}: expected frontmatter between --- lines`);
  const fields = new Map(
    match[1].split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
  );
  // level, auto and rotation are the names from before 0.3.
  const legacy = fields.get("level");
  const attention = (fields.get("attention") ?? (legacy === "auto" ? "none" : legacy)) as Attention;
  if (!ATTENTION.includes(attention))
    throw new Error(`${file}: attention must be one of ${ATTENTION.join(", ")}`);
  const name = fields.get("name");
  const done = fields.get("done");
  if (!name || !done) throw new Error(`${file}: name and done are required`);
  return {
    name,
    attention,
    description: fields.get("description") ?? "",
    finder: (fields.get("finder") || "scan").replace(/^rotation\b/, "batch"),
    done,
    onRequest: fields.get("on-request") === "true",
    prompt: match[2].trim(),
    custom,
  };
}
