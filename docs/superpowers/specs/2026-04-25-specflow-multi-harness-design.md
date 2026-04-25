# Specflow multi-harness — Design

**Date**: 2026-04-25 **Status**: draft, pending review **Scope**: introduce a `Harness` abstraction;
ship Cursor as the second supported harness alongside Claude Code **Prerequisites**: v0.1.0-alpha.3
released, 196 tests green on macOS/Linux/Windows

---

## 1. Goals and non-goals

### Goals

1. Introduce a first-class `Harness` abstraction so adding new harnesses is a small incremental task
   instead of duplicating the whole scaffold path.
2. Refactor the existing Claude-only init/upgrade flow to route through that abstraction with **zero
   behavioural change for Claude users** (byte-identical output).
3. Add **Cursor** as the second supported harness:
   - `specflow init --ai cursor` scaffolds a Cursor-flavoured project
   - `specflow upgrade` works for Cursor projects too (same diff-and-prompt flow)
   - `specflow check --project` recognises Cursor layout
4. Make the path from Cursor to the next harness (Codex, Copilot, Gemini, Windsurf) obvious and
   small — adding each takes roughly one new file plus its tests.

### Non-goals

- **Multi-harness in one project**: a single `specflow init` produces files for one harness at a
  time. A user who wants both Claude + Cursor runs `specflow init` once, then
  `specflow init --here --force --ai cursor` to add the second. The installed.lock records only the
  last-installed harness; that is accepted for v0.2.
- **Codex / Copilot / Gemini / Windsurf** — each is its own follow-up brick, not covered here. This
  brick proves the pattern; subsequent bricks apply it.
- **Migrating an existing Claude project to Cursor** — out of scope. If the user deletes `.claude/`
  and runs `specflow init --here --force --ai cursor` it will work, but we do not offer a dedicated
  `specflow migrate --from claude --to cursor` command in v0.2.
- **Gemini-style TOML output or Copilot-style `.prompt.md`** — those formats need format-specific
  adapters that are out of scope.
- **Dropping Claude as default** — `specflow init` without `--ai` continues to default to
  `--ai claude`.

---

## 2. Harness research summary

| Harness            | Folder       | Command location                                                               | Format   | Context file                       | Agents?                                                                              |
| ------------------ | ------------ | ------------------------------------------------------------------------------ | -------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| Claude Code        | `.claude/`   | `.claude/commands/<name>.md`                                                   | markdown | `CLAUDE.md`                        | yes, under `.claude/agents/<name>.md`                                                |
| **Cursor**         | `.cursor/`   | `.cursor/skills/speckit-<name>/SKILL.md`                                       | markdown | `.cursor/rules/specify-rules.mdc`  | no native agents — shipped as skills `.cursor/skills/specflow-agent-<name>/SKILL.md` |
| Codex CLI (later)  | `.agents/`   | `.agents/skills/speckit-<name>/SKILL.md`                                       | markdown | `AGENTS.md`                        | no                                                                                   |
| Copilot (later)    | `.github/`   | `.github/prompts/<name>.prompt.md` or `.github/skills/speckit-<name>/SKILL.md` | markdown | `.github/copilot-instructions.md`  | no                                                                                   |
| Gemini CLI (later) | `.gemini/`   | `.gemini/commands/<name>.toml`                                                 | **TOML** | `GEMINI.md`                        | no                                                                                   |
| Windsurf (later)   | `.windsurf/` | `.windsurf/workflows/<name>.md`                                                | markdown | `.windsurf/rules/specify-rules.md` | no                                                                                   |

Key findings:

- **Location varies** (`.claude/`, `.cursor/`, `.agents/`, etc.).
- **Command grouping varies**: Claude has one file per command; Cursor/Codex/Copilot-skills have one
  folder per "skill" with a `SKILL.md` inside; Gemini uses `.toml` files.
- **Agents are Claude-specific**. Other harnesses operate as a single agent. Our multi-agent pattern
  (PO, developer, reviewer) needs translation: for harnesses without native agents, ship each agent
  as a skill prefixed `specflow-agent-<name>` so it remains invocable by name.
