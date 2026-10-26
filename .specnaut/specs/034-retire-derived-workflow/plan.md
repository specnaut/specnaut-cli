# Plan: Retire the derived parallel workflow

**Branch**: `feat/034-retire-derived-workflow` | **Date**: 2026-10-26 | **Backlog item**: tracked
privately by the maintainer (a public commit must not cite it). Public precedents: #270, #302, #320.

---

## 1. Why this exists

Specnaut ships two workflows for one job. Its own pipeline is
`plan → tasks → implement → review →
merge`. Beside it sits a second one, adapted from
obra/superpowers v5.1.0 under epic #270 and the audit commits of #302 / #320:

- seven standalone skills;
- a bootstrap skill that a plugin SessionStart hook injects into every session;
- five `/specnaut audit <axis>` phase documents.

An agent that loads both workflows gets two answers to "how do I plan this?", and the derived
material is not Specnaut's own. When this ships, fresh scaffolds, plugins and upgraded installs
carry only material Specnaut wrote, and no upgrade puts the retired files back.

Measured on `main` at v6.0.0:

- every file with an attribution line belongs to the 12 bundled documents above, or to 2 plugin
  adapters (`plugin/hooks/session-start`, `.opencode/plugins/specnaut.js`);
- `specnaut check --project` emits 12 "missing" warnings for a project that deleted them by hand,
  because `PLUGIN_COVERED_PATHS_CLAUDE` still lists them.

## 2. User scenarios

### US1: A fresh project carries only Specnaut's workflow (P1)

**Given** an empty repository. **When** `specnaut init --ai <harness>` runs, for every supported
harness. **Then** none of the retired skills, references or audit phases is written, and no file the
scaffold writes names one.

### US2: An upgraded project is cleaned, and stays clean (P1)

**Given** a project installed at 6.0.0, with some retired files untouched and one customised.
**When** `specnaut upgrade` runs. **Then**:

- the untouched copies are removed and their lock entries dropped;
- the customised copy is kept and reported, and removed only under `--force`;
- a second upgrade reinstalls nothing;
- `specnaut check --project` reports no missing-file warning for a retired path, whether the files
  were removed by upgrade or deleted by hand.

### US3: Someone types a retired command (P2)

**Given** a user or agent following an instruction written before this change. **When** they run
`/specnaut audit security` (or any other axis, in either spelling). **Then** the router says the
phase is retired and names its replacement (`/sec-audit`, `/perf-audit`, `/a11y-audit`,
`/arch-audit`, `/dep-audit`, or `/code-audit` for every axis), then stops.

### US4: A plugin user (P2)

**Given** Specnaut installed as a Claude Code, Cursor, Codex or OpenCode plugin. **When** a session
starts. **Then** no bootstrap is injected, and the plugin still exposes Specnaut's own skills and
agents.

### Edge cases

- A project that declared the retired paths in `.specnaut/preserve.yml` and deleted them: upgrade
  takes no action and drops the lock entries. A declared path that is still on disk stays as
  `preserve/declared, dropped-upstream`; that is the existing FR-009 rule.
- A project whose own files mention a retired skill: Specnaut does not touch the user's files.
- `/specnaut audit-security` (the hyphenated form) gets the same notice as the two-word form.

## 3. Requirements

- **FR-001**: The bundle carries none of the retired set:
  - the skills `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`,
    `requesting-code-review`, `verification-before-completion`, and `using-specnaut` with its
    `references/*-tools.md`;
  - the five `HARNESS_STATIC` entries those references feed, so `.specnaut/harness-tools.md` is no
    longer written for any harness (only `using-specnaut` reads it);
  - `phases/audit-{security,performance,accessibility,architecture,dependencies}.md`.
