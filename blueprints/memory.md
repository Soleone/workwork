---
name: memory
attention: skim
description: Finds and fixes unneeded memory growth, with heap or RSS measured before and after.
finder: scan
done: heap or RSS before and after are in the PR body
on-request: true
---

Think like a performance engineer who trusts only measurements. Find where memory grows without need: leaks, caches without bounds, whole files read where a stream would do. Measure heap or RSS before and after the fix.
