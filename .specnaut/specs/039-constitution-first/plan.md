# Plan — Every task entry point reads docs/constitution.md first

Backlog item: specnaut-cli#685 "Make every task entry point read docs/constitution.md first,
enforced by a guard test" (https://github.com/specnaut/specnaut-cli/issues/685), child of epic
specnaut-cli#674. Branch: `039-constitution-first`. Builds on specnaut-cli#684 (landed): the
constitution is project-owned at `docs/constitution.md`. Target release: next minor.

## 1. Why this exists

The constitution governs work only if it is in context when the work starts. Today nothing
guarantees that:

- the root `AGENTS.md` opens with three placeholder sections and a header calling _itself_ "the
  source of truth for the project's architecture, rules, and conventions";
- 5 of the 15 bundled agents name `docs/constitution.md`, at different steps, in different words;
- none of the 3 routers and none of the documents behind the 8 `/task` routable verbs reads it first
  (`plan` reads it at step 3, `constitution` at step 2);
- Claude Code never loads it unless an agent decides to read it.

Kevin ruled on 2026-10-28 that every entry point of a task references it, whatever the entry, and a
structural guard enforces it.

## 2. User scenarios

**P1: a plain session has the rules.** Given a project scaffolded for Claude Code, when a session
starts, then `docs/constitution.md` is in context (through `@docs/constitution.md` in `AGENTS.md`,
reached by the `.claude/CLAUDE.md` → `../AGENTS.md` link). On Codex, the first line of the
constitution section tells the model to read it.

**P1: every skill and agent reads it first.** Given any bundled router, `/task` routable phase or
agent, when it starts, then its first instruction is the reference line. That holds for the Claude
`.md` files and for the Codex `.codex/agents/*.toml` `developer_instructions`.

**P1: a new entry point cannot ship without it.** Given a contributor adds a skill or an agent
without the line, when `deno task test` runs, then the guard fails and names the file.

**P2: a skill with no business reading it says why.** Given a pure output-format contract, when it
carries `constitution-exempt: <reason>` in its frontmatter, then the guard accepts it, and the
guard's output lists it with its reason. An empty reason fails.

**P2: an existing project gets the new section body.** Given an existing `AGENTS.md`, when
`specnaut upgrade` runs, then the constitution fence's body is replaced in place, with the reference
and the import, and the rest of the file is untouched.

Edge cases:

- `docs/constitution.md` absent (a project that has not upgraded yet): Claude Code drops an
  unresolved `@` import silently; agents read nothing and say so. No failure is introduced.
- The reference moved below the first step, or reworded: red.
- The import line outside the fence, or not directly after the reference: red.

## 3. Requirements

- **FR-001** One sentence, the _reference_, is defined once in code and carried verbatim:
  ``Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.``
  "Unasked" keeps `/task constitution`, whose job is the asked-for edit, consistent with it.
- **FR-002** The `AGENTS.md` constitution fence opens (first line after its heading and its
  ownership line) with the reference, followed on the next line by exactly `@docs/constitution.md`.
  The import appears nowhere else in the bundle.
- **FR-003** In the scaffolded `AGENTS.md` template, the constitution fence moves to first position,
  directly after the header. The header no longer calls `AGENTS.md` the source of truth for the
  architecture or the rules. `## Architecture rules` becomes a pointer to `docs/constitution.md`
  instead of a second place to write rules.
- **FR-004** Every bundled router (`SKILL.md` of category `skill` or `backlog-skill`) carries the
  reference as its first line after the `#` title, unless its frontmatter has a non-empty
  `constitution-exempt` reason. A boolean-looking value (`true`, `false`, `yes`, `no`, `on`, `off`,
  `null`, `~`) is not a reason.
