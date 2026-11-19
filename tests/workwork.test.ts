import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { finders, parseKitCheck, parseKnip, parseOutdated } from "../src/finders.ts";
import { listed, listing } from "../src/list.ts";
import { loadPlays } from "../src/plays.ts";
import { readDecisions, recordDecisions, type Decision } from "../src/store.ts";

const scratch = mkdtempSync(join(tmpdir(), "workwork-test-"));

beforeAll(() => {
  // Isolate git from the user's config (hooks, signing) and workwork from the user's plays.
  const gitconfig = join(scratch, "gitconfig");
  writeFileSync(
    gitconfig,
    "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n",
  );
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.DATA = join(scratch, "data");
});

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(scratch, "repo-"));
  sh(dir, "init", "-q");
  commitFiles(dir, files);
  return dir;
}

function commitFiles(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "change");
}

function decision(repo: string, id: string, verdict: Decision["decision"], reason = ""): Decision {
  const commit = sh(repo, "rev-parse", "HEAD").trim();
  const [play, path] = id.split("/");
  return {
    id,
    play,
    path,
    commit,
    decision: verdict,
    reason,
    source: "chat",
    date: new Date().toISOString(),
  };
}

describe("decisions", () => {
  test("two machines appending at once both keep their decisions", () => {
    const origin = mkdtempSync(join(scratch, "origin-"));
    sh(origin, "init", "-q", "--bare");
    const seed = repoWith({ "README.md": "hi\n" });
    sh(seed, "push", "-q", origin, "main");
    const [laptop, server] = ["laptop", "server"].map((name) => {
      sh(scratch, "clone", "-q", origin, name);
      return join(scratch, name);
    });

    // The server records while offline, so its meta branch diverges from the laptop's.
    sh(server, "remote", "rename", "origin", "offline");
    recordDecisions(server, [decision(server, "todo/b", "accept")]);
    sh(server, "remote", "rename", "offline", "origin");
    expect(recordDecisions(laptop, [decision(laptop, "todo/a", "reject", "not now")])).toBe(
      "origin/meta",
    );
    expect(recordDecisions(server, [decision(server, "todo/c", "defer")])).toBe("origin/meta");

    expect(readDecisions(laptop).map((each) => each.id)).toEqual(["todo/b", "todo/a", "todo/c"]);
    expect(sh(laptop, "ls-tree", "-r", "--name-only", "meta").trim()).toBe(
      "workwork/decisions.jsonl",
    );
    expect(sh(laptop, "status", "--porcelain")).toBe("");
  });

  test("a rejection hides a candidate; --all-history shows it with the reason", async () => {
    const repo = repoWith({ "TODO.md": "- [ ] Add dark mode\n- [ ] Ship it\n" });
    recordDecisions(repo, [
      decision(repo, "todo/add-dark-mode", "reject", "the theme kit does it"),
    ]);

    const { text } = await listing(repo, "repo", {});
    expect(text).not.toContain("todo/add-dark-mode");
    expect(text).toContain("todo/ship-it");
    expect(text).toContain("1 hidden");

    const all = await listing(repo, "repo", { allHistory: true });
    expect(all.text).toContain("rejected");
    expect(all.text).toContain('"the theme kit does it"');
  });

  test("--json lists only shown candidates, cheapest attention first", async () => {
    const repo = repoWith({
      "TODO.md": "- [ ] Add dark mode\n- [ ] Ship it\n",
      "src/a.ts": "export const a = 1;\n",
    });
    recordDecisions(repo, [decision(repo, "todo/add-dark-mode", "reject")]);

    const { candidates, errors } = await listed(repo, "repo", {});
    expect(errors).toEqual([]);
    expect(candidates).toContainEqual({
      repo,
      label: "repo",
      id: "todo/ship-it",
      play: "todo",
      level: "decide",
      kind: "finding",
      title: "Ship it",
    });
    expect(candidates.map(({ id }) => id)).not.toContain("todo/add-dark-mode");
    // Only the TODO line is something a tool found; the rest only say where an agent could look.
    const kind = (id: string) => candidates.find((candidate) => candidate.id === id)?.kind;
    expect(kind("clarify/src/a.ts")).toBe("rotation");
    expect(kind("bug-sweep/.")).toBe("scan");
    const levels = candidates.map(({ level }) => level);
    expect(levels).toContain("skim");
    expect(levels.indexOf("decide")).toBeGreaterThan(levels.lastIndexOf("skim"));
  });

  test("a deferral hides a candidate until its file changes", async () => {
    const repo = repoWith({ "TODO.md": "- [ ] Add dark mode\n" });
    recordDecisions(repo, [decision(repo, "todo/add-dark-mode", "defer", "after the release")]);
    expect((await listing(repo, "repo", { play: "todo" })).count).toBe(0);

    commitFiles(repo, { "TODO.md": "- [ ] Add dark mode\n- [ ] Ship it\n" });
    const { text } = await listing(repo, "repo", { play: "todo" });
    expect(text).toContain("todo/add-dark-mode");
    expect(text).toContain("changed since");
  });
  test("a kept scan stays hidden until anything in the repo changes", async () => {
    const repo = repoWith({ "src/a.ts": "export const a = 1;\n" });
    recordDecisions(repo, [decision(repo, "docs-drift/.", "keep", "nothing found")]);
    expect((await listing(repo, "repo", { play: "docs-drift" })).count).toBe(0);

    commitFiles(repo, { "src/b.ts": "export const b = 2;\n" });
    const { text } = await listing(repo, "repo", { play: "docs-drift" });
    expect(text).toContain("docs-drift/.");
    expect(text).toContain("kept 20");
  });
});

