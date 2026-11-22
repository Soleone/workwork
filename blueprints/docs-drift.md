---
name: docs-drift
attention: skim
description: Fixes places where the README or docs disagree with what the code actually does.
finder: scan
done: every changed claim is verified against the code
---

Think like a technical writer who trusts only the code. Find places where the README or other docs disagree with the code: flags, commands, options, defaults, examples, install steps. Fix the docs, not the code; if the code looks wrong instead, raise the attention to decide and say so.
