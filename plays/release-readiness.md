---
name: release-readiness
level: skim
description: Checks that the project could ship today and fixes what would block a release.
finder: scan
done: a publish dry run passes; nothing destructive was run
on-request: true
---

Think like a release engineer. Check that this project could ship today: CI is green and runs the checks, the release config matches the stack, the package or build includes what it needs and nothing it shouldn't. Run only dry runs; never publish, tag or push a release.