- **FR-005** The document behind every `/task` routable verb (`ROUTABLE_PHASES.task`, resolved
  through the router's verb table: `groom` is `task/groom.md`, the others `phases/<verb>.md`)
  carries the reference as its first non-blank line.
- **FR-006** Every bundled agent carries the reference as the first non-blank line of its body, in
  the source `.md` and in the emitted Claude `.md` and Codex `developer_instructions`.
- **FR-007** One guard test enumerates skills, agents and phases **from the bundle** and fails on
  any missing or misplaced reference, on an empty exemption reason, and on an exemption on an agent
  or on a router in `ADDENDUM_SKILLS`. It prints every exemption with its reason.
- **FR-008** The guard is red-probed: removing the reference from one skill, one agent, one phase,
  the fence, and the import line each turns it red.
- **FR-010** A later step that only says "read the constitution" is removed where the first line now
  says it; a step that _uses_ it (check a plan against it, stop and ask on a conflict) stays.
- **FR-011** The constitution imports nothing. The shipped `docs/constitution.md` and the fence say
  so in one line each: it loads into every Claude Code session, so a change to it is reviewed like
  code. `/task constitution` refuses to draft an amendment carrying an import token.
- **FR-012** The guard collects `@` import tokens by Claude Code's own rule (`(^|\s)@<path>` outside
  code spans, fenced blocks and HTML comments) across the always-on templates (`AGENTS.md`) and the
  constitution template, and asserts the set is exactly `{CONSTITUTION_IMPORT}`. It asserts
  `CONSTITUTION_PATH` is relative, holds no `..`, and starts with neither `/` nor `~`.
- **FR-009** No constitution file or path is created under `.claude/` or `.codex/` (already pinned
  by `constitution_single_source_test.ts`; kept green).

## 4. Success criteria

- **SC-001** 100% of bundled agents (15), routers (3; with the 11 exempt skills, all 14) and the
  documents behind the 8 `/task` routable verbs open with the reference; the guard proves it on
  every test run.
- **SC-002** A Claude Code session in a fresh project has the constitution in context with no tool
  call.
- **SC-003** Always-loaded cost reported before/after for both harnesses (§ 6).
- **SC-004** Five red-probes observed red, then green.

## 5. 🔒 The decision table

