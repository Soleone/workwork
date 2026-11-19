---
name: dep-major
level: decide
description: Lists the breaking changes in a dependency's next major version and the code each one affects.
finder: outdated major
on-request: true
done: breaking changes listed, each with the call sites it affects
---

Think like a careful maintainer. List the breaking changes between the installed and the latest major version of this dependency, from its changelog or migration guide, and which call sites in this repo each one affects. Upgrade only if the changes it needs are clear and contained; otherwise stop at the list and the one question to decide.
