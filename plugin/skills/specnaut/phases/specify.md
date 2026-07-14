
## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check extension hooks (`hooks.before_specify` in `.specnaut/extensions.yml`)**:
Skip silently if the file is absent or unparseable. For each enabled entry
(treat missing `enabled` as `true`) without a non-empty `condition`, emit:

- `optional: true` → `## Extension Hooks` block with `**Optional Pre-Hook**: {extension}`,
  command, description, and prompt.
- `optional: false` → `## Extension Hooks` block with `**Automatic Pre-Hook**: {extension}`,
  `EXECUTE_COMMAND: {command}`, and wait for the result before proceeding.

Hooks with non-empty `condition` are deferred to the HookExecutor.

## Chain shape selection

Before running the outline below, determine the **chain shape** that
will apply to this `/specnaut specify` invocation (and the rest of
the chain after it):

1. **Read `CHAIN_SHAPE` from the router context** (set by `SKILL.md`
   step 1 chain-shape parsing).
   - `CHAIN_SHAPE == lite` → use lite, no prompt. Skip step 2.
   - `CHAIN_SHAPE == full` → use full, no prompt. Skip step 2.
   - `CHAIN_SHAPE == auto` → proceed to step 2.

2. **Apply the lite heuristic.** Read `phases/lite-heuristic.md`,
   score the feature brief (the original user input from
   `/specnaut specify`, before flag stripping is irrelevant — use the
   substantive brief), and:
   - If `score < 2`: silently set `CHAIN_SHAPE = full`. No prompt.
   - If `score ≥ 2`: emit the prompt from `phases/lite-heuristic.md`
     ("This brief looks small — run the lite chain? [Y/n]") **exactly
     once**, wait for the user's answer:
     - `Y` / `yes` / empty (default-Y if you treated the prompt as a
       Y/n with capital Y) → `CHAIN_SHAPE = lite`.
     - `n` / `no` / anything else interpreted as no → `CHAIN_SHAPE =
       full`.

3. **Persist the chosen shape** to `.specnaut/feature.json` (when
   step 3 of the Outline below writes that file, include
   `"workflow_shape": "lite"` or `"workflow_shape": "full"` alongside
   `feature_directory` and `linked_issue`).

4. **Log line on phase transition** (used by the chain when invoking
   the next phase): emit `✓ specify (lite) complete — proceeding to
   plan` when `CHAIN_SHAPE == lite`, or the unchanged `✓ specify
   complete — proceeding to clarify` when `CHAIN_SHAPE == full`.
   `phases/auto-chain.md` reads `workflow_shape` from `feature.json`
   to decide which phase to chain to next.

## Outline

The text the user typed after `/specnaut specify` is the feature description. Do not ask the user to repeat it unless they provided an empty command.

Given that feature description, do this:

1. **Generate a concise short name** (2-4 words) for the feature:
   - Use action-noun format when possible (e.g., "add-user-auth", "fix-payment-bug")
   - Preserve technical terms and acronyms (OAuth2, API, JWT, etc.)

<!-- BEGIN: spec-backend=local -->
2. **Branch creation** (optional, via hook):

   If a `before_specify` hook ran, it will have created/switched to a git branch and output JSON with `BRANCH_NAME` and `FEATURE_NUM`. Note these for reference; the branch name does **not** dictate the spec directory name.

   If the user explicitly provided `GIT_BRANCH_NAME`, pass it to the hook so it uses that exact value.

