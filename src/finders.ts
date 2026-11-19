import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git, onPath, run } from "./run.ts";

/** One thing a finder found. `file` is what a decision watches (the whole repo without one): the item comes back once it changes. */
export type Found = { key: string; title: string; file?: string };
type Finder = (repo: string, arg: string | undefined) => Promise<Found[]>;

export const finders: Record<string, Finder> = {
  outdated: async (repo, bump) =>
    (await outdatedPackages(repo)).filter((found) => found.bump === bump),
  knip,
  "kit-drift": kitDrift,
  "kit-status": kitStatus,
  "spec-uncited": specUncited,
  todo,
  scan: async () => [{ key: ".", title: "the whole repo" }],
  rotation,
};

// --- outdated

type Bump = "patch" | "minor" | "major";
type OutdatedInfo = { current?: string; latest: string; dependencyType: string };

// Three plays share one `pnpm outdated` run per repo.
const outdatedRuns = new Map<string, Promise<(Found & { bump: Bump })[]>>();

function outdatedPackages(repo: string) {
  if (!outdatedRuns.has(repo)) outdatedRuns.set(repo, readOutdated(repo));
  return outdatedRuns.get(repo)!;
}

async function readOutdated(repo: string) {
  if (!existsSync(join(repo, "pnpm-lock.yaml")) || !onPath("pnpm")) return [];
  const { code, stdout, stderr } = await run("pnpm", ["outdated", "--format", "json"], repo);
  if (code !== 0 && !/^\{/m.test(stdout))
    throw new Error(lastLine(stderr || stdout) || `pnpm outdated exited with ${code}`);
  return parseOutdated(stdout);
}

export function parseOutdated(json: string): (Found & { bump: Bump })[] {
  // pnpm may print [WARN] lines before the JSON, and they can hold braces too ({"node":">=22"}).
  const start = json.search(/^\{/m);
  const packages = Object.entries(
    JSON.parse(start === -1 ? "{}" : json.slice(start)) as Record<string, OutdatedInfo>,
  );
  return packages.flatMap(([name, { current, latest, dependencyType }]) =>
    current
      ? [
          {
            key: name,
            title: `${current} → ${latest}${dependencyType === "devDependencies" ? ", dev" : ""}`,
            file: "package.json",
            bump: bumpOf(current, latest),
          },
        ]
      : [],
  );
}

/** Below 1.0 a minor bump may break, so it counts as major. */
function bumpOf(current: string, latest: string): Bump {
  const [from, to] = [current, latest].map((version) => version.split(".").map(Number));
  if (from[0] !== to[0] || (from[0] === 0 && from[1] !== to[1])) return "major";
  return from[1] !== to[1] ? "minor" : "patch";
}

// --- knip

type KnipIssue = {
  file: string;
  files: unknown[];
  exports: { name: string; line: number }[];
  types: { name: string; line: number }[];
};

async function knip(repo: string): Promise<Found[]> {
  if (!usesKnip(repo)) return [];
  const { stdout, stderr } = await run(
    "pnpm",
    ["exec", "knip", "--no-progress", "--reporter", "json"],
    repo,
  );
  if (!stdout.trim()) throw new Error(stderr.trim() || "knip printed nothing");
  return parseKnip(stdout);
}

function usesKnip(repo: string): boolean {
  const pkg = join(repo, "package.json");
  if (!existsSync(pkg)) return false;
  const { dependencies, devDependencies } = JSON.parse(readFileSync(pkg, "utf8"));
  return Boolean({ ...dependencies, ...devDependencies }.knip);
}

/**
 * knip's JSON report is one line, but `pnpm exec` may print an install before it on the same
 * stdout: pnpm 11 installs out-of-date dependencies first ("✓ Lockfile passes supply-chain
 * policies", "Done in 1.4s"). Without a report line, the error names what was printed instead.
 */
export function parseKnip(stdout: string): Found[] {
  const report = stdout.split("\n").find((line) => line.startsWith("{"));
  if (!report) throw new Error(`knip printed no JSON report: ${lastLine(stdout)}`);
  const { issues } = JSON.parse(report) as { issues: KnipIssue[] };
  return issues.flatMap(({ file, files, exports, types }) => [
    ...(files.length ? [{ key: file, title: "unused file", file }] : []),
    ...[...exports, ...types].map(({ name, line }) => ({
      key: `${file}#${name}`,
      title: `unused export ${name} (line ${line})`,
      file,
    })),
  ]);
}

// --- kit

function usesKit(repo: string): boolean {
  return existsSync(join(repo, ".kit.json")) && onPath("kit");
}

async function kitDrift(repo: string): Promise<Found[]> {
  if (!usesKit(repo)) return [];
  const { stdout, stderr } = await run("kit", ["check"], repo);
  const found = parseKitCheck(stdout);
  // Its exit code also covers knip, which the knip play handles; only a check that never compared is a failure.
  if (found.length === 0 && !/OK: vendored|No vendored components/.test(stdout))
    throw new Error(lastLine(stderr || stdout));
  return found;
}

export function parseKitCheck(output: string): Found[] {
  return [...output.matchAll(/^(DRIFT|missing)\s+(\S+)/gm)].map(([, kind, path]) => ({
    key: path,
    title: kind === "DRIFT" ? "vendored file differs from upstream" : "vendored file missing",
    file: path,
  }));
}

async function kitStatus(repo: string): Promise<Found[]> {
  if (!usesKit(repo)) return [];
  const { code, stdout, stderr } = await run("kit", ["upgrade"], repo);
  if (code !== 0) throw new Error(lastLine(stderr || stdout));
  return [...stdout.matchAll(/^## (r\d+)[^\n]*\n+([^\n]+)/gm)].map(([, revision, summary]) => ({
    key: revision,
    title: summary.split(/(?<=\.)\s/)[0],
    file: ".kit.json",
  }));
}

function lastLine(text: string): string {
  return text.trim().split("\n").pop() ?? "";
}

// --- spec-uncited

const SLUG = String.raw`[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+`;
const CITATION = new RegExp(String.raw`["'\x60](${SLUG}):`, "g");

async function specUncited(repo: string): Promise<Found[]> {
  const files = git(repo, ["ls-files"]).split("\n");
  const specs = files.filter(
    (file) => file.startsWith("spec/") && file.endsWith(".md") && file !== "spec/README.md",
  );
  if (specs.length === 0) return [];
  const tests = files.filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file));
  const cited = new Set(
    tests.flatMap((file) =>
      [...readFileSync(join(repo, file), "utf8").matchAll(CITATION)].map((match) => match[1]),
    ),
  );
  return specs.flatMap((file) =>
    specRules(readFileSync(join(repo, file), "utf8"))
      .filter((rule) => !cited.has(rule.slug))
      .map((rule) => ({ key: rule.slug, title: `${file}: ${rule.text}`, file })),
  );
}

