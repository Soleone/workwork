---
name: file-size
attention: skim
description: Splits a code file over 500 lines along its seams, so it can be read and changed as smaller pieces.
finder: size 500
done: checks pass; behavior is unchanged; no new file is over 500 lines
---

Think like a senior architect. This file is too long to hold in mind at once, which hides bad code in it and makes every change risky. Split it along the seams it already has: groups of functions that work on the same data, a concern the rest only calls into, types or constants used elsewhere. Name each new file for what it holds, move code without rewriting it, and update the imports. Behavior stays the same.

A long file that is one homogeneous list, like a registry, a table of data or generated output, is fine as it is: keep it, saying so in the reason.
