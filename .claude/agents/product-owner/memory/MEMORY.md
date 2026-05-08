# Product Owner agent memory — Specflow

Index of persistent notes for the `product-owner` subagent. Each line points
to a single-topic file in this directory.

Format: `- [Title](file.md) — one-line hook`

Keep the index under 200 lines. Prune entries that are no longer useful
(preferences the user has since reversed; references to closed issues whose
treatment is now part of normal conventions).

## Entries

- [Docs upkeep pattern](docs-upkeep-pattern.md) — PO owns docs on 3 surfaces (llms.md, README, SKILL.md); hook-driven, no separate doc-writer agent; established in #100

- [Architect handoff pattern](architect-handoff-pattern.md) — when architect has already designed a solution, wire AC directly from the spec without re-deriving strategy
- [Docs domain](docs-domain.md) — Specflow docs are at https://specflow.makerlabs.dev (custom domain on GH Pages); use this URL in docs-related issues and AC.
- [GitHub labels](github-labels.md) — only the 9 default GitHub labels exist; do not use ux/docs/friction slugs
