---
name: kit-revision
level: skim
description: Applies one revision of the kit's upgrade steps to bring the project closer to current.
finder: kit-status
done: `vp check` and `kit check` pass
---

This project is behind the kit by this revision. Run `kit upgrade` to print the steps; the steps are written for an agent. Apply only this revision's steps. If this was the last revision the project was missing, run `kit upgrade --mark` in the same commit.
