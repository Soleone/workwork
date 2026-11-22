---
name: kit-drift
attention: none
description: Restores a vendored UI component that drifted from its upstream registry version.
finder: kit-drift
done: `kit check` passes
---

`kit check` reports this vendored file as different from its upstream registry item (or missing). Restore it with `pnpm dlx shadcn@latest add <item> --overwrite`; `pnpm dlx shadcn@latest add <item> --diff <path>` shows what changed. If the local edit was deliberate, move it into a wrapper or tokens. If it can't move, don't restore it: list the path under `allowDrift` in `.kit.json`, say why, and raise the attention to skim.