- **Context file convention varies**. Some use a root-level `AGENTS.md` or `<NAME>.md`, some use a
  file inside the harness folder (`.cursor/rules/specify-rules.mdc`). We generate whichever the
  harness expects.

For v0.2 we only need to handle **Claude** (existing) + **Cursor** (new). The abstraction must not
paint us into a corner for the others.

---

## 3. Core abstraction

### 3.1 Neutral `CoreBundle` concept

The template bundle is re-modelled as a **categorized** collection. Today the embedded `TEMPLATES`
is a flat `Record<string, TemplateFile>` keyed by Claude-specific destination paths. We introduce an
intermediate representation where templates are keyed by their conceptual category and a stable
logical name (harness-independent):

```typescript
export type CoreCategory =
  | "command" // speckit.{specify,clarify,plan,tasks,analyze,implement,review,merge,...}
  | "agent" // product-owner, developer, review-coordinator, code-reviewer, ...
  | "skill" // speckit (auto-chain dispatcher)
  | "spec-root" // files inside .specify/{memory,templates,scripts}/ — keyed by suffix
  | "project-root" // AGENTS.md, tasks/backlog.md, .gitignore — keyed by suffix
  | "backlog-cmd"; // the `backlog.md` dispatcher command

export type CoreEntry = {
  readonly category: CoreCategory;
  readonly name: string; // logical, harness-agnostic — "specify" / "product-owner" / "speckit"
  readonly suffix: string | null; // for spec-root/project-root: path under the category root
  //   e.g. "memory/constitution.md" or "tasks/backlog.md"
  // null for command/agent/skill where `name` is enough
  readonly content: string;
  readonly executable: boolean;
};

export type CoreBundle = ReadonlyArray<CoreEntry>;
```

Adapter responsibility: given `(category, name, suffix)` compute the harness-specific destination
path. For example, ClaudeHarness maps `{ category: "command", name: "specify" }` to
`.claude/commands/speckit.specify.md`, and
`{ category: "project-root", suffix: "tasks/backlog.md" }` to `tasks/backlog.md`.

The bundler script (`scripts/bundle-templates.ts`) is updated to emit a `CoreBundle` rather than a
flat destination map. Each `templates/manifest.json` entry declares its `category` and logical
`name`. Harness adapters translate the core bundle into a concrete `Bundle` at init time.

### 3.2 `Harness` port

```typescript
export interface Harness {
  readonly key: string; // "claude" | "cursor"
  readonly displayName: string;

  /**
   * Translate the neutral core bundle into the harness-specific flat Bundle
   * ready for the FsWriter. Not every harness emits every category — for
   * example, Cursor does not have a native "agent" concept, so agents become
   * skills prefixed `specflow-agent-<name>`.
   */
  mapBundle(core: CoreBundle): Bundle;
}
```

No runtime behaviour belongs here. The port is pure: given a CoreBundle, return a Bundle. All IO
happens in the existing FsWriter + FsReader.

### 3.3 Harness registry

```typescript
// src/application/harnesses.ts
import { ClaudeHarness } from "../infrastructure/harness/claude_harness.ts";
import { CursorHarness } from "../infrastructure/harness/cursor_harness.ts";

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
```

Adding Codex later = one more import + one more entry.

---

## 4. ClaudeHarness (refactor of existing)

Emits exactly the current file tree. This is the safety net: if we get ClaudeHarness wrong the
regression is immediately visible in existing tests.

Mapping rules (core → Claude):

| Core category                          | Destination                           |
| -------------------------------------- | ------------------------------------- |
| `command` (name `specify`)             | `.claude/commands/speckit.specify.md` |
| `command` (name `backlog`)             | `.claude/commands/backlog.md`         |
| `agent` (name `product-owner`)         | `.claude/agents/product-owner.md`     |
| `skill` (name `speckit`)               | `.claude/skills/speckit/SKILL.md`     |
| `spec-root` (`memory/constitution.md`) | `.specify/memory/constitution.md`     |
| `project-root` (`AGENTS.md`)           | `AGENTS.md`                           |
| `project-root` (`tasks/backlog.md`)    | `tasks/backlog.md`                    |
| `project-root` (`.gitignore`)          | `.gitignore`                          |