describe("plays", () => {
  test("a play without a description is an error naming its file", () => {
    const dir = join(scratch, "data", "apps", "workwork", "plays");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "vague.md");
    writeFileSync(file, "---\nname: vague\nlevel: skim\ndone: done\n---\n\nDo things.\n");
    try {
      expect(() => loadPlays()).toThrow(`${file}: name, description and done are required`);
    } finally {
      rmSync(file);
    }
  });
});

describe("finders", () => {
  test("rotation: code files largest first, tests apart, vendored files skipped", async () => {
    const repo = repoWith({
      ".gitattributes": "src/ui/** linguist-vendored\n",
      "src/small.ts": "a\n",
      "src/large.ts": "a\nb\nc\n",
      "src/ui/button.tsx": "vendored\n",
      "src/large.test.ts": "test\n",
      "README.md": "docs\n",
    });
    const simplify = await listing(repo, "repo", { play: "simplify" });
    expect(simplify.text.indexOf("simplify/src/large.ts")).toBeLessThan(
      simplify.text.indexOf("simplify/src/small.ts"),
    );
    expect(simplify.count).toBe(2);
    const tests = await listing(repo, "repo", { play: "test-trim" });
    expect(tests.text).toContain("test-trim/src/large.test.ts");
    expect(tests.count).toBe(1);
  });

  test("spec rules without a citing test are candidates", async () => {
    const repo = repoWith({
      "spec/capture.md":
        "| Rule | When | Then |\n| --- | --- | --- |\n| `capture.open` | C | Editor opens |\n| `capture.save` | Enter | Task saved |\n",
      "src/capture.test.ts": 'test("capture.open: C opens the editor", () => {});\n',
    });
    const { text } = await listing(repo, "repo", { play: "spec-uncited" });
    expect(text).toContain("spec-uncited/capture.save");
    expect(text).not.toContain("spec-uncited/capture.open");
  });

  test("pnpm outdated: a failed command without JSON is reported", async () => {
    const repo = repoWith({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
    const bin = join(scratch, "failing-pnpm");
    mkdirSync(bin);
    const executable = join(bin, "pnpm");
    writeFileSync(executable, "#!/bin/sh\necho registry unavailable >&2\nexit 1\n");
    chmodSync(executable, 0o755);
    const path = process.env.PATH;
    process.env.PATH = [bin, path].filter(Boolean).join(delimiter);
    try {
      await expect(finders.outdated(repo, "patch")).rejects.toThrow("registry unavailable");
    } finally {
      process.env.PATH = path;
    }
  });

  test("pnpm outdated: warnings before the JSON are skipped; below 1.0 a minor bump counts as major", () => {
    const found = parseOutdated(
      '[WARN] Unsupported engine: wanted: {"node":">=24"} (current: {"node":"v22"})\n' +
        JSON.stringify({
          a: { current: "1.2.3", latest: "1.2.4", dependencyType: "dependencies" },
          b: { current: "1.2.3", latest: "1.3.0", dependencyType: "devDependencies" },
          c: { current: "0.2.0", latest: "0.3.0", dependencyType: "dependencies" },
          d: { latest: "2.0.0", dependencyType: "dependencies" },
        }),
    );
    expect(found.map(({ key, bump }) => `${key} ${bump}`)).toEqual([
      "a patch",
      "b minor",
      "c major",
    ]);
  });

  test("knip: unused files and exports", () => {
    const empty = { files: [], exports: [], types: [] };
    const json = JSON.stringify({
      issues: [
        { ...empty, file: "src/orphan.ts", files: [{ name: "src/orphan.ts" }] },
        { ...empty, file: "src/extra.ts", exports: [{ name: "x", line: 1 }] },
      ],
    });
    expect(parseKnip(json).map((found) => found.key)).toEqual(["src/orphan.ts", "src/extra.ts#x"]);
  });

  test("knip: the report after an install pnpm 11 printed on the same stdout", () => {
    // Real `pnpm exec knip --no-progress --reporter json` output from pnpm 11.22 with stale dependencies.
    const stdout = readFileSync(
      join(import.meta.dirname, "fixtures/knip-after-pnpm-install.txt"),
      "utf8",
    );
    expect(stdout.startsWith("✓ Lockfile")).toBe(true);
    expect(parseKnip(stdout).map((found) => found.key)).toEqual(["src/a.ts#unused"]);
  });

  test("knip: output without a report is an error naming what was printed", () => {
    expect(() =>
      parseKnip(
        "✓ Lockfile passes supply-chain policies (verified 7s ago)\nDone in 1.4s using pnpm v11.22.0\n",
      ),
    ).toThrow("knip printed no JSON report: Done in 1.4s using pnpm v11.22.0");
  });

  test("kit check: drifted and missing vendored files", () => {
    const output =
      "Comparing 3 items with upstream...\nDRIFT   src/components/ui/button.tsx\nallowed src/components/ui/card.tsx\nmissing src/components/ui/kbd.tsx\n";
    expect(parseKitCheck(output).map((found) => found.key)).toEqual([
      "src/components/ui/button.tsx",
      "src/components/ui/kbd.tsx",
    ]);
  });
});
