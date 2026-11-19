---
name: rule-of-three
level: skim
description: Extracts code or test setup repeated three or more times into one shared place.
finder: scan
done: the three real call sites are named in the PR
---

Think like a senior architect. Find code or test setup repeated three or more times with the same intent, and extract it from those real call sites. Two copies don't count. If the extraction introduces a pattern (an interface, a factory, a plugin point), raise the level to decide.