| The decision                                                                                                                                                                                                                                                                                                                                                   | Its single home                                                                                                                                                                                                                                                                                                                          | What would duplicate it                                                                      |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| The reference's wording                                                                                                                                                                                                                                                                                                                                        | `CONSTITUTION_REFERENCE` in `tests/templates/constitution_reference.ts`, built from `CONSTITUTION_PATH` (domain)                                                                                                                                                                                                                         | a second literal of the sentence in a test or a template generator; a paraphrase in one file |
| The Claude import line                                                                                                                                                                                                                                                                                                                                         | `CONSTITUTION_IMPORT` in `tests/templates/constitution_reference.ts` (`@` + `CONSTITUTION_PATH`)                                                                                                                                                                                                                                         | `@docs/constitution.md` typed in a test; an import in a second file or outside the fence     |
| What "first step" means                                                                                                                                                                                                                                                                                                                                        | `firstInstruction(body, skip)` in `tests/templates/constitution_reference.ts`: the first non-blank line of a body after `skip` leading lines (the `#` title of a router; the heading and ownership line of the fence). Callers strip frontmatter with `splitFrontmatter`, the fence with `extractBlock`, the Codex TOML with `@std/toml` | a per-file regex; a second frontmatter regex; a `kind` switch                                |
| Which document a routable verb reads                                                                                                                                                                                                                                                                                                                           | `verbTable` / `docOf`, moved out of `routable_phases_test.ts` into `tests/templates/verb_table.ts`, imported by both tests (precedent: `retired_table.ts`)                                                                                                                                                                               | a second verb-table parser; `phases/groom.md` hard-coded                                     |
| What happens to the constitution reads already in a file                                                                                                                                                                                                                                                                                                       | FR-010, applied file by file in the edit that adds the first line                                                                                                                                                                                                                                                                        | two wordings of "read it" in one file                                                        |
| Who may not opt out                                                                                                                                                                                                                                                                                                                                            | the guard: category `agent`, and every router in `ADDENDUM_SKILLS` (all three)                                                                                                                                                                                                                                                           | router names typed into the test                                                             |
| Which `@` tokens a template may carry                                                                                                                                                                                                                                                                                                                          | `importTokens()` in `tests/templates/constitution_reference.ts`, Claude Code's rule; the allowed set is `{CONSTITUTION_IMPORT}`                                                                                                                                                                                                          | `includes("@docs/…")`; a second token regex                                                  |
| The constitution imports nothing                                                                                                                                                                                                                                                                                                                               | stated in `templates/core/root/docs/constitution.md` and the fence; refused at `templates/core/skills/task/phases/constitution.md` drafting step                                                                                                                                                                                         | an import allowed "just for this project" in a template                                      |
| Which entry points must carry it                                                                                                                                                                                                                                                                                                                               | the guard enumerates `CORE_BUNDLE` categories `skill`, `backlog-skill`, `agent`, and `ROUTABLE_PHASES.task`                                                                                                                                                                                                                              | a hand-kept file list; a count literal                                                       |
| Who may opt out, and the reason                                                                                                                                                                                                                                                                                                                                | the file's own frontmatter key `constitution-exempt`                                                                                                                                                                                                                                                                                     | an allow-list in the test                                                                    |
| The fence's content                                                                                                                                                                                                                                                                                                                                            | `templates/core/root/AGENTS.md`, fence `constitution`                                                                                                                                                                                                                                                                                    | the sentence written outside the fence (reaches new projects only)                           |
| New helper? (a) inventoried: `splitFrontmatter`/`frontmatterField`, `extractBlock`, `ROUTABLE_PHASES`, `HARNESSES[].mapBundle`; (b) recurrence: three reach guards already re-derive "is X referenced" (`response_style_reach_test.ts`, `mobile_first_reach_test.ts`, `backlog_reference_contract_test.ts`), each by `includes`, none by position; (c) outcome | **add** one test helper module — position is new and only a test asks it, so it lives in `tests/`; the enumeration reuses the existing helpers directly                                                                                                                                                                                  | a fourth reach test with its own line-splitting                                              |

## 6. Technical context

Deno 2 / TypeScript, `@std/assert`, `@std/toml` for the emitted Codex agents. Templates are static
Markdown bundled into `src/templates_bundle.ts` by `deno task bundle`.

_First instruction_: callers hand `firstInstruction` a body — a router or phase with its frontmatter
stripped, an agent's Claude body or Codex `developer_instructions`, or the fence's extracted block —
and the number of leading lines to skip (1 for a router's title, 2 for the fence's heading and
ownership line, 0 otherwise). Exemptions are read from the **source** bundle: Codex rebuilds skill
frontmatter (`ensureSkillFrontmatter`) and drops the key. The reference line sits outside every
harness/backend conditional marker, so no filter removes it.

Always-loaded bytes, measured on the bundle (before: `cc2429b5`; after: this branch):

| Harness     |               Before |                                                                                    After |
| :---------- | -------------------: | ---------------------------------------------------------------------------------------: |
| Claude Code | `AGENTS.md` 12,824 B | `AGENTS.md` 13,076 B + `docs/constitution.md` 2,030 B (50 lines; ceiling 100) = 15,106 B |
| Codex       | `AGENTS.md` 12,824 B |                                        13,076 B; the constitution is read on instruction |

## 7. Constitution check

