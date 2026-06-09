# Feature Specification: Parent-managed detection for init/upgrade

**Feature Branch**: `009-parent-managed-init`\
**Created**: 2026-06-09\
**Status**: Draft\
**Input**: User description: "specify #371 — parent-managed detection for init/upgrade (suppress
.claude/ provisioning in a monorepo sub-repo)"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Initialise a sub-repo without re-introducing agentic files (Priority: P1)

A maintainer working inside a Specflow workspace (a parent repo that declares its sub-repos as
workspace members and centralises all skills/agents at its own root) runs `specflow init` inside one
of those sub-repos. They expect the spec-driven toolkit (`.specflow/`) to be provisioned so the
sub-repo can run the workflow, but they do **not** want a `.claude/skills/` or `.claude/agents/`
directory written into the sub-repo — those are owned by the parent and any local copy is drift that
the workspace deliberately eliminated.

**Why this priority**: This is the core regression the feature exists to prevent. Without it, a
single `specflow init` undoes the centralisation a workspace has invested in, silently re-scattering
agentic files across sub-repos. It is the reason the issue was filed.

**Independent Test**: In a fixture where the target directory is a declared workspace member of an
enclosing Specflow workspace, run `init` and assert that zero files are written under
`target/.claude/skills/` and `target/.claude/agents/`, while `.specflow/` is still fully provisioned
and a one-line notice is shown.

**Acceptance Scenarios**:

1. **Given** a target directory that is a workspace member of an enclosing providing Specflow
   workspace, **When** `specflow init` runs in that directory, **Then** `.specflow/` is provisioned
   normally and **zero** files are written under `.claude/skills/` or `.claude/agents/`.
2. **Given** the same parent-managed target, **When** `init` completes, **Then** a single notice
   line is shown: "parent-managed workspace detected — skills/agents inherited from parent".

---

### User Story 2 - Standalone OSS clone is unaffected (Priority: P1)

A community contributor clones the public Specflow CLI on its own — not nested inside any enclosing
Specflow workspace — and runs `specflow init` in a fresh project. They expect the full toolkit,
including `.claude/skills/` and `.claude/agents/`, exactly as today. The new detection must not
special-case the CLI or change anything for the overwhelmingly common standalone case.

**Why this priority**: Equal-criticality guardrail to US1. The feature is only acceptable if it is
invisible to the standalone path. A detection that mis-fires on a plain clone would break every
ordinary user and the OSS funnel.

**Independent Test**: In a fixture with no enclosing workspace, run `init` and assert skills/agents
are provisioned exactly as in the current behaviour.

**Acceptance Scenarios**:

1. **Given** a target directory with no enclosing providing Specflow workspace, **When**
   `specflow init` runs, **Then** provisioning is unchanged — skills and agents are written as
   today.
2. **Given** a target nested inside an enclosing Deno workspace that is **not** a providing Specflow
   workspace (no `.specflow/` at the ancestor), **When** `init` runs, **Then** detection returns
   negative and provisioning is unchanged.

---

### User Story 3 - Explicit standalone override (Priority: P2)

A user keeps their standalone Specflow project inside a parent Deno workspace for unrelated reasons
(e.g. a personal monorepo of Deno projects) and genuinely wants the full local toolkit. They place a
`standalone.yml` marker in the target's `.specflow/` to force full provisioning regardless of any
enclosing workspace.

**Why this priority**: An escape hatch that prevents the detection from silently surprising users
whose directory layout coincidentally resembles a managed workspace. Important for trust, but
secondary to the two P1 default behaviours.

**Independent Test**: In a parent-managed fixture, add `target/.specflow/standalone.yml`, run
`init`, and assert full provisioning occurs despite the enclosing workspace.

**Acceptance Scenarios**:

1. **Given** a target that would otherwise be detected as parent-managed, **When**
   `target/.specflow/standalone.yml` is present and `init` runs, **Then** the toolkit is fully
   provisioned including `.claude/skills/` and `.claude/agents/`.

---

### User Story 4 - Upgrade never resurrects deleted agentic files (Priority: P1)

A maintainer runs `specflow upgrade` inside a parent-managed sub-repo to refresh the `.specflow/`
toolkit to a newer CLI version. The sub-repo has no `.claude/` (it was deliberately removed). They
expect the upgrade to update `.specflow/` only and to **not** recreate any `.claude/skills/` or
`.claude/agents/` — the deletion must survive the upgrade.

**Why this priority**: Upgrade runs far more often than init over a repo's life. If upgrade
re-creates agentic files, the regression returns on the next routine version bump even after a
correct init — so this is as critical as US1.