3. **Create the spec feature directory**:

   Specs live under `.specnaut/specs/` unless the user provides `SPECIFY_FEATURE_DIRECTORY`.

   **Resolution order for `SPECIFY_FEATURE_DIRECTORY`**:
   1. If the user explicitly provided it, use as-is.
   2. Otherwise auto-generate under `.specnaut/specs/`:
      - Check `.specnaut/init-options.json` for `branch_numbering`
      - `"timestamp"`: prefix is `YYYYMMDD-HHMMSS`
      - `"sequential"` or absent: prefix is `NNN` (next available 3-digit number)
      - Construct: `<prefix>-<short-name>` (e.g., `003-user-auth`)
      - Set `SPECIFY_FEATURE_DIRECTORY` to `.specnaut/specs/<directory-name>`

   **Create the directory and spec file**:
   - `mkdir -p SPECIFY_FEATURE_DIRECTORY`
   - Copy `templates/spec-template.md` to `SPECIFY_FEATURE_DIRECTORY/spec.md`
   - Set `SPEC_FILE` to `SPECIFY_FEATURE_DIRECTORY/spec.md`
   - Persist to `.specnaut/feature.json`:
     ```json
     { "feature_directory": "<resolved feature dir>", "linked_issue": <N or null>, "workflow_shape": "<lite|full>" }
     ```
     Write the actual resolved path (e.g., `.specnaut/specs/003-user-auth`), not the literal string.
     This lets downstream commands (`/specnaut plan`, `/specnaut tasks`, etc.) locate the feature directory.

     **`linked_issue`**: when the user invokes `/specnaut specify` with `--issue <id>` (or the
     hook's JSON output includes a non-null `LINKED_ISSUE`), persist it as a JSON integer here.
     Otherwise persist `null`. The merge phase reads this field to auto-close the linked
     backlog item on the project board after a successful fast-forward + push. Backward-compat
     with existing `feature.json` files: absent or null is a no-op everywhere downstream.

     **`workflow_shape`**: the chain shape chosen during "Chain shape selection" above —
     `"lite"` or `"full"`. `phases/auto-chain.md` reads this field at every chain transition
     to decide which phase comes next (lite skips `clarify` and `tasks`). Backward-compat
     with existing `feature.json` files: absent → treat as `"full"` everywhere downstream.

   **IMPORTANT**:
   - Create only one feature per `/specnaut specify` invocation.
   - The spec directory name and git branch name are independent.
   - The spec directory and file are always created by this command, never by the hook.
<!-- END: spec-backend=local -->
<!-- BEGIN: spec-backend=cloud -->
2. **Cloud spec authoring** (spec backend = cloud — NO git branch, NO local files):

   This project stores specifications on SpecNaut Cloud, not in `.specnaut/specs/`.
   Do **NOT** create a git branch and do **NOT** write any `.specnaut/specs/<n>/`
   files. The branch is created later, at `/specnaut implement`. The spec is
   authored directly to the linked backlog task and read back on demand with
   `specnaut spec pull <task>`.

3. **Resolve the linked task and author the spec to Cloud**:

   1. Determine the task number:
      - If the user passed `--issue <N>`, use it.
      - Otherwise `specnaut spec push` auto-creates a backlog task named from the
        feature and links it — the task and its spec are created together (no
        manual pre-step).
   2. Generate the spec body using `templates/spec-template.md` for structure,
      exactly as you would locally (same sections, same mandatory Domain Model
      block).
   3. Write the generated spec to the gitignored cache as the `specify` step:
      `.specnaut/specs/.cache/<task>/1-specify.md`, then push it:
      `specnaut spec push <task>` (upsert-only; it never deletes other tabs).
   4. Persist the resolved task number to `.specnaut/feature.json`
      (`{ "linked_issue": <N>, "workflow_shape": "<lite|full>" }`) so downstream
      phases locate the spec. No `feature_directory` is written in cloud mode.

   **Parallel authoring (cloud):** because cloud `specify` creates NO git branch and writes
   NO shared `.specnaut/specs/` state, several task specs can be authored concurrently — drive
   one `specify` per task in parallel (a user, or an agent fleet) with no git-branch collision
   and no shared-state clash. Each spec is pushed to its own task independently (last write
   wins per task, Lot 1 upsert).
<!-- END: spec-backend=cloud -->

4. Load `templates/spec-template.md` to understand required sections.

5. Follow this execution flow:
    1. Parse user description; if empty: ERROR "No feature description provided"
    2. Extract key concepts: actors, actions, data, constraints
    3. For unclear aspects, make informed guesses. Mark with `[NEEDS CLARIFICATION: question]` only when the choice significantly impacts scope/UX and no reasonable default exists. **Maximum 3 markers total.**
    4. Fill User Scenarios & Testing; if no clear user flow: ERROR "Cannot determine user scenarios"
    5. Generate Functional Requirements — each must be testable
    6. Define Success Criteria — measurable, technology-agnostic, verifiable
    7. **Populate the `## Domain Model` block (mandatory)** — Bounded context, Vocabulary (Ubiquitous language), Entities (have identity), Value objects, Invariants, Out of scope. Use `[NEEDS CLARIFICATION: <question>]` markers for fields the input does not let you fill — `/specnaut clarify` resolves them. The developer refuses to proceed if this block is absent or contains unresolved placeholders.
    8. Return: SUCCESS (spec ready for planning)

6. Write the specification to `SPEC_FILE` using the template structure, replacing placeholders with concrete details while preserving section order and headings.

7. **Specification Quality Validation**: After writing the spec, validate it:

   a. **Create Spec Quality Checklist** at `SPECIFY_FEATURE_DIRECTORY/checklists/requirements.md`:

      ```markdown
      # Specification Quality Checklist: [FEATURE NAME]

      **Purpose**: Validate specification completeness before planning
      **Created**: [DATE]
      **Feature**: [Link to spec.md]

      ## Content Quality
      - [ ] No implementation details (languages, frameworks, APIs)
      - [ ] Focused on user value and business needs
      - [ ] All mandatory sections completed

      ## Requirement Completeness
      - [ ] No [NEEDS CLARIFICATION] markers remain
      - [ ] Requirements are testable and unambiguous
      - [ ] Success criteria are measurable and technology-agnostic
      - [ ] All acceptance scenarios defined; edge cases identified
      - [ ] Scope clearly bounded; dependencies and assumptions identified

      ## Feature Readiness
      - [ ] All functional requirements have acceptance criteria
      - [ ] User scenarios cover primary flows
      - [ ] No implementation details in specification

      ## Notes
      Items marked incomplete require spec updates before `/specnaut clarify` or `/specnaut plan`
      ```

   b. **Run Validation**: Review spec against each checklist item; document specific failures.

   c. **Handle Results**:

      - **All pass**: Mark checklist complete and proceed to step 8.

      - **Items fail** (excluding [NEEDS CLARIFICATION]):
        1. List failing items and issues; update spec; re-run (max 3 iterations).
        2. After 3 iterations, document remaining issues and warn user.

      - **[NEEDS CLARIFICATION] markers remain**: keep ≤3 most critical,
        document informed-guess defaults in Assumptions, leave the
        surviving markers verbatim for `/specnaut clarify` to resolve.
        **Do NOT prompt inline.** In `lite` shape, markers become
        Assumptions and the chain continues.

   d. **Update Checklist** after each validation iteration.

8. **Report completion and proceed (no permission ask)**:
   - Report `SPECIFY_FEATURE_DIRECTORY`, `SPEC_FILE`, and checklist
     summary in one short block.
   - Chain unconditionally to the next phase: `full` → `/specnaut clarify`,
     `lite` → `/specnaut plan`. Pause only on `--manual` or `--once`.
     Transition wording is a statement (`✓ specify complete — proceeding
     to <next>`), never a question.

9. **Check extension hooks (`hooks.after_specify` in `.specnaut/extensions.yml`)**:
   Same rules as Pre-Execution Checks. For each executable hook emit:

   - `optional: true` → `## Extension Hooks` block with `**Optional Hook**: {extension}`, command, description, prompt.
   - `optional: false` → `## Extension Hooks` block with `**Automatic Hook**: {extension}`, `EXECUTE_COMMAND: {command}`.

<!-- BEGIN: spec-backend=local -->
**NOTE:** Branch creation is handled by the `before_specify` hook. Spec directory and file creation are always handled by this core command.
<!-- END: spec-backend=local -->
<!-- BEGIN: spec-backend=cloud -->
**NOTE:** In cloud spec mode no git branch and no `.specnaut/specs/` files are created here — the spec is pushed to SpecNaut Cloud and the branch is created later at `/specnaut implement`.
<!-- END: spec-backend=cloud -->

## Quick Guidelines

- Focus on **WHAT** users need and **WHY**. Avoid HOW (no tech stack, APIs, code structure).
- Written for business stakeholders, not developers.
- Do NOT embed checklists in the spec itself — that is a separate command.

### Section Requirements

- **Mandatory sections**: complete for every feature.
- **Optional sections**: include only when relevant; remove inapplicable sections entirely (don't leave "N/A").

### For AI Generation

1. **Make informed guesses** using context, industry standards, and common patterns.
2. **Document assumptions** in the Assumptions section.
3. **Limit clarifications**: max 3 `[NEEDS CLARIFICATION]` markers — only for critical decisions with no reasonable default.
4. **Prioritize**: scope > security/privacy > user experience > technical details.
5. **Think like a tester**: vague requirements should fail the "testable and unambiguous" check.

**Reasonable defaults** (don't ask about these): data retention, performance targets, error handling, authentication method, integration patterns.

### Success Criteria Guidelines

Success criteria must be **measurable** (specific metrics), **technology-agnostic** (no frameworks/databases), **user-focused** (outcomes from user/business perspective), and **verifiable** without implementation knowledge.

**Good**: "Users can complete checkout in under 3 minutes" · "System supports 10,000 concurrent users" · "95% of searches return results in under 1 second"

**Bad**: "API response time under 200ms" (too technical) · "Database handles 1000 TPS" (implementation detail) · "React components render efficiently" (framework-specific)
