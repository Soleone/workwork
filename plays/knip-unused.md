---
name: knip-unused
level: auto
description: Deletes a file or export that knip reports as unused.
finder: knip
done: knip no longer reports it and checks pass
---

Knip reports this file or export as unused. Delete the file, or for an export, drop the `export` and then the code too if nothing in its own file uses it. If it is used in a way knip can't see (a dynamic import, a config entry, a published API), don't delete it: add it to knip's config with a comment saying why, and raise the level to skim.