**Independent Test**: In a parent-managed fixture with no `.claude/`, run `upgrade` and assert
`.specflow/` is updated while zero agentic files are (re)created and no `.claude/` directory is
resurrected.

**Acceptance Scenarios**:

1. **Given** a parent-managed target with no `.claude/`, **When** `specflow upgrade` runs, **Then**
   `.specflow/` toolkit files are updated and **no** `.claude/` skills/agents are created.
2. **Given** a standalone target, **When** `upgrade` runs, **Then** behaviour is unchanged from
   today.

---

### Edge Cases

- **Detection stops at the first providing ancestor**: walking upward, the first ancestor that is a
  providing Specflow workspace decides the result; ancestors above it are not consulted.
- **Ancestor has `.specflow/` but does not list the target as a member**: detection returns negative
  — proximity alone is not enough; the target must be a declared workspace member that resolves to
  the target path.
- **Ancestor lists members but has no `.specflow/`**: not a _providing_ workspace → detection
  returns negative.
- **Symlinked or relative member paths in the ancestor manifest**: member paths are resolved to
  absolute, canonical paths before comparison so that an equivalent-but-differently-spelled path
  still matches the target.
- **Filesystem root reached with no providing ancestor**: detection returns negative (standalone
  path).
- **`standalone.yml` present but malformed/empty**: presence of the marker file is sufficient to
  force provisioning; its contents are not required for the override to take effect.
- **`init` in an already-initialised parent-managed target**: same suppression applies; no agentic
  files are added on re-run.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The CLI MUST determine, for a given target directory, whether that directory is
  _parent-managed_ — i.e. nested inside an enclosing **providing Specflow workspace** that declares
  the target as one of its members.
- **FR-002**: A _providing Specflow workspace_ MUST be defined as an ancestor directory that BOTH
  contains a `.specflow/` toolkit AND declares a workspace member list in which at least one member
  resolves to the target directory's path.
- **FR-003**: Detection MUST walk parent directories upward from the target to the filesystem root
  and resolve on the **first** ancestor that satisfies FR-002; if none is found, detection MUST
  return negative.
- **FR-004**: Member-path comparison MUST resolve both the declared member path and the target path
  to absolute canonical paths before comparing, so equivalent paths expressed differently still
  match.
- **FR-005**: When the target is parent-managed, `specflow init` MUST provision the `.specflow/`
  toolkit as normal AND MUST write **zero** files under the target's `.claude/skills/`,
  `.claude/agents/`, or any orchestration `.claude/` agentic files.
- **FR-006**: When the target is parent-managed, `specflow init` MUST emit exactly one
  human-readable notice indicating that a parent-managed workspace was detected and skills/agents
  are inherited from the parent.
- **FR-007**: When the target is parent-managed, `specflow upgrade` MUST update the `.specflow/`
  toolkit only and MUST NOT create or resurrect any `.claude/` skills/agents, even if the target
  currently has no `.claude/` directory.
- **FR-008**: A `standalone.yml` marker file in the target's `.specflow/` MUST override detection
  and force full provisioning (the standalone path) regardless of any enclosing workspace.
- **FR-009**: When the target is NOT parent-managed (and no override applies), both `init` and
  `upgrade` MUST behave exactly as today, with no change to the files written.
- **FR-010**: The detection MUST NOT special-case the Specflow CLI repository itself; a standalone
  clone of the CLI MUST take the unchanged full-provisioning path. The only inputs to the decision
  are the enclosing-workspace structure and the override marker.
- **FR-011**: The feature MUST NOT alter the content or behaviour of any provisioned skill or agent;
  it changes only **whether** agentic files are written into a given target.
- **FR-012**: The install manifest (the record of what was provisioned) for a parent-managed target
  MUST NOT list any `.claude/skills` or `.claude/agents` entries, so a later upgrade/check
  reconciles against the suppressed set rather than expecting files that were intentionally not
  written.

### Key Entities _(see Domain Model section below for full structure)_

- **Target repository**: the directory `init`/`upgrade` is operating on; the subject of the
  parent-managed decision.
- **Providing Specflow workspace**: an ancestor directory that owns the centralised skills/agents
  and declares the target as a workspace member.
- **Standalone override marker**: a file in the target that forces full provisioning.
- **Install manifest**: the persisted record of which toolkit files were provisioned into the
  target.

## Domain Model _(mandatory)_

**Bounded context:** CLI provisioning (the `init` / `upgrade` / `check` lifecycle that writes the
Specflow toolkit into a target repository).

**Vocabulary (Ubiquitous language):**

