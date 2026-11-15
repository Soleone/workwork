# workwork

Finds meaningful work in a repo, or across your repos, for whichever coding agent has tokens to spare, and sorts it by the one real bottleneck: how much human attention each piece needs.

```sh
workwork                         # candidates in this repo, grouped by play
workwork --play spec-uncited     # one play, every candidate (also runs on-request plays like dep-major)
workwork --all                   # every repo of yours under $SRC (skips opensource/, tries/, trash/)
workwork prompt <id>             # a self-contained prompt for one candidate, for any agent
workwork decide <id> reject "the theme kit already does this"
workwork history [--rejected] [--play <name>]
```

workwork finds, ranks and remembers; it doesn't run agents (yet). The agent picks by expected value per token, and everything a play sets is a default it may override with a one-sentence reason.

## Attention levels

| level  | the human...                                     | presented as                           |
| ------ | ------------------------------------------------ | -------------------------------------- |
| auto   | does nothing: a mechanical check defines correct | a one-line digest                      |
| skim   | skims and accepts: behavior stays the same       | one sentence, diff stat, accept/reject |
| decide | decides: behavior or product judgment            | what, why, cost, the one question      |

A play's level can be raised, never lowered. auto needs a mechanical check that passed, so in a repo without checks auto becomes skim.

## Plays

A play is one markdown file: frontmatter plus the prompt.

```markdown
---
name: implicit-state-machines
level: decide
finder: scan
done: checks pass; each refactor names the states and transitions it made explicit
---

Think like a senior architect. Search the codebase for implicit state machines ...
```

Built-in plays are in [plays/](plays/). Your own go in `$DATA/apps/workwork/plays/` (default `~/data/apps/workwork/plays/`) and replace a built-in one of the same name. `on-request: true` keeps a play out of the default listing.

Finders built so far: `outdated <patch|minor|major>`, `knip`, `kit-drift`, `kit-status`, `spec-uncited`, `todo`. Plays whose finder isn't built yet (`scan`, `rotation`) are listed as not run.

## Decisions

Decisions come from conversation (`workwork decide`, with the user's own words) and from PRs and issues labeled `workwork`: merged or completed is accept, closed is reject with the last comment as the reason. Commits carry a `Workwork: <id>` trailer, which is how a PR maps back to candidates. A rejection hides a candidate, a deferral hides it until its file changes, and an open PR hides it while it's in progress. `--all-history` shows them all with their reasons.

They're stored per repo on an orphan `meta` branch, in `workwork/decisions.jsonl`, written with git plumbing so the working tree is never touched, and pushed so every machine shares them. Concurrent appends are unioned. In a public repo the reasons are public.

## Development

```sh
pnpm install
vp check && vp test run && pnpm exec knip
node src/cli.ts            # run from source
vp pack                    # build dist/cli.mjs
```

`prompts/lean.md` is a copy of the lean skill's body; refresh it when the skill changes.
