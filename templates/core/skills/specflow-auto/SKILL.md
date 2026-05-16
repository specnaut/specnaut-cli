---
name: specflow-auto
description: DEPRECATED — /specflow now auto-chains by default since v1.5.0. This skill is kept as an alias for one release and will be removed in the next major version.
---

# /specflow-auto is deprecated

Auto-chain is now the default behavior of `/specflow`. Use:

- `/specflow specify "<feature>"` — runs the full chain automatically
  (specify → clarify → plan → tasks → analyze → implement → review →
  STOP #2 for merge confirmation).
- `/specflow specify --manual "<feature>"` — runs `specify` only, no
  chain.
- `/specflow <phase> <args>` — mid-chain re-entry with artefact
  detection (chain if downstream artefacts are absent, one-shot if
  present). Override with `--once` (force one-shot) or `--continue`
  (force chain).

See `phases/auto-chain.md` (in the `specflow` skill) for the full chain
mechanics, including STOP #1 (clarification checkpoint) and STOP #2
(pre-merge confirmation).

This skill will be removed in the next major release. If you see this
file in your project after running `specflow upgrade`, it means
muscle-memory invocations of `/specflow-auto` keep working — but you
should switch to the new entry point.
