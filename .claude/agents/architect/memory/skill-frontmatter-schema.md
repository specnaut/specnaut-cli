---
name: skill-frontmatter-schema
description: SKILL.md frontmatter fields used today + pass-through guarantee for issue #265 (alias_of / overlays)
type: reference
---

## Current SKILL.md frontmatter fields (as of v1.3.1)

Known fields used across the four bundled skills:

| Field | Type | Where used |
|---|---|---|
| `name` | string | All four skills |
| `description` | string | All four skills |
| `argument-hint` | string | specflow router, backlog |
| `when_to_use` | block-scalar string | specflow router, specflow-review |

No typed schema exists in the TypeScript source. There is NO domain type,
no Zod validation, no application-layer parser for SKILL.md frontmatter.

## Bundler pass-through guarantee

`scripts/bundle-templates.ts` reads SKILL.md as raw text via `Deno.readTextFile`
and embeds it verbatim as a template-literal string in `src/templates_bundle.ts`.
The bundler never parses YAML frontmatter — it only embeds the entire file content.

The only frontmatter manipulation at deploy time is in
`src/infrastructure/harness/skill_folder.ts::ensureSkillFrontmatter()` which
injects `name:` and `description:` when absent (for Cursor/Codex registries).
It does NOT strip unknown fields — it does a regex presence check for those two
keys only, leaving all other frontmatter lines untouched.

**Conclusion:** Adding `alias_of` and `overlays` as optional frontmatter fields
requires ZERO bundler changes and ZERO TypeScript type changes. The fields flow
through the entire pipeline unchanged. The harness only consumes what it knows
about.

## Plugin sync contract for new phase docs

`tests/plugin/plugin_sync_test.ts` maintains a hardcoded `SYNC_PAIRS` array.
Any NEW file added under `templates/core/skills/specflow/` that also needs a
plugin twin under `plugin/skills/specflow/` MUST have a corresponding row added
to `SYNC_PAIRS`, otherwise the test won't catch drift. New phase docs REQUIRE
both the template file AND the plugin copy AND a SYNC_PAIRS row.