/** Rules are backticked slugs in the first column of a table headed "Rule"; the other cells describe them. */
function specRules(markdown: string): { slug: string; text: string }[] {
  const rules: { slug: string; text: string }[] = [];
  let table: "none" | "rule" | "other" = "none";
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) {
      table = "none";
      continue;
    }
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    if (table === "none") {
      table = cells[0] === "Rule" ? "rule" : "other";
      continue;
    }
    const slug = new RegExp(`^\`(${SLUG})\`$`).exec(cells[0])?.[1];
    if (table === "rule" && slug) rules.push({ slug, text: cells.slice(1).join(" → ") });
  }
  return rules;
}

// --- todo

async function todo(repo: string): Promise<Found[]> {
  const path = join(repo, "TODO.md");
  return existsSync(path) ? todoItems(readFileSync(path, "utf8")) : [];
}

/** Unchecked items in TODO.md, keyed by their first words so the id survives edits further along the line. */
function todoItems(markdown: string): Found[] {
  const items: Found[] = [];
  for (const line of markdown.split("\n")) {
    const item = /^\s*[-*] \[ \] (.+)/.exec(line)?.[1];
    if (!item) continue;
    const base = item
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 5)
      .join("-");
    const taken = items.filter(
      (found) => found.key === base || found.key.startsWith(`${base}~`),
    ).length;
    items.push({ key: taken ? `${base}~${taken + 1}` : base, title: item, file: "TODO.md" });
  }
  return items;
}

// --- rotation

const CODE =
  /\.(c|cc|cjs|clj|cpp|cs|css|cts|ex|exs|go|h|hpp|java|js|jsx|kt|lua|mjs|mts|php|py|rb|rs|scala|scss|sh|svelte|swift|ts|tsx|vue|zig)$/;
const TEST = /\.(test|spec)\.[^/]+$|(^|\/)(tests?|__tests__)\//;

/** Every tracked code file (or only test files, with `tests`), largest first. Vendored and generated files are skipped. */
async function rotation(repo: string, arg: string | undefined): Promise<Found[]> {
  const files = git(repo, ["ls-files"])
    .split("\n")
    .filter(
      (file) => CODE.test(file) && !file.endsWith(".d.ts") && TEST.test(file) === (arg === "tests"),
    );
  if (files.length === 0) return [];
  const marked = new Set(
    git(repo, ["check-attr", "--stdin", "linguist-vendored", "linguist-generated"], {
      input: files.join("\n"),
    })
      .split("\n")
      .filter((line) => /: (set|true)$/.test(line))
      .map((line) => line.slice(0, line.indexOf(": linguist-"))),
  );
  return files
    .filter((file) => !marked.has(file) && existsSync(join(repo, file)))
    .map((file) => ({
      file,
      lines: readFileSync(join(repo, file), "utf8").trimEnd().split("\n").length,
    }))
    .sort((a, b) => b.lines - a.lines)
    .map(({ file }) => ({ key: file, title: "", file }));
}
