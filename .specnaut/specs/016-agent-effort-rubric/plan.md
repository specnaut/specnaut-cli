# Implementation Plan: Per-agent `effort` tuning rubric

**Branch**: `016-agent-effort-rubric` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)
**Input**: issue mkrlabs/specflow#382, epic mkrlabs/specflow-monorepo#12

## Summary

Add one `effort:` frontmatter field (low|medium|high|xhigh) to each of the 15 bundled agents under
`templates/core/agents/` per the documented rubric, and ship a `templates/core/agents/README.md` (→
`.claude/agents/README.md`) explaining the rubric + rationale + the `xhigh`-is-Opus-only caveat.
Additive frontmatter only. Regenerate the bundle, mirror to plugin, add a test asserting every agent
has a valid `effort:` and no Sonnet-pinned agent carries `xhigh`.

## Technical Context

**Language/Version**: markdown (agents + README); Deno/TS for the test + bundle **Primary
Dependencies**: none new — existing bundle pipeline **Storage**: bundled agent files + a new README
**Testing**: `deno task test`; a test loops `templates/core/agents/*.md`, asserts one `effort:` ∈
the set, and cross-checks `model:` vs `effort:` (no sonnet+xhigh) **Project Type**: cli (no src/
code) **Constraints**: additive frontmatter only; xhigh ⇒ Opus model **Scale/Scope**: 15 frontmatter
edits + 1 README + manifest/bundle/plugin/test

## Constitution Check

Placeholder constitution — no gate. Additive config + docs; ship through the bundle. **PASS.**

## Project Structure

```text
templates/core/agents/*.md            # EDIT ×15 — add effort: per the contract map
templates/core/agents/README.md       # NEW — rubric + rationale + Opus-only caveat
templates/manifest.json               # EDIT — register the README
src/templates_bundle.ts               # REGENERATED
plugin/agents/*.md + plugin/agents/README.md   # mirror
tests/templates/agent_effort_test.ts  # NEW — every agent has valid effort; no sonnet+xhigh
```

**Structure Decision**: Effort map is authoritative in `contracts/effort-map.md` (and mirrored into
the README). The 15 agents already declare `model:`; insert `effort:` adjacent. Register the new
README in the manifest like other bundled agent files; mirror to `plugin/`.

## Complexity Tracking

> No violations — empty.