Plus `CLAUDE.md` is emitted by ClaudeHarness itself (static content) — it is a Claude-specific
pointer file and does not live in the core bundle.

### Regression test

A single snapshot test compares the output of `ClaudeHarness.mapBundle(CORE_BUNDLE)` against the
existing flat `TEMPLATES` record. If they match for every destination path and every file's content
checksum, the refactor preserves behaviour 100 %.

---

## 5. CursorHarness (new)

### 5.1 File layout

| Core                                                           | Cursor destination                                     |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| `command` (name `specify`)                                     | `.cursor/skills/speckit-specify/SKILL.md`              |
| `command` (name `clarify`)                                     | `.cursor/skills/speckit-clarify/SKILL.md`              |
| … one folder per command                                       |                                                        |
| `command` (name `backlog`)                                     | `.cursor/skills/specflow-backlog/SKILL.md`             |
| `agent` (name `product-owner`)                                 | `.cursor/skills/specflow-agent-product-owner/SKILL.md` |
| `agent` (name `developer`)                                     | `.cursor/skills/specflow-agent-developer/SKILL.md`     |
| … one folder per agent                                         |                                                        |
| `skill` (name `speckit`)                                       | `.cursor/skills/specflow-auto-chain/SKILL.md`          |
| `spec-root` (everything under `.specify/…`)                    | identical location `.specify/…`                        |
| `project-root` (`AGENTS.md`, `tasks/backlog.md`, `.gitignore`) | identical location                                     |

Plus a Cursor-specific generated file:

- `.cursor/rules/specify-rules.mdc` — a concise rules file that points the Cursor Agent at the
  skills and the workflow. Static content templated into the binary, not in CoreBundle.

### 5.2 `SKILL.md` structure

Cursor expects a front-matter-bearing markdown file with a `description` that the agent uses to
decide when to invoke the skill. The existing Claude `speckit.specify.md` has a top YAML block with
`description:`. CursorHarness passes the file content through unchanged, trusting upstream Claude
and Cursor to share enough convention there. If a real-world Cursor user reports a rendering
problem, we iterate.

### 5.3 No `CLAUDE.md` equivalent

On Cursor, the `.cursor/rules/specify-rules.mdc` file plays the "welcome context" role that
`CLAUDE.md` plays on Claude. CursorHarness does not emit `CLAUDE.md`.

### 5.4 No native agents: fallback strategy

Since Cursor operates with a single agent, our multi-agent discipline (PO, developer, reviewer…)
needs to live as skills. We ship each agent as a skill prefixed `specflow-agent-<name>` with its
original content. The `specify-rules.mdc` file tells the Cursor Agent "when you act as the product
owner, consult `.cursor/skills/specflow-agent-product-owner/SKILL.md`". This is an imperfect mapping
but it preserves the orchestration content for manual invocation.

---

## 6. CLI changes

### 6.1 `specflow init --ai <harness>`

Already exists in the parser (locked to `"claude"` today). Changes:

1. Allow `--ai cursor` in addition to `--ai claude`.
2. Invalid value → parser returns `{ kind: "unknown", received: "init --ai <bad>" }`.
3. Help text updated:

```
--ai <name>    Target AI harness (claude | cursor) — default: claude
```

4. The `Intent.init` variant's `ai` field becomes `"claude" | "cursor"` instead of the literal
   `"claude"`.

### 6.2 `specflow upgrade`

The upgrade use case loads `.specflow/installed.lock` which now stores the harness key that was used
at init time. Upgrade uses that harness for the diff/apply cycle. If the installed.lock predates
multi-harness support (no harness field), assume `"claude"` for backward compatibility.

### 6.3 `specflow check --project`