- **FR-002**: Every reference to the retired set is removed or rewritten. The search uses an
  explicit term list:
  - the seven skill names and `-tools.md`;
  - `harness-tools`, `session-start`, `hooks.json` and `hooks-cursor`;
  - both spellings `audit-<axis>` and `audit <axis>`;
  - `superpowers`.

  It covers the whole CLI tree (`git grep`), minus `src/templates_bundle.ts`, `CHANGELOG*` and
  `.specnaut/specs/`. Allowed survivors:
  - the router's retirement notice;
  - `tests/cockpit/core_test.ts`'s non-phase assertion, which stays true;
  - the generic "session-start equivalents" prose in
    `templates/core/specnaut/memory/security/11-ai-and-agentic-surface.md`.

  `.specnaut/release/README.md`'s workspace design-doc path is reworded so it names no upstream.
- **FR-003**: The plugin distributions inject no bootstrap.
  - `plugin/hooks/` is deleted whole (`session-start`, `hooks.json`, `hooks-cursor.json`).
  - `.cursor-plugin/plugin.json` drops its `hooks` key **in the same commit**, so no shipped state
    points at a missing, CWD-relative script.
  - `tests/plugin/{mirror,source}-exclusions.txt` lose their hook lines.
  - The `.cursor-plugin` and `.codex-plugin` descriptions describe only Specnaut's pipeline.
  - A test asserts that no shipped plugin manifest declares a hook and that `plugin/hooks/` is
    absent.
- **FR-004**: The OpenCode plugin channel stays. `.opencode/plugins/specnaut.js` is rewritten from
  scratch as a **skills-only registrar**:
  - **(a)** its only effect is pushing `path.resolve(__dirname, "../../plugin/skills")` into
    `config.skills.paths`;
  - **(b)** it imports no `fs`, reads no file, and ignores `directory`, `client`, `process.cwd()`
    and the environment;
  - **(c)** it registers no `experimental.chat.*` or system-prompt transform.

  A test loads the module and asserts that its only hook is `config`.
- **FR-004b**: The rule for dispatching an agent by name on each harness needs a new home. It is
  "Claude: `Task(subagent_type="<name>")`; Codex: `spawn_agent(agent_type="<name>")`, never by
  description" (cli#599). Today it lives only in retired files. It moves to a managed section of
  `templates/core/root/AGENTS.md`. That file is always loaded, and it reaches existing projects
  through its managed sections. `scripts/smoke/smoke-all-harnesses.sh` asserts it there.
- **FR-005**: The `/specnaut` router answers every retired audit phase, in both spellings, with a
  retirement notice naming the replacement for each axis, in the same form as the `tag-version` /
  `release-version` notice.
- **FR-006**: The four `*-expert` agents stop naming a retired dispatcher. That is nine lines across
  four sources: the frontmatter `description`, the "Spawned by" body lines, and
  `accessibility-expert.md`'s gating line, all mirrored into `plugin/agents/`.
  - They describe the dispatch **shape**, not a dispatcher name: "a single-axis audit skill or
    `/code-audit`, over a resolved scope, findings inline".
  - The five per-axis skills drop their "`/specnaut audit <axis>` — the report-writing audit"
    bullet.
- **FR-007**: Upgrade removes the retired files through the existing orphan path; no new mechanism
  is added. Regression tests on Claude and Codex cover US2, including:
  - `.specnaut/harness-tools.md` is removed;
  - a customised copy is kept and reported by path;
  - a lock entry with `..` and one behind a symlinked ancestor are both refused.
- **FR-008**: `check --project` reports zero warnings for a retired path, on a Claude project
  without the plugin, whether the files were removed by upgrade or by hand.
- **FR-008b**: A bundle-derived resolution test runs over every bundled document. Each
  `/specnaut <phase>` mention must name a phase in the router index or a row of its "Removed phases"
  table. It is not a list of retired names. Beside it sits one attribution pin: no bundled document
  contains `superpowers`.
- **FR-008c**: The root `AGENTS.md` template and the `README.md` stop using `audit-security` as
  their example phase name, and use `review` instead.
