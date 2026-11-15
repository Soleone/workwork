---
name: deps-trim
level: skim
finder: scan
done: checks pass; each removed dependency names what replaced it
---

Think like a lean reviewer. Find dependencies that aren't used, or that do something trivial the code could do in about 20 lines (left-pad, a one-function utility). Replace or remove them. Keep anything doing real work: parsing, cryptography, protocols, dates and time zones.
