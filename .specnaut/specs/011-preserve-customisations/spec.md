# Feature Specification: Preserve per-project customisations across template refreshes

**Feature Branch**: `011-preserve-customisations`\
**Created**: 2026-06-09\
**Status**: Draft\
**Input**: GitHub issue mkrlabs/specflow#367 — "feat(init): preserve per-project agent
customisations across template upgrades (--force)"

## User Scenarios & Testing _(mandatory)_

The "user" here is a **project maintainer** who has tailored one or more bundled Specflow files to
their project — most often `.claude/agents/product-owner.md` (its GitHub Project handle and label
conventions) or `.claude/agents/developer.md` (its test/build commands), but also phase docs and
skill bodies they have locally tweaked. Those customisations live **inline in the file**, not in a
sidecar, so the template lifecycle cannot see them as anything but "a managed file with a different
hash."

Today the contract is asymmetric: `specflow upgrade` already auto-detects a changed hash and quietly
**preserves** the customised file, but `specflow init --force` overwrites **every** managed file
unconditionally — on 2026-06-08 a single `--force` refresh replaced 88 of 91 bundled files, silently
reverting a customised `product-owner.md` to the generic bundled version. The maintainer has no way
to say "this file is mine, keep it even on a forced refresh," and no way to see how their copy
diverges from the evolving bundle so they can fold in upstream improvements on purpose.

### User Story 1 - Declare a file as mine so a forced refresh never clobbers it (Priority: P1)

A maintainer who has customised a bundled file declares it **preserved**. From then on, neither
`specflow upgrade` nor `specflow init --force` overwrites it — the on-disk content is left exactly
as the maintainer left it, and each skipped file is reported with a clear, per-file line so the
outcome is never silent.

**Why this priority**: This is the headline regression the issue exists to close. Without it, the
one operation a maintainer reaches for to refresh templates (`init --force`) is the one that
destroys their inline configuration with no warning. Restoring control over a forced refresh is the
whole point; it is independently shippable and demonstrable on its own.

**Independent Test**: In a fixture project with a customised managed file declared preserved, run
`specflow init --force` and assert the file is byte-identical to its pre-refresh content, that a
notice naming the path was emitted, and that non-preserved managed files were still refreshed.

**Acceptance Scenarios**:

1. **Given** a customised managed file that the maintainer has declared preserved, **When**
   `specflow init --force` runs, **Then** the file's on-disk content is unchanged and a notice names
   it as preserved.
2. **Given** the same preserved file, **When** `specflow upgrade` runs and the bundle ships a new
   version of that file, **Then** the on-disk content is still unchanged and the file is reported as
   preserved (consistent with the `--force` behaviour).
3. **Given** a managed file that is **not** declared preserved, **When** `specflow init --force`
   runs, **Then** it is refreshed to the bundled version exactly as today (no behaviour change for
   undeclared files).
4. **Given** several preserved files skipped in one refresh, **When** the run completes, **Then**
   one clear line per skipped file is emitted, each naming the path and that it was preserved by the
   maintainer's declaration.

---

### User Story 2 - See how my customised files diverge from the bundle (Priority: P2)

A maintainer wants to decide, deliberately, whether to adopt upstream improvements to a file they
have customised. They ask Specflow to show how each customised (or preserved) file diverges from the
bundled original for the installed templates version, without changing any file, so they can fold in
the parts they want by hand.

**Why this priority**: Preserving a file freezes it; over several template releases the maintainer's
copy silently falls behind upstream fixes. A divergence view turns "preserved" from a dead end into
an informed choice — it is what makes long-term preservation safe. It is independently testable
against a project with at least one customised file and delivers value the moment it can render a
diff, independently of the reset flow in US3.

**Independent Test**: In a fixture with one customised managed file, run the divergence view and
assert it reports that file's difference against the bundled original, touches zero files, and exits
without error when nothing diverges.

**Acceptance Scenarios**:

1. **Given** a project with one or more customised managed files, **When** the maintainer runs the
   divergence view, **Then** it shows, per file, how the on-disk content differs from the bundled
   original — and modifies nothing on disk.
2. **Given** a project whose managed files all match the bundle, **When** the divergence view runs,
   **Then** it reports "no divergence" and exits successfully.
3. **Given** a preserved file that has fallen behind several bundle releases, **When** the
   divergence view runs, **Then** the maintainer can see exactly which lines upstream changed.

---

### User Story 3 - Deliberately discard my customisations for a clean refresh (Priority: P3)

A maintainer who has decided to abandon their customisations and return to the generic bundled
versions can explicitly opt out of preservation for a single refresh, so a forced refresh overwrites
even preserved files. This never happens by default — it requires an explicit, intentional opt-out.

