# Plan — Extract release concerns into a top-level `/ship` skill

- **Feature:** `033-ship-skill`
- **Branch:** `033-ship-skill`
- **Backlog item:**
  [#598 — Extract release concerns into a top-level /ship skill](https://github.com/specnaut/specnaut-cli/issues/598)
- **Date:** 2026-09-14

---

## 1. Why this exists

Specnaut hands a user a set of skills and, implicitly, a mental model of how a project is run. Today
that model does not survive contact with the skill list: `/board` manages the backlog, and
`/specnaut` manages **everything else** — specifications, planning, implementation, review, merge,
_and shipping to production_.

Shipping is not a specification concern. It has a different cadence (per release, not per feature),
a different risk profile (irreversible, outward-facing, triggers live pipelines), and a different
audience (whoever is on the hook for a bad deploy, who is not necessarily whoever wrote the spec).
Folding it into the spec router means the one irreversible verb in the product is reached through
the same door as "write me a plan".

The intended model is a triangle a user can hold in their head:

| Skill       | Owns                                                               |
| :---------- | :----------------------------------------------------------------- |
| `/board`    | the backlog — what we might do, and what we are doing              |
| `/specnaut` | the specification — what a thing is, and whether it is built right |
| `/ship`     | production — getting a built thing out the door                    |

**The measurable claim:** `/specnaut`'s own router advertises thirteen phases, two of which
(`tag-version`, `release-version`) are release concerns and are already marked non-chainable — they
sit outside the `plan → tasks → implement → review → merge` chain the router exists to drive. They
are passengers in a vehicle built for something else.

## 2. User scenarios

### P1 — A user ships a release (the primary journey)

- **Given** a project scaffolded by Specnaut with a versioning scheme configured, **when** the user
  invokes `/ship`, **then** the skill inspects repository state and either acts on an unambiguous
  intent or asks one disambiguating question.
- **Given** the user invokes `/ship tag`, **when** the working tree is clean, **then** a tag is
  computed, created and pushed, and no release is published.
- **Given** the user invokes `/ship release`, **when** an unreleased tag exists, **then** notes are
  generated for it and the release is published.

### P2 — A user reaches for the old address

- **Given** a user (or an agent acting on stale instructions) invokes `/specnaut tag-version`,
  **when** the router parses the phase name, **then** it states that release concerns moved to
  `/ship` and stops — it does not silently route, and it does not print a bare "unknown phase" that
  reads as a bug.

### P3 — An existing project upgrades

- **Given** a project scaffolded before this change, **when** the user runs `specnaut upgrade`,
  **then** the `/ship` skill appears, the two phase docs are removed from the `/specnaut` skill's
  directory, and the release scripts under `.specnaut/scripts/release/` keep working without being
  moved.

### Edge cases

- A harness with a **flat** layout (Windsurf, Copilot) has no nested skill folders — `/ship`'s
  sub-documents must not collide with each other or with `/specnaut`'s.
- A project whose user **customised** a release phase doc: `upgrade` must not silently discard the
  customisation when the file's address changes.
- A harness where `/ship` pushes a workflow file over the **12,000-character Windsurf cap**.

## 3. Requirements

- **FR-001** — The CLI bundles a new top-level skill named `ship` for every supported harness.
- **FR-002** — `tag-version` and `release-version` cease to be phases of the `specnaut` skill; their
  content moves under `ship`.
- **FR-003** — The `/specnaut` router's phase index, frontmatter `description`, `argument-hint` and
  `when_to_use` carry no release concern.
- **FR-004** — Invoking a removed phase name on `/specnaut` produces a message naming `/ship` as the
  new address.
- **FR-005** — The release scripts (`tag.sh`, `release.sh`, `release-github.sh`,
  `release-gitlab.sh`, `release-local.sh`) keep their destination `.specnaut/scripts/release/<name>`
  unchanged; only their documented owner changes.
- **FR-006** — No harness emits two bundle entries to the same destination. This must be enforced by
  a test that enumerates destinations, not by review.
- **FR-007** — Every `/ship` document shipped to Windsurf is at or under
  `WINDSURF_WORKFLOW_MAX_CHARS`, measured with `workflowLength`.
- **FR-008** — `isPluginCoveredPath` recognises `/ship`'s documents, so the plugin mirror covers
  them exactly as it covers `/specnaut`'s.
- **FR-009** — `plugin/skills/ship/` mirrors `templates/core/skills/ship/`, and the existing plugin
  sync test enforces it.
- **FR-010** — `specnaut upgrade` on a pre-existing project removes the two orphaned phase docs
  rather than leaving them beside the new skill — **only where they are unmodified.** A doc whose
  disk SHA differs from the lock SHA keeps the existing `wasCustomized` treatment (deleted only
  under `--force`, and then with a backup). This requirement must not be read as authorising removal
  of a customised orphan.
- **FR-011** — ~~`owner` is a closed set, not free text.~~ **Withdrawn** after the architecture
  audit reversed the fork (§10, A-2): there is no new `owner` field. Ownership moves into the
  existing `name` field, on the convention `backlog-doc` already uses, so there is no new value to
  constrain. The security seat's underlying concern — a typo scaffolding a directory nobody invokes
  — is now answered by the manifest's source paths being build-verified by
  `assertAllSourcesPresent`.
- **FR-012** — `phase` and `backlog-doc` converge on one sub-document shape: owner in `name`,
  document in `suffix`, subdirectory a property of the category. Every adapter's two sub-document
  branches collapse into one shared destination helper.
- **FR-013** — `PLUGIN_COVERED_PATHS_CLAUDE` is derived from `CORE_BUNDLE` through the Claude
  adapter's own destination function, not maintained as a list. `isPluginCoveredPath` becomes
  membership in that derived set.

## 4. Success criteria

- **SC-001** — A user asked "where do I go to release?" answers `/ship` without consulting
  documentation.
- **SC-002** — The `/specnaut` skill's own text contains no release vocabulary; a reader can
  determine its scope from its frontmatter alone.
- **SC-003** — Every supported harness receives a working `/ship` and a `/specnaut` with no dangling
  phase references, verified by the smoke suite rather than by inspection.
- **SC-004** — A project scaffolded before the change and upgraded after it reaches the same file
  set as one scaffolded fresh.

## 5. 🔒 The decision table

| The decision                                                                                                                | Its single home                                                                                                                            | What would duplicate it                                                                                                                                                                                                    |
| :-------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which skill a release concern belongs to                                                                                    | `templates/core/skills/ship/SKILL.md`                                                                                                      | a release verb re-listed in `specnaut/SKILL.md`'s phase index or `when_to_use`; a `tag`/`release` trigger phrase left in the specnaut frontmatter                                                                          |
| Which skill owns a skill sub-document                                                                                       | `templates/manifest.json`, in the entry's **`name`** field — the convention `backlog-doc` already uses (`name: board`, `suffix: groom.md`) | a harness adapter hardcoding `"specnaut"`; a second convention that puts the owner somewhere else for a different category; a new category meaning "a ship phase"                                                          |
| Where a skill sub-document lands for a harness                                                                              | one shared destination helper, consumed by every adapter's sub-document branch                                                             | any other module composing a `skills/<owner>/phases/` path — **including `src/domain/plugin_coverage.ts`, which does it twice today and must stop**; a test asserting a literal path string instead of calling the adapter |
| Which scaffolded paths the plugin mirror covers                                                                             | derived from `CORE_BUNDLE` through the Claude adapter's own destination function                                                           | `PLUGIN_COVERED_PATHS_CLAUDE` as a hand-maintained list; a parity test that re-states the prefix instead of consuming the derivation                                                                                       |
| How a moved document keeps its identity across the rename                                                                   | the lock's rename handling, exercised by `tests/integration/upgrade_removed_phases_test.ts`                                                | an `upgrade` path that treats the old address as an orphan and the new one as unrelated, which silently strands a customisation (see §11 finding 1)                                                                        |
| That no two bundle entries may share a destination                                                                          | the adapters' shared write site — a helper that refuses a duplicate key                                                                    | seven independent `out[dest] = …` assignments on a plain object, where a collision is a silent overwrite with no error and no type-level trace                                                                             |
| Where `/ship`'s sub-documents live in the **source** tree                                                                   | `templates/core/skills/ship/`                                                                                                              | choosing it freely — the plugin mirror is path-identical and coverage matches on destination, so FR-008 and FR-009 already determine it                                                                                    |
| Who owns a `phase-script`, given its destination is owner-independent                                                       | stated explicitly: `phaseScriptDestination` is owner-independent **by design**, and the source directory moves with the owner              | leaving the source path saying `specnaut` while the owner is `ship`, with nothing recording which is authoritative                                                                                                         |
| The flat-harness name for a nested document                                                                                 | `skillFolderName` + the flat adapters' `case "phase"`                                                                                      | a second prefixing rule for `/ship` specifically; a hand-written `specnaut-ship-*` literal                                                                                                                                 |
| Whether a scaffolded path is plugin-covered                                                                                 | `src/domain/plugin_coverage.ts` (`isPluginCoveredPath`)                                                                                    | a regex in a test that re-states which paths are covered                                                                                                                                                                   |
| The Windsurf size limit and how it is measured                                                                              | `WINDSURF_WORKFLOW_MAX_CHARS` + `workflowLength`                                                                                           | any check using `String.length`, or a second constant near 12000                                                                                                                                                           |
| Where the release scripts live at runtime                                                                                   | `phaseScriptDestination`                                                                                                                   | a `/ship` document citing a literal `.specnaut/scripts/release/...` path that the function could change out from under                                                                                                     |
| The legal values of `owner`                                                                                                 | `CoreEntry`'s `owner` type in `src/domain/core_bundle.ts` (a closed union)                                                                 | typing it `string`, which moves the allowlist into whatever each adapter happens to tolerate; a runtime validation function duplicating what the type already decides                                                      |
| **`phaseScriptDestination` must NOT consult `owner`** — the scripts' address is fixed and independent of who documents them | `phaseScriptDestination` (by omission — it reads `suffix` only)                                                                            | threading `owner` into it "for symmetry" with the phase case, which relocates five executable scripts out from under every already-scaffolded project                                                                      |
| That a removed phase name is retired, not unknown                                                                           | the `/specnaut` router's phase-extraction step                                                                                             | a per-phase "moved" note repeated in each removed doc's former location                                                                                                                                                    |

**Binding.** A decision may not move out of its home without this plan being amended first. A review
finding two homes for one of these rows is a plan violation, not a style opinion.

## 6. Technical context

- **Language / runtime:** TypeScript on Deno; templates are Markdown + shell.
- **Bundling:** `templates/manifest.json` declares every shipped file with a `category`;
  `scripts/bundle-templates.ts` reads it and generates `src/templates_bundle.ts`. Runtime code reads
  nothing from disk.
- **Categories today:** `agent`, `agent-memory`, `agent-doc`, `skill`, `phase`, `phase-script`,
  `spec-root`, `project-root`, `backlog-skill`, `backlog-doc`, `backlog-script`,
  `mergeable-project-root` (`src/domain/core_bundle.ts`).
- **Harness adapters:** seven, under `src/infrastructure/harness/`. Nested harnesses (claude, codex,
  cursor, opencode, antigravity) map a phase to `<root>/skills/specnaut/phases/<suffix>`; flat
  harnesses (windsurf, copilot) map it to a single prefixed workflow file.
- **Constraint — Windsurf:** `WINDSURF_WORKFLOW_MAX_CHARS = 12_000`, measured in code points by
  `workflowLength`.
- **Constraint — sizes:** `release-version.md` is **9,599** code points and `tag-version.md` is
  **2,591**, totalling **12,190** against a cap of 12,000 — an overage of 190. **A single merged
  `/ship` document exceeds the cap**, so the multi-document structure is forced by the platform, not
  chosen for taste.

  _An earlier draft of this plan gave 9,691 / 2,625 / 12,316. Those are `wc -c` **byte** counts, and
  the cap is enforced in **code points** by `workflowLength` — the very mismeasurement this plan's
  own decision table names as a duplicate. The conclusion survives; the margin is thinner than it
  looked. And it is a genuine floor rather than an upper bound: neither file contains a conditional
  `BEGIN:` block, so nothing is stripped before emission and any wrapper the adapter adds can only
  push the total further over._
- **Mirrors:** `plugin/skills/` duplicates `templates/core/skills/`, enforced by
  `tests/plugin/plugin_sync_test.ts`. `src/domain/plugin_coverage.ts` carries a third list,
  tolerated because a test holds it to the manifest — and that test is
  **`tests/domain/plugin_coverage_parity_test.ts`**, not the similarly-named
  `plugin_coverage_test.ts` an earlier draft of this plan cited. The distinction is load-bearing;
  see §10, finding A-1.

### Domain vocabulary

- **Skill** — a top-level capability a user invokes by name.
- **Phase** — a sub-document of a skill, loaded by that skill's router. Today the term is bound to
  `/specnaut` by convention _and by hardcoded destination_; this feature separates the two.
- **Owner** — the skill a phase document belongs to. Currently implicit (always `specnaut`); this
  feature makes it explicit.

## 7. Constitution check

| Principle                              | Verdict                                                                                                                                                   |
| :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. OSS / proprietary boundary          | ✅ Public half only; no private identifier involved.                                                                                                      |
| II. Single bridge is the HTTP contract | ✅ Not touched.                                                                                                                                           |
| III. Monorepo holds no product code    | ✅ All code lands in `apps/specnaut-cli/`.                                                                                                                |
| IV. Cross-cutting change discipline    | ✅ One half → one commit in the submodule plus a pointer bump.                                                                                            |
| V. Merge defaults — local by default   | ✅ Local `--ff-only` via `scripts/land.sh cli`. A `feat` needs its `## Agent adoption` section in the commit body and `check-adoption.ts` before landing. |
| VI. Centralised backlog routing        | ✅ #598's body and card move through the `product-owner` agent.                                                                                           |
| VII. Submodule autonomy                | ✅ Respected.                                                                                                                                             |
| VIII. Documentation conventions        | ✅ No version numbers or dates pinned in long-lived prose.                                                                                                |
| IX. Dogfooding clause                  | ⚠️ See Complexity Tracking — two papercuts surfaced while running this very phase.                                                                        |
| X. Epic status mirrors child progress  | ➖ Not an epic.                                                                                                                                           |
| XI. Consumer agnosticism               | 🔴 **A pre-existing violation was found in a file this feature touches.** See Complexity Tracking.                                                        |

### Complexity tracking

1. **§ XI violation, pre-existing, in scope by adjacency.**
   `templates/core/skills/alias-example/SKILL.md` names an unrelated consumer project and two of its
   commit SHAs under a "Prior art" heading. The file is absent from `templates/manifest.json`, so it
   never reaches a user project — but `specnaut/specnaut-cli` is public, and the line is also
   present in five historical commits. This feature does not create it and removing it is not
   required to satisfy any requirement here; it is recorded because the file is one of the seventeen
   that reference the phases being moved. **Remediation is a separate decision for the user** (§ XI
   calls for a history rewrite, not a revert, and prior precedent says deleting refs does not purge
   objects on GitHub).

   **Exposure, corrected by the security audit and verified here.** An earlier draft of this section
   said "five historical commits", which understates it and names the wrong surface. The string is
   reachable from **22 published release tags** — `v1.20.0` through `v4.3.0` — which is what users
   actually fetch, clone and build from. Deleting the line on `main` retracts the copy on `main` and
   stops further propagation; it retracts none of the tags, none of the `refs/pull/*` refs, and no
   fork or mirror.

2. **§ IX dogfooding papercuts, observed during this phase.** Running `create-new-feature.sh` from
   the CLI half reported _"Spec template not found"_ and _"no backlog move.sh installed — issue 598
   NOT moved"_. The CLI half has `.specnaut/specs/` but no `.specnaut/templates/` or
   `.specnaut/scripts/`. Both degrade gracefully and neither blocks this feature; § IX says to file
   rather than work around.

## 8. Surface impact

**The set is the union of TWO searches, and an earlier draft of this plan named only the first.**
Counted, not estimated:

| Search                                                                                                                                                     |  Files |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: |
| By phase **name** — `git grep -lI "tag-version\|release-version"` over `*.md` `*.ts` `*.json` `*.sh` `*.yml`, less the generated bundle and archived specs |     16 |
| By **destination** — `git grep -lI "skills/specnaut/phases/\|instructions/specnaut-\|workflows/specnaut-"`                                                 |     46 |
| **Union — the real surface**                                                                                                                               | **54** |

The name search alone is the wrong instrument and an earlier draft used it as "the definition of the
set". It finds files that _mention_ the two phases and misses every file that _composes their
destination_ — which is why it returns **zero of the seven harness adapters** this plan's own table
lists. The destination search is what finds the adapters, the per-harness assertions and the
coverage mirrors.

The groups below are the shape of the change, not its extent.

| Group                    | Files                                                                                                                                                                                                                                                                           |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bundle contract**      | `templates/manifest.json`, `src/domain/core_bundle.ts`                                                                                                                                                                                                                          |
| **Harness adapters (7)** | `claude`, `codex`, `cursor`, `opencode`, `antigravity`, `windsurf`, `copilot`                                                                                                                                                                                                   |
| **Shipped content**      | `templates/core/skills/specnaut/SKILL.md`, its `phases/tag-version.md` and `phases/release-version.md`, `templates/core/skills/alias-example/SKILL.md`                                                                                                                          |
| **Mirrors**              | `plugin/skills/specnaut/**`, `src/domain/plugin_coverage.ts`                                                                                                                                                                                                                    |
| **Gates**                | `tests/plugin/plugin_sync_test.ts`, `tests/domain/plugin_coverage_test.ts`, `tests/integration/init_windsurf_test.ts`, `tests/integration/init_copilot_test.ts`, `scripts/smoke/smoke-tag-release.sh`, `scripts/smoke/smoke-features.sh`, `scripts/smoke/audit.sh`, `README.md` |

Regenerated, not edited: `src/templates_bundle.ts` (via `deno task bundle`).

**Out of this repository:** the public docs (`specnaut.com`, `llms.txt`) live in
`specnaut/specnaut-web`. A checkbox here cannot be satisfied there — it needs its own linked item.

**No front-end surface.** The CLI has no FE source under the `accessibility-expert` detection
signals, so no artifact prototyping section applies.

## 9. Risks

| Risk                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| :------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A flat harness emits two documents to one path, silently overwriting one.             | FR-006: a test that enumerates every destination for every harness and fails on a duplicate. Windsurf's `case "skill"` already ignores `suffix`, so this is a live hazard, not a hypothetical.                                                                                                                                                                                                                                                                                                                  |
| A `/ship` document exceeds the Windsurf cap.                                          | FR-007, asserted with `workflowLength`, not `String.length`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `upgrade` leaves orphaned phase docs beside the new skill.                            | FR-010 plus an upgrade test on a pre-change scaffold.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A user's customised release phase **stops being read** when its address changes.      | Corrected by the security audit: the bytes are _not_ discarded — `computeUpgradePlan` marks a divergent orphan `wasCustomized` and deletes it only under `--force`, with a backup. The real failure is quieter: the customisation survives at the old address while the agent loads the vanilla document at the new one. If the edit was a guardrail ("never publish without a signed tag"), it is silently inert after an upgrade that reports success. Mitigation is rename-in-lock so the bytes travel — Q3. |
| The third mirror (`plugin_coverage.ts`) drifts.                                       | It is already held to the manifest by `plugin_coverage_test.ts`; extend that test rather than the list alone.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Retiring a phase name reads as a regression to an agent following stale instructions. | FR-004: a message that names the new address, not a bare "unknown phase".                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 10. Architecture audit

Dispatched to `architect-expert` against this document before any code existed. **Verdict: fail — 1
critical, 4 high, 4 medium, 2 low.** The plan changed in response; the fork was reversed. Every
finding below is recorded with what was done about it, and the two load-bearing ones were
independently re-verified here before being accepted.

### A-1 — CRITICAL — the chosen shape breaks the gate that made the third mirror tolerable

_Accepted, verified, and it is why the fork reversed._

`tests/domain/plugin_coverage_parity_test.ts` asserts
`coveredNames(".claude/skills/specnaut/phases/")` equals `bundleNames("phase")`. That assertion
rests on an invariant — **one category ⇒ one destination prefix** — which an `owner` field on
`phase` dissolves: `bundleNames("phase")` would include `/ship`'s documents while the
specnaut-prefixed `coveredNames` cannot. The test goes red by construction, and both available
repairs are worse than the disease (teach the test the owner → a fourth hand-written mirror; add a
second prefix call → a test composing a `skills/<owner>/phases/` path, which this plan's own table
forbids).

Verified directly: the assertion is as quoted. Also confirmed: §6 of this plan cited
**`plugin_coverage_test.ts`** for its tolerance argument, which is a different file. The gate is
`plugin_coverage_parity_test.ts`, and §8 had not listed it at all. Both corrected.

### A-2 — HIGH — the manifest would gain a _second_ owner convention, not converge on the first

_Accepted. This reverses the architecture, and it is the finding that earns the audit._ Verified
against the manifest directly:

| category                  | `name` holds                   | `suffix` holds                   | owner is                |
| :------------------------ | :----------------------------- | :------------------------------- | :---------------------- |
| `backlog-doc` (3 entries) | `board` — **the owning skill** | `groom.md` — the document        | **explicit**            |
| `phase` (21 entries)      | `plan` — the document          | `plan.md` — the document _again_ | **implicit**, hardcoded |

`backlog-doc` already solves this feature's problem, and every adapter's `case "backlog-doc"`
derives its destination through `skillFolderName` with nothing hardcoded. The Claude adapter's own
comment calls the two branches "the same shape as the router's `phases/`". So `phase` and
`backlog-doc` are **alternative classes with different interfaces** — and `phase` additionally
carries a redundant field pair, with `name` and `suffix` both naming the document.

Adding `owner` to `phase` alone would leave the manifest with two mechanisms for one fact, and would
make this plan's decision-table row false for `board`.

**Disposition: the fork is reversed.** The plan now converges `phase` onto the `backlog-doc` shape —
owner in `name`, document in `suffix`, the `phases/` subdirectory a property of the category — and
collapses each adapter's two sub-document branches into one shared helper. FR-011's closed-union
`owner` field is withdrawn along with the field itself.

**The cost of the reversal, stated honestly:** a one-time rename of 21 `phase` entries in
`templates/manifest.json` and a fixup in the parity test's `bundleNames("phase")`. Both mechanical
and build-verified. It is a larger diff this cycle and the only version that does not have to be
made again.

### A-3 — HIGH — no row owned FR-010's rename identity

_Accepted; a row was added._ The highest-consequence unowned decision in the plan, and it converges
with the security audit's finding 1 from the other direction: today's orphan path marks a customised
document `remove`, which §2's edge case forbids. Homed on the lock's rename handling, exercised by
extending `tests/integration/upgrade_removed_phases_test.ts` rather than writing a new test.

### A-4 — HIGH — blast radius understated, and the counting instrument was wrong

_Accepted, re-measured, and the audit was if anything generous._ The audit said 45; the measurement
recorded in §8 is **54** (16 by name, 46 by destination). The instrument, not the arithmetic, was
the defect — see §8.

### A-5 — HIGH — two decision-table rows contradicted each other

_Accepted; resolved in favour of the stricter row._ The table forbade "any other module composing a
`skills/<owner>/phases/` path" while another row blessed `src/domain/plugin_coverage.ts`, which does
exactly that twice (`isPluginCoveredPath`'s regex and `PLUGIN_COVERED_PATHS_CLAUDE`'s template
literal). A binding table that contradicts itself cannot settle the review it exists to settle.
`plugin_coverage` now stops composing paths and consumes the adapter's output; the mirror is
**deleted rather than gated**.

### A-6 — MEDIUM — a gate that narrows silently instead of failing

_Accepted; added to §8._ `tests/integration/phase_wiring_test.ts` sweeps destinations under a
hardcoded `.claude/skills/specnaut/phases/` prefix. Under any owner-bearing shape, `/ship`'s
documents leave that prefix and drop out of the sweep **without the test failing**. A gate that
quietly shrinks is worse than one that goes red — it is the exact defect class this project has
recorded before.

### A-7 — MEDIUM — optional-with-default gives one fact two spellings

_Moot under the reversed fork_, and recorded because the reasoning generalises:
`owner ?? "specnaut"` would have put a has-this-been-populated check in seven adapters, and
`CoreEntry` would have carried its fifth category-conditional field. Converging on `name` removes
the field rather than defaulting it.

### A-8 — MEDIUM — FR-006 had a detector but no home

_Accepted; a row was added._ A collision is `out[dest] = …` on a plain object — a silent overwrite
with no error and no type-level trace. Naming a test names the detector, not the home. The invariant
now lives at the write site.

### A-9 — MEDIUM · A-10/A-11 — LOW

Source-tree layout for `/ship` (determined by the mirror, so stated rather than chosen) and
`phase-script` ownership both got rows. The seven per-harness tests asserting literal scaffolded
paths are **recorded in §8 as pre-existing known duplicates outside this feature's scope**, so the
next reviewer does not file them as new.

### Unverified by the audit, carried forward as open risk

Three surfaces the seat flagged rather than confirmed: whether `deno task
bundle` is gated in CI
against a dirty committed bundle; whether the Antigravity and Copilot distribution manifests
enumerate skills individually; and whether `tests/plugin/{mirror,source}-exclusions.txt` need a
`/ship` entry. These become `tasks` items, not assumptions.

## 11. Security audit

Dispatched to `security-expert` against this document before any code existed. **Verdict: sound to
proceed, with amendments. 0 critical, 0 high, 2 medium.**

### Coverage, stated because a clean verdict is worth what it covered

Four of the eleven security knowledge-base files were read (`00-triage`, `README`,
`03-injection-and-input`, `06-supply-chain-and-integrity`); the rest were not reached within budget,
so the data-exposure reasoning below is argued from the triage blast-radius rule rather than from
`07-data-protection`. The seat also did not read the five release scripts' bodies — unchanged by
FR-005, so out of scope here, but if any interpolates a branch name or tag message into a shell
string that belongs to the implementation review.

### Q1 — new input surface: **not a finding, and the guard was located**

The concern was that `owner` feeds a filesystem destination. Two layers already bound it, both at
the sink: `assertSafeDestination` (`src/domain/template.ts`) normalises and rejects absolute paths
and any `..` segment; `assertInsideProject` / `resolveTarget`
(`src/infrastructure/fs_containment.ts`) resolves symlinks iteratively and refuses a root that is
the filesystem root or `$HOME`. Every mutating sink calls both, and
`tests/infrastructure/containment_sweep_test.ts` enforces the pairing structurally rather than case
by case. Independently, `owner` is a **build-time** value frozen into `src/templates_bundle.ts` by
`scripts/bundle-templates.ts` — there is no runtime entry point for it at all.

Two hardening points were taken into the plan rather than argued with: **FR-011** (type `owner` as a
closed union so the compiler is the allowlist — the failure guarded against is not traversal but a
typo scaffolding `skills/shp/` that nobody invokes) and the **negative** decision-table row
forbidding `phaseScriptDestination` from consulting `owner`.

### FINDING 1 — MEDIUM — a moved address makes a customised guardrail silently inert

_Accepted; the plan changed._ The seat traced the overwrite authority end to end and found the
plan's risk row **wrong in direction**. `init` refuses pre-existing managed files;
`computeUpgradePlan` marks a divergent file `preserve` and never writes it; an orphan carries
`wasCustomized` and is deleted only under `--force`, with a backup. So the customisation is **not
discarded** — it survives at the old address while the agent loads the vanilla document at the new
one. A user whose edit was a release guardrail has an inert guardrail and a success message.

Two plan changes followed: FR-010 now excludes customised orphans explicitly (as written it could
have instructed an implementer to bypass the one branch standing between an upgrade and a
`--force`-less deletion), and the §9 risk row was rewritten in the corrected direction. The
mitigation — rename-in-lock, so the bytes travel to the new address — is **Q3** at the stop.

_Unverified by the seat:_ whether the two release docs fall under `isDeclaredPreserved` today. If
they do, the orphan branch short-circuits before `wasCustomized` is computed; the mechanism changes
shape, the conclusion does not.

### FINDING 2 — MEDIUM — the § XI leak is reachable from 22 published tags

_Accepted; recorded, and the plan's own text was corrected._ See Complexity Tracking §1. The seat
measured reach rather than presence and confirmed the containment claim in both directions: the file
is absent from `templates/manifest.json`, from the generated bundle, and from the `plugin/` mirror,
so **no user project ever receives it** — but it is reachable from 22 release tags, which is what
users fetch. Severity is medium and the reason matters: the disclosed bytes are a repository
identifier and two commit hashes, a policy violation with real third-party cost, not an attacker
capability. The seat deliberately did not restate the identifier, on the grounds that reproducing it
into a fourth artefact is the same violation. This plan follows that discipline.

### Q4 — what an authenticated stranger gains: **nothing new, and here is what was checked**

No new distribution channel — `/ship` rides the same manifest → bundle → generated module path as
every existing skill, with no fetch, registry, or runtime plugin load. The binary's own update path
verifies provenance against a pinned Sigstore identity (`self_update.ts` → `verifyProvenance`),
which bounds the realistic attack to landing a commit in the repository and getting it signed into a
release. Script destinations are immune to the new field. And the capability itself is not new:
`tag-version` and `release-version` already drive the same scripts — FR-002 changes an address, not
an authority.

One trade-off is recorded rather than treated as a defect: making `/ship` top-level lowers the
accidental-invocation threshold for the product's one irreversible verb. The plan makes that trade
deliberately in §1; FR-004's "moved, not unknown" message mitigates the stale-instruction half of
it.

## 12. Open questions

### ✅ Settled at the stop — 2026-09-14

| #                   | Decision                                                                                                                                                                                                      | Consequence                                                                                                                                                                                                                                                                |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**    | **Converge `phase` onto the `backlog-doc` shape.** The audit's reversal is accepted; the `owner` field is not added.                                                                                          | FR-011 withdrawn, FR-012 and FR-013 binding. The larger diff is taken deliberately, on the grounds that it is the version that does not have to be made again at the fourth skill.                                                                                         |
| **Q3 — upgrade**    | **Rename-in-lock.** A moved document's customised bytes travel to the new address and land in the normal `customized` bucket.                                                                                 | Closes §10 A-3 and §11 finding 1 together. `tests/integration/upgrade_removed_phases_test.ts` is extended rather than duplicated.                                                                                                                                          |
| **Q2 — sequencing** | **Separate mechanical commit first.** The `phase`/`backlog-doc` convergence lands alone — 21 manifest renames, seven adapter branches collapsed, no user-visible change — then the `/ship` extraction on top. | Two commits, each independently revertible. The convergence is reviewable as a rename rather than braided into a behaviour change.                                                                                                                                         |
| **§ XI**            | **Delete the line, and stop there for now.** No history rewrite, no Support request.                                                                                                                          | Retracts the copy on `main` and stops further propagation. The 22 published tags, the `refs/pull/*` refs and any fork are explicitly **not** retracted — recorded here so nobody later reads the deletion as a completed remediation. Handled outside this feature branch. |

### Decided without asking — visible here so a wrong assumption is correctable

- **The three-skill boundary is settled**, by the user's own statement: `/board` backlog,
  `/specnaut` specification only, `/ship` production. Not re-opened.
- **`/ship` keeps multiple documents.** Forced by the 12,000-code-point Windsurf cap, not chosen —
  §6.
- **The release scripts do not move at runtime.** `phaseScriptDestination` is owner-independent by
  design; only the source directory follows the owner.
- **The fork was reversed on the audit's evidence**, not referred upward, because the evidence is
  mechanical and checkable: `backlog-doc` already encodes an owner and `phase` does not. This is the
  one decision most worth a veto, so it leads the stop.
- **The § XI violation is not remediated by this feature.** It is recorded in Complexity Tracking
  and routed to the user as its own decision, because § XI remediation is a history rewrite on a
  public repository — outside a feature branch's authority.

### Q1 — Does `/ship` absorb the _monorepo-root_ release orchestrators too?

This plan covers the **shipped** skill only. The monorepo's own private `/release`, `/tag-version`
and `/release-version` orchestrators are a separate surface with a separate lifecycle. Leaving them
is the assumption; folding them in is a much larger change. **Assumed: out of scope.**

### Q2 — Does converging `phase` onto `backlog-doc` happen in this feature, or before it?

The convergence (FR-012) is now a prerequisite of the `/ship` extraction rather than a consequence.
It can ship as a **separate mechanical commit first** — 21 manifest renames plus one helper, no
user-visible change, independently revertible — or as one commit with the extraction. **Assumed:
separate commit first**, because a rename that touches 21 entries and seven adapters is easier to
review alone than braided into a feature.

### Q3 — How does a customised release document survive the move?

Both audits converged here from opposite directions (§10 A-3, §11 finding 1). The options:
**rename-in-lock**, so the customised bytes travel to the new address and land in the normal
`customized` bucket; or **preserve-and-report**, leaving the old file and naming it in the upgrade
summary. Rename-in-lock is what both seats recommend; preserve-and-report is more conservative and
leaves the user a manual step. **This one is genuinely open.**

### Q4 — Does the `/specnaut` router keep a retirement notice forever?

FR-004 says invoking `tag-version` on `/specnaut` names `/ship`. That notice has a lifetime:
permanent, or removed after some releases once stale instructions have aged out. **Assumed:
permanent** — it is three lines and the cost of removing it is a confusing failure for anyone on an
old prompt.
