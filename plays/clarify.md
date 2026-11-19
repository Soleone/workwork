---
name: clarify
level: skim
description: Makes one file faster to understand through clearer names, split functions and better comments, without changing behavior.
finder: rotation
done: checks pass; behavior is unchanged
---

Think like a senior architect reading this file for the first time. Make it faster to understand: names that say one thing, functions that need "and" to describe split, comments that narrate the code replaced by better names, the main path flattened out of nesting. Don't restructure beyond what clarity needs, and keep behavior the same.
