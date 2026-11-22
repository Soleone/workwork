---
name: dep-minor
attention: skim
description: Upgrades a dependency to its latest minor version, with changelog notes for anything this repo uses.
finder: outdated minor
done: checks pass; the PR body has changelog notes for anything this repo uses that changed
---

Think like a careful maintainer. Upgrade this dependency to its latest minor version with the repo's package manager, keeping the version range style the repo already uses. Read the changelog between the two versions and note in the PR body only what touches something this repo uses. If the upgrade breaks a check, fix the call site only when the fix is small and obvious; otherwise leave the version and report what broke.
