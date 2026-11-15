import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { parseKitCheck, parseKnip, parseOutdated } from "../src/finders.ts";
import { listing } from "../src/list.ts";
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

  test("a deferral hides a candidate until its file changes", async () => {
    const repo = repoWith({ "TODO.md": "- [ ] Add dark mode\n" });
    recordDecisions(repo, [decision(repo, "todo/add-dark-mode", "defer", "after the release")]);
    expect((await listing(repo, "repo", {})).count).toBe(0);

    commitFiles(repo, { "TODO.md": "- [ ] Add dark mode\n- [ ] Ship it\n" });
    const { text } = await listing(repo, "repo", {});
    expect(text).toContain("todo/add-dark-mode");
    expect(text).toContain("changed since");
  });
});

describe("finders", () => {
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

  test("pnpm outdated: warnings before the JSON are skipped; below 1.0 a minor bump counts as major", () => {
    const found = parseOutdated(
      "[WARN] Unsupported engine\n" +
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

  test("kit check: drifted and missing vendored files", () => {
    const output =
      "Comparing 3 items with upstream...\nDRIFT   src/components/ui/button.tsx\nallowed src/components/ui/card.tsx\nmissing src/components/ui/kbd.tsx\n";
    expect(parseKitCheck(output).map((found) => found.key)).toEqual([
      "src/components/ui/button.tsx",
      "src/components/ui/kbd.tsx",
    ]);
  });
});
