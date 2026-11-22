# workwork

Finds meaningful work in a repo, or across your repos, for whichever coding agent has tokens to spare, and sorts it by the one real bottleneck: how much human attention each piece needs.

```sh
npm install -g @soleone/workwork
```

Like git, it works in whatever repo you're in, on any machine:

```sh
workwork                         # candidates in this repo, grouped by blueprint
workwork --blueprint simplify    # one blueprint, every candidate (also runs on-request ones like performance)
workwork --all                   # a summary for every repo of yours under $SRC, or under this directory
workwork --all --json            # the same candidates as a JSON array, for scripts
workwork blueprints [--json]     # every blueprint with its attention and what it does
workwork blueprints save         # save one of yours, as JSON on stdin
workwork blueprints delete <name>
workwork prompt <id>             # a self-contained prompt for one candidate, for any agent
workwork decide <id> reject "the theme kit already does this"
workwork history [--rejected] [--blueprint <name>]
```

workwork finds, ranks and remembers; it doesn't run agents (yet). Hand `workwork prompt <id>` to claude, pi, codex or anything else that reads a prompt. The agent picks by expected value per token, and everything a blueprint sets is a default it may override with a one-sentence reason.

Needs node 22+ and git. `gh` (logged in, or `GH_TOKEN` set) is needed for `--all` and for reading PR and issue outcomes; without it the stored decisions still count. pnpm, knip and kit are used when a repo uses them.

`--json` (with or without `--all`) prints the candidates the listing would show as an array of `{repo, label, id, blueprint, attention, kind, title}`, cheapest attention first, with `repo` as an absolute path. A finder that fails is reported on stderr, never in the array. `blueprints --json` prints every blueprint, your own included, with all its fields and `custom: true` for yours.

`kind` says what a candidate rests on. `finding`: a tool reported this exact thing (an outdated package, an unused export, a TODO line). `batch`: related files read together, with nothing known to be wrong in them. `scan`: the whole repo, for an agent to search. A batch or a scan says where to look, not that anyone has looked; most of a big repo's candidates are batches.

## Attention

| attention | the human...                                     | presented as                           |
| --------- | ------------------------------------------------ | -------------------------------------- |
| none      | does nothing: a mechanical check defines correct | a one-line digest                      |
| skim      | skims and accepts: behavior stays the same       | one sentence, diff stat, accept/reject |
| decide    | decides: behavior or product judgment            | what, why, cost, the one question      |

A blueprint's attention can be raised, never lowered. none needs a mechanical check that passed, so in a repo without checks none becomes skim.

## Blueprints

A blueprint is one markdown file: frontmatter plus the prompt. `description` is optional and tells whoever picks what to run what the blueprint does in one sentence.

```markdown
---
name: implicit-state-machines
attention: decide
description: Makes implicit state machines explicit, naming their states and transitions.
finder: scan
done: checks pass; each refactor names the states and transitions it made explicit
---

Think like a senior architect. Search the codebase for implicit state machines ...
```

Built-in blueprints are in [blueprints/](blueprints/). Your own go in `~/.config/workwork/blueprints/` (or `$DATA/apps/workwork/blueprints/` when `DATA` is set), by hand or with `workwork blueprints save`, and replace a built-in one of the same name. `on-request: true` keeps a blueprint out of the default listing.

Blueprints were called plays before 0.3. An old `plays/` folder is still read, and so are `level` (with `auto` for `none`) and the `rotation` finder.

Finders:

- `scan` (the default): one candidate per repo; the agent searches with the blueprint's prompt and gives each finding its own id.
- `batch`: every tracked code file, in batches of up to 2000 lines so one agent reads related code together and can change across it (`batch tests` for test files). Each batch starts with the largest file left, which is also its id, and grows by the files that batch imports or is imported by (relative JS and TS imports, across folders), then by files in its folders. A decision on a batch holds until any of its files changes. Files marked `linguist-vendored` or `linguist-generated` in `.gitattributes` are skipped.
- `size <lines>`: code files longer than that, to split. A registry or data table that is long by nature gets a `keep`.
- `outdated <patch|minor|major>`, `knip`, `kit-drift`, `kit-status`, `spec-uncited`, `todo`: mechanical sources.

## Decisions

Decisions come from conversation (`workwork decide`, with the user's own words), from agents (`keep`: looked, nothing to change) and from PRs and issues labeled `workwork`: merged or completed is accept, closed is reject with the last comment as the reason. Commits and issues carry a `Workwork: <id>` trailer, which is how they map back to candidates.

A rejection hides a candidate. Accept, defer and keep hide it until its file changes (the whole repo, for a scan), and then it comes back first. An open PR or issue hides it while it's in progress. `--all-history` shows them all with their reasons.

They're stored per repo on an orphan `meta` branch, in `workwork/decisions.jsonl`, written with git plumbing so the working tree is never touched, and pushed so every machine shares them. Concurrent appends are unioned. In a public repo the reasons are public.

## --all

`--all` lists repos under `$SRC` (or the current directory) whose origin is one of your own GitHub repos, not a fork and not archived. Folder names listed one per line in `~/.config/workwork/skip` aren't searched (say, `tries`).

## Development

```sh
pnpm install
vp check && vp test run && pnpm exec knip
node src/cli.ts            # run from source
vp pack                    # build dist/cli.mjs
pnpm release               # checks, changelog, tag, npm publish
```

`prompts/lean.md` is a copy of the lean skill's body; refresh it when the skill changes.
