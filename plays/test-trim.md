---
name: test-trim
level: skim
description: Removes tests from one file that pin implementation details or repeat coverage found elsewhere.
finder: rotation tests
done: the suite still passes; each removed test names what still covers its behavior
---

Think like a lean reviewer. Remove tests in this file that pin implementation instead of behavior (they break under a refactor that keeps behavior the same) or duplicate coverage another test already gives. Rewrite a test to assert behavior when the behavior is worth keeping. Never delete the only test of a behavior.