- **FR-009**: The release notes, carried by the feature commits' `## Agent adoption` sections and
  the release HIGHLIGHTS, cover:
  - each removed skill;
  - the removed audit phases and their replacements;
  - that findings are now returned inline (no dated report file);
  - the plugin bootstrap removal ("Cursor plugin users: update");
  - what upgrade does with customised copies.
- **FR-010** (the other halves, after the CLI release):
  - the docs site drops `docs/migration-from-superpowers.md` and every link to it, and rewrites the
    `llms.md` passages about the bootstrap and the OpenCode transform;
  - the workspace runs `specnaut upgrade` at its root, which removes the root's lock-tracked copies,
    in the commit that moves the CLI pointer.

## 4. Success criteria

- **SC-001**: Searching a fresh scaffold of each harness for any retired name finds nothing.
- **SC-002**: An upgraded 6.0.0 project holds no retired file it did not customise. Its next upgrade
  is a no-op for the retired set.
- **SC-003**: `check --project` gives 0 warnings for retired paths, down from 12 today.
- **SC-004**: Searching the CLI tree for `superpowers`, excluding `CHANGELOG*` and
  `.specnaut/specs/`, finds nothing.

## 5. 🔒 Decision table

| The decision                                            | Its single home                                                                                                                                                      | What would duplicate it                                                                                                                                                           |
| :------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which documents ship                                    | `templates/manifest.json` (the bundle)                                                                                                                               | A second list. `PLUGIN_COVERED_PATHS_CLAUDE` and `SYNC_PAIRS` are _askers_, already pinned to the bundle by their parity tests. They must not gain a "retired" list of their own. |
| A file that left the bundle is removed on upgrade       | `src/domain/upgrade_plan.ts`, orphan loop (unchanged)                                                                                                                | A retirement registry, a migration table, a per-path `remove` list, or any new code path naming a retired file                                                                    |
| A customised orphan is kept unless `--force`            | `src/application/upgrade_project.ts`, the existing `wasCustomized \|\| force` filter (unchanged)                                                                     | A prompt or special case for the retired set                                                                                                                                      |
| What `check --project` treats as plugin-owned           | `src/domain/plugin_coverage.ts`, `PLUGIN_COVERED_PATHS_CLAUDE`                                                                                                       | A filter in `fs_project_inspector.ts` that skips retired names                                                                                                                    |
| Retired audit phase → its replacement                   | `templates/core/skills/specnaut/SKILL.md`, "Removed phases" section                                                                                                  | The mapping restated in an agent, `AGENTS.md` or a per-axis skill                                                                                                                 |
| Phases a project addendum may target                    | `src/domain/addendum_audit.ts`, its phase list                                                                                                                       | An addendum allowance for a retired phase                                                                                                                                         |
| How a phase dispatches a named agent, per harness       | `templates/core/root/AGENTS.md`, one managed section                                                                                                                 | The rule restated in a phase, an agent, a skill or a harness static                                                                                                               |
| What the OpenCode plugin may do                         | `.opencode/plugins/specnaut.js`, the registrar alone (FR-004 a–c)                                                                                                    | A prompt or message transform; a second adapter                                                                                                                                   |
| Where a full-codebase single-axis audit is delivered    | `templates/core/skills/<axis>-audit/SKILL.md`: findings inline, no report file                                                                                       | A report-writing step restated in an agent's mode text                                                                                                                            |
| Reuse before build (cli#664): new helper or automation? | This row. **Reuse directly.** Inventory: the bundle, the `upgrade_plan.ts` orphan loop, `plugin_coverage.ts`. Recurrence: none needed, since nothing new is planned. | Any new script, registry or migration step                                                                                                                                        |

## 6. Technical context

- **Language and version**: TypeScript on Deno (the CLI), Markdown templates, bash and JS plugin
  adapters.
- **Primary dependencies**: none added.
- **Storage**: `.specnaut/installed.lock`, unchanged format. Orphans are lock entries minus
  `newShas`, and `newShas` holds every bundled destination for the harness, harness statics
  included. A dropped static therefore takes the same removal path.
- **Testing**: `deno task test` (unit and integration), plus `scripts/smoke/run-all.sh`.
- **Target platform**: every supported harness: claude, cursor, codex, copilot, opencode,
  antigravity.
- **Constraints**:
  - `src/templates_bundle.ts` is regenerated, never edited by hand;
  - `plugin/skills` and `plugin/agents` stay byte-identical to their sources;
  - no Actions secret.

## 7. Constitution check

| Principle                                  | Verdict                                                                                  |
| :----------------------------------------- | :--------------------------------------------------------------------------------------- |
| I. OSS / proprietary boundary              | ✅ CLI-only. This public plan does not cite the private tracking item.                   |
| II. HTTP contract                          | ✅ untouched.                                                                            |
| III. Monorepo holds no product code        | ✅ the work lands in the CLI and web halves.                                             |
| IV. Cross-cutting discipline               | ✅ CLI commits first, then web, then the workspace pointer commit, pushed in that order. |
| V. Merge defaults                          | ✅ local `--ff-only` via `scripts/land.sh`.                                              |
| VI. Centralised backlog routing            | ✅ board writes go through the PO or `land.sh`.                                          |
| VII. Submodule autonomy                    | ✅                                                                                       |
| VIII. Documentation conventions            | ✅ no version pinned in long-lived prose.                                                |
| IX. Dogfooding                             | ✅ the workspace upgrades itself after the release (FR-010).                             |
| X. Epic status                             | ✅ single item.                                                                          |
| XI. Consumer agnosticism                   | ✅ invented fixtures; no consumer evidence is cited.                                     |
| XII. Escalate business, decide engineering | ✅ no fork in the always-ask class remains (§ 12). The bump is decided at release.       |
| Size gate                                  | ✅ see below: no file over its target grows.                                             |

**Complexity tracking**: none.

### Files touched

Measured with `wc -l` on 2026-10-26.

| File                                                                                              |             Lines now | Lines after (est.) | Over target?                           |
| :------------------------------------------------------------------------------------------------ | --------------------: | -----------------: | :------------------------------------- |
| `templates/core/skills/specnaut/SKILL.md`                                                         |                   197 |               ~195 | no                                     |
| `templates/core/root/AGENTS.md`                                                                   |                   123 |               ~130 | no (grows by the dispatch section)     |
| `src/domain/plugin_coverage.ts`                                                                   |                   248 |               ~225 | no                                     |
| `src/domain/addendum_audit.ts`                                                                    |                   212 |               ~207 | no                                     |
| the four `*-expert.md` agents                                                                     | 237 / 255 / 207 / 219 |               same | no (rewritten lines)                   |
| the five `<axis>-audit/SKILL.md`                                                                  |                 75–90 |            −4 each | no                                     |
| `README.md` / `AGENTS.md`                                                                         |             254 / 218 |             ≤ same | no                                     |
| `templates/manifest.json`                                                                         |                  1933 |              ~1780 | data table; shrinks                    |
| `scripts/smoke/smoke-features.sh`                                                                 |                  1187 |              ~1040 | already over the ceiling; shrinks      |
| `scripts/smoke/audit.sh`                                                                          |                   908 |             ≤ same | already over the ceiling; may not grow |
| `scripts/smoke/smoke-all-harnesses.sh`                                                            |                   147 |               ~145 | no                                     |
| `tests/plugin/plugin_sync_test.ts`                                                                |                   553 |               ~500 | already over the ceiling; shrinks      |
| `tests/templates/response_style_contract_test.ts`                                                 |                   328 |             ≤ same | over the target; may not grow          |
| other edited tests (`init_codex`, `init_copilot`, `codex_config`, `plugin_coverage`, reach tests) |            < 300 each |             ≤ same | no                                     |
| new `tests/integration/retired_workflow_upgrade_test.ts`                                          |                     0 |               ~220 | no                                     |
| new `tests/templates/phase_mentions_resolve_test.ts`                                              |                     0 |                ~60 | no                                     |
| new `tests/plugin/plugin_no_bootstrap_test.ts` (FR-003, FR-004)                                   |                     0 |                ~70 | no                                     |

## 8. Surface impact

- **Scaffold** (every harness): fewer files, no file names the retired set, and no
  `.specnaut/harness-tools.md`. `AGENTS.md` gains the dispatch rule.
- **Router**: `/specnaut audit <axis>` answers with a retirement notice.
- **Plugins**:
  - Claude Code and Cursor: no SessionStart hook. Skills and agents are still discovered from the
    manifests.
  - Codex: description rewritten.
  - OpenCode: same install line; the adapter only registers skills.
- **Upgrade and check**: behaviour unchanged; the bundle and the coverage list shrink.
- **Audits**: findings come back inline from `/sec-audit` and its siblings; no dated report file.
- **Cockpit mod**: no dependency.
- **Docs site** (specnaut-web): one page removed; `llms.md` and links updated (FR-010).
- **Contracts exposed**: none new. The lock format is unchanged.
- No front-end surface, so no artifact prototyping.

## 9. Risks

| Risk                                                                            | Mitigation                                                                                                                                                                |
| :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A dangling reference survives in a mirror (a plugin copy, a smoke test, a test) | FR-002 is an explicit term search over the whole tree. FR-008b keeps references from returning without becoming a retired-name registry.                                  |
| A plugin user loses skill discovery                                             | Claude Code and Cursor read `skills/` and `agents/` from the manifest, not the hook. FR-003's test asserts the manifests still point there. OpenCode keeps its registrar. |
| Codex loses its only written dispatch rule                                      | FR-004b re-homes it before the retired files go.                                                                                                                          |
| `.specnaut/harness-tools.md` lingers on upgraded projects                       | It leaves the bundle, so the orphan loop removes it. FR-007 asserts this.                                                                                                 |
| A kept customised copy still routes agents into the old workflow                | The user's bytes win, which is existing behaviour. Upgrade reports the copy by path, and the adoption prompt tells the agent to propose deleting it.                      |
| The durable dated audit report disappears with the phases                       | Accepted by the item's settled decision: phases are removed, not rewritten. The per-axis skills return the same expert's findings inline. The release notes say so.       |

## 10. Architecture audit

`architect-expert`, 2026-10-26. Verdict: fail, now fixed in this plan. 3 HIGH, 4 MEDIUM, 3 LOW. The
seat stopped at its turn limit before reading the upgrade engine and `specnaut.js`; the main session
read both (§ 6 and § 12).

| Finding                                                                                                                                         | Severity | Resolution                                                                                                                                                                                                        |
| :---------------------------------------------------------------------------------------------------------------------------------------------- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Codex `agent_type` dispatch rule has no home once the retired files go                                                                      | HIGH     | FR-004b, and a decision row                                                                                                                                                                                       |
| Retiring `references/*-tools.md` silently removes `.specnaut/harness-tools.md` (5 harness statics), and four smoke or test readers assert on it | HIGH     | FR-001 names it and FR-007 asserts its removal. The readers are rewritten: the `agent_type` assertion moves to `AGENTS.md`, and the Copilot marketplace line stays documented in the README and on the docs site. |
| The report-writing single-axis audit loses its home, and a risk row contradicted the skills                                                     | HIGH     | Decision row (inline per-axis skill), rewritten risk row, FR-006                                                                                                                                                  |
| FR-006 undercounted the agent edits                                                                                                             | MEDIUM   | FR-006 rewritten: nine lines, and it describes the shape, not a name                                                                                                                                              |
| The member-name search missed 25 of 92 files                                                                                                    | MEDIUM   | FR-002: explicit term list, whole-tree scope, named survivors                                                                                                                                                     |
| § 7 listed 5 of about 95 touched files                                                                                                          | MEDIUM   | § 7 re-measured: every file over 300 lines and every new test is listed                                                                                                                                           |
| A pin test of retired names would be a registry in test form                                                                                    | MEDIUM   | FR-008b: a positive resolution test plus a single attribution pin                                                                                                                                                 |
| The root `AGENTS.md`, which is always loaded, uses `audit-security` as its example                                                              | LOW      | FR-008c                                                                                                                                                                                                           |
| The cockpit has no dependency                                                                                                                   | LOW      | § 8                                                                                                                                                                                                               |
| The router's "Removed phases" table only grows                                                                                                  | LOW      | Declined. A pruning policy is a separate concern, and the table is small.                                                                                                                                         |

## 11. Security audit

`security-expert`, 2026-10-26. Verdict: needs follow-up, now folded in. 0 CRITICAL, 0 HIGH, 2
MEDIUM, 1 LOW.

- **Covered**:
  - upgrade orphan containment on the read and delete sides: absolute paths, `..`, symlinked leaf
    and ancestor, loops;
  - the customised-or-not decision: one SHA compare, and `--force` keeps a `.specnaut.bak`;
  - the hook manifests and the OpenCode adapter.
- **Not assessed**: harness run-time behaviour, namely Cursor's hook CWD and OpenCode's symlink
  handling.

| Finding                                                                                                                                                                              | Severity | Resolution                                                                                                                                                                                                      |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Cursor plugin hook runs `bash ./plugin/hooks/session-start` by a CWD-relative path. If Cursor's CWD is the opened project, a hostile repo runs its own script. Present in 6.0.0. | MEDIUM   | FR-003: removed in one commit, and a test asserts no shipped manifest declares a hook. The release notes tell Cursor plugin users to update.                                                                    |
| A rewritten OpenCode adapter had no stated limits, and the git install line is unpinned                                                                                              | MEDIUM   | FR-004 (a)–(c) and its test. The unpinned line is an accepted, pre-existing risk. Pinning it is a follow-up item.                                                                                               |
| A crafted lock entry can delete a matching in-project file without a backup. It exists today, and this feature does not widen it.                                                    | LOW      | Follow-up item: limit orphan removal to managed folders and refuse `.git/`. FR-007 still asserts `..` and symlinked-ancestor entries are refused.                                                               |
| INFO: a customised retired copy kept by a plain upgrade drops out of the lock, so it is reported once and a later `--force` cannot reach it                                          | —        | Confirmed in `upgrade_project.ts`: the lock is rebuilt from `newShas`. Accepted here, because the first upgrade reports it by path and the adoption prompt covers it. Keeping such entries is a follow-up item. |

## 12. Open questions

- **Q1, the OpenCode channel: settled 2026-10-26 by the seats, not asked.**
  - In `specnaut.js`, the derived part is the bootstrap injection:
    `experimental.chat.messages.transform` plus the bootstrap reader.
  - Registering `plugin/skills/` through the `config` hook takes six lines of plain OpenCode API.
  - Keeping the channel with a fresh registrar (FR-004) breaks no documented install line, so
    nothing in the always-ask class remains.
  - Rejected: dropping the channel. It would break the README and docs-site install line for no
    gain.
- **Decisions taken (2026-10-26, from the settled item):**
  - the audit phases are removed, not rewritten;
  - no retirement registry is added;
  - agents change only their dispatch lines (FR-006);
  - `docs/migration-from-superpowers.md` is removed without a redirect: GitHub Pages has no server
    redirects, and the site has no redirect convention;
  - the Codex description is rewritten to describe only Specnaut's pipeline.
- **Follow-up items to file:**
  - limit upgrade's orphan removal to managed folders and refuse `.git/` (security F3);
  - keep a kept customised orphan's lock entry so `--force` can still reach it (security INFO);
  - pin the OpenCode git install line to a release ref, if the specifier supports one (security F2).