- **Target repository** — the directory the provisioning command operates on.
- **Providing Specflow workspace** — an ancestor that contains `.specflow/` and declares the target
  as a workspace member; it owns the centralised skills/agents the target would otherwise duplicate.
- **Parent-managed** — the state of a target that sits inside a providing workspace; in this state
  agentic files are inherited, not written locally.
- **Agentic files** — files under `.claude/skills/` and `.claude/agents/` (plus orchestration
  `.claude/` files) that make a repo independently drive the workflow.
- **Toolkit (`.specflow/`)** — the spec-driven assets (templates, memory, scripts) that are
  provisioned regardless of parent-managed state.
- **Standalone override** — an explicit marker in the target that forces full provisioning even
  under a providing workspace.
- **Install manifest** — the persisted record of provisioned files used by later upgrade/check runs.

**Entities (have identity):**

- **Target repository** [aggregate root] — identified by its absolute canonical path; carries the
  toolkit and, when not suppressed, the agentic files; owns its install manifest and any override
  marker.
- **Providing Specflow workspace** — identified by its directory path; declares a member list and
  contains a toolkit; the ancestor that makes a target parent-managed.

**Value objects (no identity, immutable):**

- **ParentManagedDecision(isParentManaged, providingWorkspacePath?)** — the computed outcome of
  detection for one target; pure function of the filesystem state at evaluation time.
- **StandaloneOverride(present: boolean)** — derived from the existence of the marker file in the
  target's toolkit directory.

**Invariants (rules the domain must never break):**

- A parent-managed target never has agentic files written into it by `init` or `upgrade` — why: any
  local copy is the drift the centralised workspace eliminated.
- The standalone override always wins over a positive detection — why: users must be able to opt out
  of a coincidental layout without surprise.
- Detection never reads or depends on the identity of the target repo (e.g. "is this the CLI") —
  why: FR-010, the CLI must not be special-cased.
- The toolkit (`.specflow/`) is always provisioned regardless of the decision — why: a
  parent-managed sub-repo still needs to run the workflow.
- The install manifest reflects exactly what was written — why: upgrade/check must reconcile against
  reality, not an assumed full set.

**Out of scope (other bounded contexts touched but not owned here):**

- **Skills/agents content** — what each skill or agent does is unchanged; this feature only gates
  whether they are written.
- **Per-project customisation preservation (#367)** — the orthogonal `--force` manifest-preservation
  feature is not part of this work.
- **Cloud / Mobile halves** — this is a CLI-only change; it does not touch the proprietary halves
  directly.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In a fixture where the target is a declared member of an enclosing providing
  workspace, `specflow init` writes **0** files under `target/.claude/skills/` and
  `target/.claude/agents/`. (maps C1)
- **SC-002**: In a standalone fixture (no enclosing providing workspace), `specflow init` provisions
  skills and agents identically to the current behaviour — verified by file-count/content parity
  against the pre-feature baseline. (maps C2, FR-010)
- **SC-003**: In a parent-managed fixture with no `.claude/`, `specflow upgrade` re-creates **0**
  agentic files and resurrects no `.claude/` directory. (maps C3)
- **SC-004**: With `target/.specflow/standalone.yml` present under an enclosing workspace,
  `specflow init` performs full provisioning (skills and agents written). (maps C4)
- **SC-005**: For a parent-managed target, the install manifest records **0** `.claude/skills` and
  **0** `.claude/agents` entries. (maps C5)
- **SC-006**: The notice "parent-managed workspace detected — skills/agents inherited from parent"
  appears exactly once on a parent-managed `init` and never on a standalone `init`.

## Assumptions

- The enclosing-workspace relationship is expressed via the parent's Deno workspace member
  declaration (the existing `deno.json` `workspace` mechanism); no new configuration format is
  introduced for the parent.
- "Orchestration `.claude/` files" means agentic provisioning under `.claude/` (skills, agents, and
  any command/loop scaffolding the CLI writes); non-agentic, user-authored `.claude/` content the
  CLI never manages is irrelevant because the CLI does not touch it.
- The override marker lives at `target/.specflow/standalone.yml`; its mere presence is the signal —
  no schema is required for this feature.
- The existing install-manifest mechanism already records provisioned paths, so suppression is
  reflected simply by not recording the suppressed entries.
- Detection cost (walking ancestors and reading at most one manifest per level) is negligible
  relative to overall `init`/`upgrade` runtime; no performance budget concern.
- This is a CLI-only change tracked on `mkrlabs/specflow`; the contract was authored under the
  centralisation epic and is the authority for acceptance (C1–C5).