**Why this priority**: The escape hatch matters but is the rarest path; US1 and US2 already deliver
the protective behaviour and the visibility. The reset is the deliberate "I really do want the clean
bundle back" lever, valuable but not on the critical path, and only acceptable if it is impossible
to trigger by accident.

**Independent Test**: In a fixture with a preserved customised file, run a forced refresh with the
explicit reset opt-out and assert the file is overwritten with the bundled version; run the same
forced refresh **without** the opt-out and assert the file is preserved.

**Acceptance Scenarios**:

1. **Given** a preserved customised file, **When** a forced refresh runs with the explicit reset
   opt-out, **Then** the file is overwritten with the bundled version and the override is reported.
2. **Given** the same preserved file, **When** a forced refresh runs without the opt-out, **Then**
   the file is preserved (the opt-out is never the default).

### Edge Cases

- **Preserve declared for a vanilla file** — the maintainer marks a file preserved but has not
  actually changed it (it matches the bundle). The declaration is honored (the file is left alone)
  and surfaced informatively; it is not an error.
- **Preserve declared for an unknown path** — a path that is not part of the managed bundle (a typo,
  or a file Specflow does not own). This is reported as an ineffective declaration (warn, no-op),
  not a fatal error and not a silent success.
- **Upstream removed the file** — a preserved path no longer exists in the new bundle. The
  maintainer's on-disk file is kept (preservation wins over removal) and the situation is surfaced
  so they know the bundle no longer ships it.
- **New bundled file added upstream** — a brand-new managed file the project does not yet have must
  still be added by a refresh; a preserve list governs existing files and must never block
  legitimate additions.
- **Parent-managed sub-repo** — in a workspace sub-repo where agentic files are intentionally not
  provisioned (009-parent-managed-init), a preserve declaration for an agent path is moot; the
  feature must not resurrect suppressed files.
- **Plugin-owned file** — a preserved path that the plugin now owns (the `migrate-to-plugin` path):
  preservation of the on-disk customised copy takes precedence over migration, consistent with the
  existing "customized → preserve" rule.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A maintainer MUST be able to declare one or more managed files as **preserved**, in a
  project-level, version-controllable declaration that survives across runs.
- **FR-002**: A forced refresh (`specflow init --force`) MUST NOT overwrite a file declared
  preserved; the on-disk content MUST be left intact.
- **FR-003**: `specflow upgrade` MUST honor the same explicit preserve declaration, so the
  protection is identical whichever refresh path the maintainer uses.
- **FR-004**: Every file skipped because it is preserved MUST be reported with a clear, per-file
  line that names the path and identifies preservation (declared by the maintainer) as the reason —
  no silent skips.
- **FR-005**: The system MUST provide an explicit opt-out that, only when intentionally invoked,
  overrides preserve declarations for a single forced refresh and restores the bundled versions; the
  opt-out MUST NOT be the default and MUST report which preserved files it overrode.
- **FR-006**: A maintainer MUST be able to view how each customised (or preserved) managed file
  diverges from its bundled original for the installed templates version, in a read-only operation
  that modifies no files.
- **FR-007**: A preserve declaration for a file that currently matches the bundle MUST be honored
  and surfaced informatively (no divergence yet), not treated as an error.
- **FR-008**: A preserve declaration for a path outside the managed bundle MUST be reported as
  ineffective (warning) rather than silently honored or treated as fatal.
- **FR-009**: A preserved file that no longer exists in the new bundle MUST be kept on disk, and the
  situation surfaced so the maintainer knows the bundle dropped it.
- **FR-010**: A refresh MUST still add managed files that are new in the bundle; the preserve
  declaration governs existing files only and MUST NOT suppress legitimate additions.
- **FR-011**: For a project that declares no preserves, init and upgrade behaviour MUST be unchanged
  from today (the feature is inert by default).
- **FR-012**: Preserved files MUST remain tracked against the bundle so the divergence view and
  future refreshes can compare them as the bundle evolves.

### Key Entities _(see Domain Model section below for full structure)_

- **Project installation** — a Specflow-initialised project, identified by its installed lock; owns
  the set of managed files and the preserve declarations.
- **Managed file** — a bundled file Specflow installs and tracks by destination path; may be
  vanilla, customised, or preserved.
- **Preserve declaration** — the maintainer's stated intent that a specific managed file is theirs
  and must survive a forced refresh.

## Domain Model _(mandatory)_

**Bounded context:** Project template lifecycle (init / upgrade / preserve).

**Vocabulary (Ubiquitous language):**

- **Bundle** — the set of template files embedded in the Specflow binary for a given templates
  version.
