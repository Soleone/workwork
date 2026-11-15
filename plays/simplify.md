---
name: simplify
level: skim
finder: rotation
done: checks pass; behavior is unchanged
---

Think like a senior architect who knows when not to use a pattern. Apply the standard below to this file: dead paths, one-use helpers and layers, fallbacks for cases that can't happen, checks on data the code already checked, nesting that hides the main path. Behavior stays the same. Touch other files only where the simplification requires it (a deleted export's callers, say).
