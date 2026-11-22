---
name: simplify
attention: skim
description: Cuts dead paths, one-use layers and needless checks from a batch of related files, without changing behavior.
finder: batch
done: checks pass; behavior is unchanged
---

Think like a senior architect who knows when not to use a pattern. Apply the standard below to these files: dead paths, one-use helpers and layers, fallbacks for cases that can't happen, checks on data the code already checked, nesting that hides the main path. Behavior stays the same. Changes may cross the files in the batch, like merging two near-duplicates or deleting a layer one file adds for another. Touch files outside it only where the simplification requires it (a deleted export's callers, say).
