
# /specflow list-skills

A one-shot inspection phase. List every skill installed for this project,
flag which ones are aliases of upstream skills, and surface their pre/post
hook overlays. The point is to make the *shadowing* relationships visible —
without this, you have to read each script to know that a local
`tag-version/` actually delegates to `specflow.tag-version`.

This phase is **read-only** — it never mutates files, never invokes other
phases, and never auto-chains.

## What this phase does

1. **Locate the harness skills directory.** Try, in order:
   - `.claude/skills/` (Claude Code)
   - `.cursor/skills/` (Cursor)
   - `.windsurf/skills/`, `.opencode/skills/`, `.agent/skills/` (other
     supported harnesses)
   - Use whichever directory exists in the current working tree. If
     none exist, report `no skills installed` and stop.

2. **Enumerate skill folders.** Each immediate sub-directory containing
   a `SKILL.md` file is one skill. Sub-directories without a `SKILL.md`
   are ignored (they may be phase-doc folders, scripts, etc.).

3. **Read each `SKILL.md` frontmatter.** The frontmatter is the
   block between the first two `---` lines. Extract:
   - `name:` — the skill's invocation name (required).
   - `description:` — short blurb (required).
   - `alias_of:` — when present, the skill is an alias that delegates
     to the named upstream skill. Convention is dotted notation, e.g.
     `alias_of: specflow.tag-version`.
   - `overlays:` — when present, a list of pre/post hooks. Each item
     carries `when: before | after` and `path: <relative-script>`.

4. **Render a markdown table** with five columns in this order:

   | Column | Source | Empty value |
   |---|---|---|
   | `NAME` | `name:` field, fallback to folder name | n/a (always present) |
   | `KIND` | `alias` if `alias_of` is present, else `skill` | n/a |
   | `ALIAS OF` | `alias_of:` value | `—` |
   | `OVERLAYS` | comma-joined `<path> (<when>)` per overlay entry | `—` |
   | `DESCRIPTION` | `description:` field, truncated to 60 chars + `…` | n/a |

5. **Sort the rows** by NAME ascending. Render aliases and skills in the
   same alphabetical list — the `KIND` column already disambiguates.

6. **Stop after the table.** Do not chain into another phase. Do not
   propose follow-up actions unless the user asks. This is an inspect
   command.

## Example output

```
SKILLS — 4 installed (.claude/skills/)

| NAME           | KIND   | ALIAS OF              | OVERLAYS                 | DESCRIPTION                                     |
|----------------|--------|-----------------------|--------------------------|-------------------------------------------------|
| backlog        | skill  | —                     | —                        | GitHub Project #4 backed backlog with classific…|
| release-version| alias  | specflow.release-vers…| poll-cloud-build.sh (befo| Monorepo wrapper: poll Cloud Build then delegat…|
| specflow       | skill  | —                     | —                        | Specflow workflow router — entry point for the …|
| tag-version    | alias  | specflow.tag-version  | quality-gate.sh (before) | Monorepo wrapper: cd into inner repo then deleg…|
```

## Failure modes

- `SKILL.md` missing → skip the folder silently (it's not a skill).
- Frontmatter unparseable → render the row with `KIND = error` and
  leave the other columns blank; surface the file path in a
  `## Parse errors` footnote so the user can fix it.
- `alias_of` points at a skill not present in the table → keep the row
  as-is; cycle detection and unresolved-target warnings are the
  harness's job at *invocation* time, not at *listing* time (per #265
  out-of-scope).

## When NOT to use this phase

- To **invoke** a skill — that's the skill's own slash command.
- To **modify** the alias/overlay relationship — edit the SKILL.md
  frontmatter directly.
- To **detect cycles** in alias chains — that requires the harness to
  resolve at dispatch time, which is out of scope for this phase.