- **Managed file** — a file Specflow installs from the bundle and tracks (by destination path) in
  the installed lock.
- **Customisation** — a managed file whose on-disk content differs from the version recorded in the
  lock (the maintainer edited it).
- **Preserve declaration** — an explicit, project-level statement that a managed file must be kept
  on disk and never overwritten by a refresh, even a forced one.
- **Forced refresh** — `specflow init --force`: a refresh that, today, overwrites every managed file
  unconditionally.
- **Divergence** — the difference between a managed file's on-disk content and its bundled original
  for the installed templates version.
- **Reset (opt-out)** — an explicit, non-default request to override preserve declarations for one
  forced refresh and restore the bundled versions.

**Entities (have identity):**

- **Project installation** [aggregate root] — identified by its installed lock; owns the
  managed-file set and the preserve declarations, and enforces the "preserved is never silently
  overwritten" invariant across init and upgrade.
- **Managed file** — identified by its destination path; its state is one of {vanilla, customised}
  and, orthogonally, {declared-preserved, not-declared}.

**Value objects (no identity, immutable):**

- **PreserveDeclaration(path)** — a maintainer's intent to protect one managed path; honored whether
  or not the file currently diverges.
- **Divergence(path, bundledContent, diskContent)** — a read-only comparison result; exists iff the
  on-disk content differs from the bundled original.
- **RefreshMode(normal | force | force-reset-preserved)** — the intent of a refresh run; only
  `force-reset-preserved` may overwrite a preserved file.

**Invariants (rules the domain must never break):**

- A file declared preserved MUST NOT be overwritten by any refresh unless the maintainer explicitly
  requests the reset opt-out for that run.
- A refresh that skips a file because it is preserved MUST surface that fact — preservation is never
  silent, symmetric to the silent overwrite this feature removes.
- A project with no preserve declarations MUST observe exactly today's init/upgrade behaviour — the
  feature adds no default-path behaviour change.
- The divergence view MUST be read-only — observing divergence MUST NOT mutate any file.

**Out of scope (other bounded contexts touched but not owned here):**

- **Merging upstream changes into a preserved file** — folding new bundle content into a customised
  file is a manual decision the maintainer makes, aided by the divergence view; this feature does
  not auto-merge.
- **Parent-managed provisioning (009-parent-managed-init)** — whether agentic files are provisioned
  at all in a workspace sub-repo is owned there; this feature only governs files that are present.
- **Plugin coverage / migration (`migrate-to-plugin`)** — which files the plugin owns is owned by
  the plugin-coverage map; this feature defers to the existing "customized → preserve" precedence.
- **Recovering already-lost customisations** — content clobbered before this feature shipped is
  recoverable from git, per the issue; this feature prevents future loss, it does not restore past
  loss.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: After a managed file is declared preserved, `specflow init --force` leaves it
  byte-identical to its pre-refresh content — zero preserved files are overwritten.
- **SC-002**: For N preserved files skipped in a refresh, exactly N clear notices are emitted, each
  naming the path; zero preserved files are skipped silently.
- **SC-003**: A maintainer can view the divergence of every customised managed file from its bundled
  original in a single read-only command that mutates zero files.
- **SC-004**: For a project with no preserve declarations, init and upgrade produce output identical
  to current behaviour — the existing init/upgrade test suite passes unchanged.
- **SC-005**: The reset opt-out restores the bundled version for preserved files only when
  explicitly invoked, and never on a default forced refresh.
- **SC-006**: The 2026-06-08 failure mode — a customised `product-owner.md` reverted to the generic
  bundle by `init --force` — does not recur once that file is declared preserved.

## Assumptions

- The **declaration mechanism** (a project-level manifest such as `.specnaut/preserve.yml`, a
  per-file frontmatter flag, or a per-file sidecar) is a design decision for the plan phase; the
  spec stays mechanism-agnostic and only requires that the declaration be project-level and
  version-controllable. The issue lists all three as candidates.
- The existing SHA-based auto-preserve in `specflow upgrade`
  (`UpgradeAction kind: "preserve"; reason:
  "customized"`) remains; this feature adds an
  **explicit, force-surviving** preserve layer on top of that implicit behaviour and unifies how
  both refresh paths treat declared files.
- The divergence view compares on-disk content against the binary's embedded bundle for the
  currently-installed templates version (the same source `upgrade` already reads), so no network or
  external fetch is required.
- Preserve declarations are committed to the project's version control alongside `.specnaut/`, so
  they travel with the repo and are reviewable.
- The feature targets the public CLI half (`apps/specflow/`) only; no private-half code, names, or
  secrets are involved.