Reads the lock file, displays which harness is installed:

```
templates version    ✓ matches binary (0.2.0)
harness              ✓ cursor — .cursor/ present
```

New check: verifies that the harness folder the lock claims is actually present on disk.

---

## 7. `installed.lock` schema change

Extend the lock with a `harness` field:

```yaml
version: 2
harness: cursor # NEW: key from the Harness registry
templates_version: 0.3.0
entries:
  .cursor/skills/speckit-specify/SKILL.md:
    sha256: abc123
    installed_at: "2026-04-25T10:00:00Z"
    templates_version: "0.3.0"
...
```

Bump lock `version: 1` → `version: 2`. A v1 lock is automatically upgraded on the next
`specflow upgrade` by assuming `harness: claude` (the only harness that existed in v0.1). No data
loss.

`parseLock` now returns both harness and entries. `serializeLock` writes the new field. Legacy v1
locks still parse (harness defaults to `"claude"`) but are re-serialized as v2 after the next write.

---

## 8. DDD layout

```
src/
├── domain/
│   ├── core_bundle.ts          # NEW — CoreBundle, CoreEntry, CoreCategory
│   └── installed_lock.ts       # MODIFY — add harness field, bump version to 2
├── application/
│   ├── ports.ts                # MODIFY — add Harness interface
│   ├── harnesses.ts            # NEW — registry (HARNESSES + findHarness)
│   ├── init_project.ts         # MODIFY — accept Harness dep, map core→bundle
│   └── upgrade_project.ts      # MODIFY — read harness from lock, map core→bundle
├── infrastructure/
│   ├── harness/
│   │   ├── claude_harness.ts   # NEW — ClaudeHarness implementation
│   │   └── cursor_harness.ts   # NEW — CursorHarness implementation
│   └── core_bundle_loader.ts   # NEW — loads CORE_BUNDLE from the generated module
├── cli/
│   ├── parser.ts               # MODIFY — accept --ai cursor
│   ├── help.ts                 # MODIFY — usage text
│   └── handlers/
│       ├── init_handler.ts     # MODIFY — pick harness, pass to use case
│       ├── upgrade_handler.ts  # MODIFY — pick harness from lock
│       └── check_handler.ts    # MODIFY — surface harness info
├── main.ts
└── templates_bundle.ts         # REGENERATED — now exports CORE_BUNDLE too

templates/
├── manifest.json               # MODIFY — every entry declares category+name (harness-agnostic)
├── core/                       # NEW structure (was templates/claude/, templates/specify/, templates/root/)
│   ├── commands/speckit.<name>.md
│   ├── commands/backlog.md
│   ├── agents/<name>.md
│   ├── skills/speckit/SKILL.md
│   ├── specify/memory/constitution.md
│   ├── specify/templates/...
│   ├── specify/scripts/...
│   └── root/{AGENTS.md, tasks/backlog.md, .gitignore}
└── harness-specific/
    ├── claude/CLAUDE.md        # Claude-only static file
    └── cursor/specify-rules.mdc # Cursor-only static file

scripts/bundle-templates.ts     # MODIFY — emit CORE_BUNDLE + harness-specific static files
```

Note the `templates/` reorg: we move from harness-flat to core-first. The bundler rewrites
`src/templates_bundle.ts` to export `CORE_BUNDLE: CoreBundle` plus
`HARNESS_STATIC: Record<string, Record<string, TemplateFile>>` (static per-harness overrides like
`CLAUDE.md` or `specify-rules.mdc`).

---

## 9. Testing strategy

### 9.1 Domain

- `tests/domain/core_bundle_test.ts` — value type invariants, 3 tests.
- `tests/domain/installed_lock_test.ts` — EXTEND with 2 new tests: v1 lock auto-upgrades to v2 with
  `harness: claude`; v2 round-trips with harness field.

### 9.2 Infrastructure