Against `.specnaut/memory/constitution.md` (this repo's own):

- § I two halves: nothing from the private half. ✅
- § XI no consumer traces: examples are invented. ✅
- § VIII no pinned versions in long-lived prose: none added. ✅
- § XII version: a minor (new guarantee in scaffolded files; no user action beyond `upgrade`). ✅
- Size gate (`.specnaut/memory/size-limits.md`, target 300 / ceiling 500): no file touched is over
  its target, and each grows by at most 2 lines (fewer where FR-010 removes a line). ✅

**Files touched** (`wc -l` at `cc2429b5`):

| File(s)                                                                                  |                                     Lines now | Change                                                                                 |
| :--------------------------------------------------------------------------------------- | --------------------------------------------: | :------------------------------------------------------------------------------------- |
| `templates/core/root/AGENTS.md`                                                          |                                           278 | header reworded, fence moved first, `## Architecture rules` → pointer, +2 in the fence |
| routers `task` / `ship` / `specnaut` `SKILL.md`                                          |                                130 / 128 / 84 | +2                                                                                     |
| `task/phases/{plan,tasks,implement,review,merge,audit,constitution}.md`, `task/groom.md` | 246 / 228 / 199 / 187 / 171 / 139 / 144 / 252 | +2, FR-010                                                                             |
| 15 agents                                                                                |          42–262 (largest `product-owner` 262) | +2, FR-010                                                                             |
| 11 exempt skills' frontmatter                                                            |                                        33–125 | +1                                                                                     |
| `plugin/` mirrors of the 37 skill, phase and agent files above                           |                                          same | byte-identical copy (`tests/plugin/plugin_sync_test.ts`)                               |
| `src/templates_bundle.ts`                                                                |                                     generated | `deno task bundle`                                                                     |
| `tests/templates/constitution_reference.ts`, `constitution_first_test.ts`                |                                           new | < 80, < 250                                                                            |
| `tests/templates/verb_table.ts` (moved from `routable_phases_test.ts`)                   |                                           new | < 60                                                                                   |
| `tests/templates/constitution_single_source_test.ts`                                     |                                           138 | assertions on the fence wording follow the new text                                    |

About 80 files, two-thirds of them one-line edits and their mirrors.

## 8. Surface impact

- **Scaffolded files**: `AGENTS.md` (fence body for every project; layout for new ones), 4 routers,
  8 phase docs, 15 agents, frontmatter of the exempt skills. Claude and Codex emissions follow.
- **Other harnesses** (opencode, copilot, cursor, antigravity): they get the same text. The guard
  asserts the reference is _present_ in their emitted agents and skills, not its position: frontier
  harnesses decide, the others follow (`frontier-only` ruling, 2026-10-28).
- **The `plugin/` tree**: 37 byte-identical mirrors of the edited skill, phase and agent files.
- **No CLI command, flag, or file path changes.** No front-end surface.

## 9. Risks

| Risk                                                                                                                                                                            | Mitigation                                                                                                                                                                                                                                                                             |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An adapter prepends text to a body, so "first line" fails on emission                                                                                                           | The guard checks emitted Claude and Codex files; a failure there is fixed in the adapter, not by relaxing the guard                                                                                                                                                                    |
| `constitution-exempt` is rejected by a harness's skill loader                                                                                                                   | Codex rebuilds skill frontmatter from known fields; Claude passes unknown keys through. `frontmatter_parses_test.ts` keeps it valid YAML                                                                                                                                               |
| A persona line demoted to line 2 weakens an agent                                                                                                                               | One line; the persona follows immediately                                                                                                                                                                                                                                              |
| The `@` import costs every Claude session the constitution's bytes                                                                                                              | Bounded by the `constitution` unit (60 / 100 lines, `size-limits.md`), checked by `size-ratchet.sh` when the file changes. Lines, not bytes, and blind to imports — hence FR-011. `size-ratchet.sh` currently passes files with quoted or non-ASCII names unmeasured: specnaut-cli#705 |
| An `@` line inside the constitution becomes a followed import (5 levels, 4 MiB each; in-repo targets such as `.env` load with no prompt) and the hook guards only the root file | FR-011 + FR-012                                                                                                                                                                                                                                                                        |
| Existing projects keep the fence where it was                                                                                                                                   | Accepted. On Claude Code the import makes position irrelevant; on Codex the fence's first line still says it, below the user's own sections. `mergeIntoFile` replaces the body in place                                                                                                |
| Non-frontier harnesses get the reference present but not necessarily first                                                                                                      | Accepted by the frontier-only ruling (2026-10-28)                                                                                                                                                                                                                                      |

## 10. Architecture audit

`architect-expert`, 2026-10-29: **fail, 2 HIGH, 5 MEDIUM, 4 LOW** — every one folded in; claims
checked against the tree (groom is `backlog-doc` `task/groom.md`; 37 `plugin/` mirrors exist; every
touched file is under 300 lines).

| Finding                                                                                                                | Done                                                                                                     |
| :--------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| HIGH — no home for "which document a verb reads"; `docOf` private to `routable_phases_test.ts`                         | Row added; moved to `tests/templates/verb_table.ts`, shared (FR-005)                                     |
| HIGH — no decision on the constitution reads already in files                                                          | FR-010 + row                                                                                             |
| MEDIUM — the exemption ban had no home                                                                                 | Derived from `agent` ∪ `ADDENDUM_SKILLS`                                                                 |
| MEDIUM — helpers in `src/domain` need infrastructure's frontmatter splitter and Codex TOML, and only a test calls them | Moved to `tests/templates/constitution_reference.ts`; `constitution_paths.ts` untouched (it holds paths) |
| MEDIUM — `plugin/` mirrors missing from § 8                                                                            | Added to § 7 and § 8                                                                                     |
| MEDIUM — no Files touched table                                                                                        | Added to § 7, measured                                                                                   |
| MEDIUM — "no agent edits it" contradicts `/task constitution`                                                          | FR-001 now says "unasked"                                                                                |
| LOW — 4 routers → 3                                                                                                    | Corrected                                                                                                |
| LOW — five kinds are two rules                                                                                         | One function, body + lines to skip                                                                       |
| LOW — emitted-file backstop                                                                                            | Kept: the guard checks emitted Claude and Codex files                                                    |
| LOW — upgraded projects keep the fence's position                                                                      | Accepted, § 9                                                                                            |

## 11. Security audit

`security-expert`, 2026-10-29: **needs follow-up, 0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW** — both
folded in. Verified against the Claude Code 2.1.309 import resolver: imports resolve from the real
file after symlinks (so `.claude/CLAUDE.md` → `../AGENTS.md` → `docs/constitution.md` is the one
file loaded), nest 5 levels, and skip code spans, code blocks and HTML comments. The constitution is
no worse a channel than `AGENTS.md`: the same people can change it, and `protect-constitution.sh`
gates agents, which `AGENTS.md` does not have. No CI agent runs on PR branches in the templates.

| Finding                                                                                | Done                                                                                                                                                                                                                  |
| :------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MEDIUM — `@` lines in the constitution become followed imports the hook does not guard | FR-011: the constitution imports nothing, said in the template and the fence, refused by `/task constitution`, guard-tested (FR-012). Rejected: guarding imported files in `PC_PATHS` (the hook would parse Markdown) |
| LOW — "nowhere else" must use Claude Code's parse rule, plus the path's shape          | FR-012                                                                                                                                                                                                                |
| Observation — exemption scope; boolean-looking values                                  | All three routers forbidden; boolean-looking values rejected (FR-004)                                                                                                                                                 |

Not assessed by the seat, and accepted: whether `permissions.deny` applies to imports; import
handling in non-frontier harnesses. No performance seat: the plan has no hot path; the byte cost is
reported in § 6.

## 12. Open questions

None for the user: the ruling of 2026-10-28 settled scope, mechanism and the opt-out shape. No stop.

Decided here, one line each:

- `/specnaut` and `/ship` routers carry the reference too ("whatever the entry"); their phases do
  not — they do not touch the project's code, and the router's first line already covers them.
- `/task` phases: all 8 routable ones, `groom` included (it shapes work). Contract docs do not: they
  are read mid-phase, after the router's first line.
- Exempt: the 9 output/format contracts, `specnaut-facts` (reference data) and `status-audit` (reads
  the session ledger only). No agent is exempt; the guard forbids it.
- The import sits in the fence, not in a new section: one Specnaut-owned home for constitution
  wording in `AGENTS.md`.
