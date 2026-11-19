---
name: spec-uncited
level: skim
description: Writes a behavior test for a spec rule that no test covers yet.
finder: spec-uncited
done: a test whose title starts with the rule's slug passes
---

Think like a lean reviewer. This spec rule has no test citing it. Write one behavior test for what the rule says a user or caller observes, with a title starting with `<slug>:`, next to the tests that cover the same area. If an existing test already covers the rule under another title, cite the rule in that title instead of adding a test. If the rule turns out not to be implemented, don't implement it: raise the level to decide and report the gap.
