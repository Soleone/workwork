---
name: bug-sweep
attention: skim
description: Hunts for real correctness and security bugs and fixes each one with a test that failed before.
finder: scan
done: each fix comes with a test that failed before it
---

Think like an independent senior reviewer looking for correctness and security bugs. Few high-signal findings, none manufactured: each must have a concrete input or state that produces a wrong result, a crash or an exposure. Fix one with a test that fails before the fix and passes after. Without such a test, or when the fix changes intended behavior, don't fix it: raise the attention to decide and open an issue.
