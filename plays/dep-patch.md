---
name: dep-patch
level: auto
finder: outdated patch
done: checks pass
---

Upgrade this dependency to its latest patch version with the repo's package manager, keeping the version range style the repo already uses. Run the checks. If they fail because of the upgrade, don't patch around it: leave the dependency where it was and report what broke.