- `tests/infrastructure/harness/claude_harness_test.ts` — **snapshot test** against the current
  post-v0.1 Claude layout: for every destination in the current bundle, assert the refactored
  `ClaudeHarness.mapBundle(CORE_BUNDLE)` emits the same content. This is the regression guard — if
  the refactor breaks anything, this test fails. ~5 tests (one per category).
- `tests/infrastructure/harness/cursor_harness_test.ts` — 6 tests: command → `speckit-<name>`,
  backlog command → `specflow-backlog`, agent → `specflow-agent-<name>`, skill → folder, spec-root →
  unchanged path, static `specify-rules.mdc` emitted.

### 9.3 Application

- `tests/application/init_project_test.ts` — EXTEND with 2 tests: `init --ai cursor` writes under
  `.cursor/`; installed.lock records `harness: cursor`.
- `tests/application/upgrade_project_test.ts` — EXTEND with 1 test: upgrade reads harness from lock
  and uses the matching harness to diff.

### 9.4 CLI

- `tests/cli/parser_test.ts` — EXTEND with 2 tests: `--ai cursor` accepted, `--ai bogus` rejected.

### 9.5 Integration

- `tests/integration/init_cursor_test.ts` — NEW: spawn real binary with `--ai cursor`, assert
  `.cursor/skills/speckit-specify/SKILL.md` exists and `.cursor/rules/specify-rules.mdc` exists;
  assert `.claude/` does NOT exist. 1 test.

Target: ~196 → ~215 tests (+19).

---

## 10. Risks and open questions

1. **Cursor agent-as-skill fidelity**: wrapping Claude agents as Cursor skills relies on the Cursor
   Agent to actually invoke them by name from `specify-rules.mdc`. Field test needed. If the UX is
   poor, we may want to collapse all agents into a single `specflow-team.md` rules file in a later
   iteration.
2. **Templates reorganization risk**: moving `templates/claude/...` → `templates/core/...` touches a
   lot of files. Mitigation: the snapshot-based `claude_harness_test.ts` is the safety net. Run
   before and after the refactor to prove no regression.
3. **Lock version migration**: v1 → v2 happens silently. A user on v0.1.0-alpha.3 who `upgrade`s
   gets v2 written. Rollback to an older binary would reject the v2 lock. Acceptable — we're in
   alpha.
4. **Upgrade across harnesses**: the lock records one harness. If the user somehow scaffolds both
   Claude and Cursor manually and then calls `specflow upgrade`, only the lock-recorded harness is
   upgraded. The other harness's files are not tracked and are preserved as "customized" in v0.1
   semantics. Document this clearly.
5. **`--ai` flag value validation**: we reject unknown values at the parser level. A future harness
   addition needs to update both the parser's accepted set and the registry. Keep them in sync via
   an exported constant `KNOWN_HARNESSES: readonly ["claude", "cursor"]`.
6. **CLAUDE.md vs specify-rules.mdc mapping**: these are harness-specific static files. We keep them
   under `templates/harness-specific/<key>/` for clarity. If a third harness needs yet another
   static file, repeat the pattern.

---

## 11. Delivery plan (to be expanded in the implementation plan)

1. Domain: `core_bundle.ts` + `installed_lock.ts` v2 migration.
2. Bundler: rewrite `scripts/bundle-templates.ts` to emit `CORE_BUNDLE` + `HARNESS_STATIC`.
3. Templates: reorganize `templates/` into `core/` + `harness-specific/`. Regenerate the bundle.
4. Port: `Harness` interface.
5. `ClaudeHarness` adapter + snapshot regression test.
6. Refactor `InitProjectUseCase` + `UpgradeProjectUseCase` to route via `Harness`.
7. `CursorHarness` adapter + tests.
8. CLI: parser accepts `--ai cursor`; handlers pick the harness; help updated.
9. `specflow check --project` surfaces harness info.
10. Integration test `init --ai cursor`.
11. README + AGENTS.md: document multi-harness and the two supported today.

Estimated ~15 tasks, +19 tests.

---

## 12. Next step

After validation of this design, transition to `writing-plans` for the step-by-step implementation
plan.
