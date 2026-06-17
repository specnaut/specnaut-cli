---
name: alias-example
description: Reference SKILL.md showing the `alias_of` + `overlays` frontmatter convention. Copy this folder to your project's harness skills dir (e.g. `.claude/skills/`) and edit. Specnaut itself never installs this file — it lives in the Specnaut repo as documentation.
alias_of: specnaut.tag-version
overlays:
  - when: before
    path: ./scripts/quality-gate.sh
  - when: after
    path: ./scripts/notify-slack.sh
---

# alias-example

This file demonstrates the two optional frontmatter fields that
Specnaut's `/specnaut list-skills` phase recognises:

- **`alias_of: <skill-name>`** — declares that this skill is a wrapper
  around an upstream skill. Convention is dotted notation, with the
  plugin or distribution name as the prefix (e.g.
  `alias_of: specnaut.tag-version`). The harness is responsible for
  resolving the alias at invocation time; Specnaut only records the
  relationship.

- **`overlays:`** — a list of pre/post hooks the harness should run
  around the wrapped skill's body. Each entry carries:
  - `when: before` or `when: after` — where the hook fires relative to
    the wrapped skill.
  - `path: ./scripts/<name>.sh` — script path relative to this
    SKILL.md's folder.

## Why a project would override an upstream skill

A common pattern: a monorepo that uses Specnaut at the root but needs a
slightly different `tag-version` because tags live inside a sub-repo.
Rather than fork the canonical `specnaut.tag-version` script, the
project ships a thin wrapper as `alias_of: specnaut.tag-version` plus
an overlay that runs `cd inner-repo` before delegating.

The result is grep-able and self-documenting: anyone running
`/specnaut list-skills` sees the alias relationship and the overlay
hooks in one table. No code archaeology needed.

## What Specnaut does with this file

**Nothing at runtime.** This file lives in the Specnaut source tree
purely as documentation. It is intentionally absent from
`templates/manifest.json`, so `specnaut init` and `specnaut upgrade`
will never scaffold it into your project. To use the pattern:

1. Copy this folder into your harness skills directory:
   ```
   cp -r templates/core/skills/alias-example .claude/skills/my-skill
   ```
2. Edit the frontmatter — at minimum change `name:`, `alias_of:`, and
   the overlay paths.
3. Write the actual delegate-and-hook logic in the body of the file
   (or in the overlay scripts).
4. Run `/specnaut list-skills` to confirm the harness sees the new
   alias and overlay.

## Prior art

- komence/komence-monorepo commits `5fbae6ea` and `39691ae3` —
  manually-implemented Option 2 wrappers that this convention codifies.
