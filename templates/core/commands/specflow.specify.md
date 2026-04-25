---
description: Create or update the feature specification from a natural language feature description.
handoffs: 
  - label: Build Technical Plan
    agent: specflow.plan
    prompt: Create a plan for the spec. I am building with...
  - label: Clarify Spec Requirements
    agent: specflow.clarify
    prompt: Clarify specification requirements
    send: true
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check extension hooks (`hooks.before_specify` in `.specflow/extensions.yml`)**:
Skip silently if the file is absent or unparseable. For each enabled entry
(treat missing `enabled` as `true`) without a non-empty `condition`, emit:

- `optional: true` → `## Extension Hooks` block with `**Optional Pre-Hook**: {extension}`,
  command, description, and prompt.
- `optional: false` → `## Extension Hooks` block with `**Automatic Pre-Hook**: {extension}`,
  `EXECUTE_COMMAND: {command}`, and wait for the result before proceeding.

Hooks with non-empty `condition` are deferred to the HookExecutor.

## Outline

The text the user typed after `__SPECKIT_COMMAND_SPECIFY__` is the feature description. Do not ask the user to repeat it unless they provided an empty command.

Given that feature description, do this:

1. **Generate a concise short name** (2-4 words) for the feature:
   - Use action-noun format when possible (e.g., "add-user-auth", "fix-payment-bug")
   - Preserve technical terms and acronyms (OAuth2, API, JWT, etc.)

2. **Branch creation** (optional, via hook):

   If a `before_specify` hook ran, it will have created/switched to a git branch and output JSON with `BRANCH_NAME` and `FEATURE_NUM`. Note these for reference; the branch name does **not** dictate the spec directory name.

   If the user explicitly provided `GIT_BRANCH_NAME`, pass it to the hook so it uses that exact value.

3. **Create the spec feature directory**:

   Specs live under `specs/` unless the user provides `SPECIFY_FEATURE_DIRECTORY`.

   **Resolution order for `SPECIFY_FEATURE_DIRECTORY`**:
   1. If the user explicitly provided it, use as-is.
   2. Otherwise auto-generate under `specs/`:
      - Check `.specflow/init-options.json` for `branch_numbering`
      - `"timestamp"`: prefix is `YYYYMMDD-HHMMSS`
      - `"sequential"` or absent: prefix is `NNN` (next available 3-digit number)
      - Construct: `<prefix>-<short-name>` (e.g., `003-user-auth`)
      - Set `SPECIFY_FEATURE_DIRECTORY` to `specs/<directory-name>`

   **Create the directory and spec file**:
   - `mkdir -p SPECIFY_FEATURE_DIRECTORY`
   - Copy `templates/spec-template.md` to `SPECIFY_FEATURE_DIRECTORY/spec.md`
   - Set `SPEC_FILE` to `SPECIFY_FEATURE_DIRECTORY/spec.md`
   - Persist to `.specflow/feature.json`:
     ```json
     { "feature_directory": "<resolved feature dir>" }
     ```
     Write the actual resolved path (e.g., `specs/003-user-auth`), not the literal string.
     This lets downstream commands (`__SPECKIT_COMMAND_PLAN__`, `__SPECKIT_COMMAND_TASKS__`, etc.) locate the feature directory.

   **IMPORTANT**:
   - Create only one feature per `__SPECKIT_COMMAND_SPECIFY__` invocation.
   - The spec directory name and git branch name are independent.
   - The spec directory and file are always created by this command, never by the hook.

4. Load `templates/spec-template.md` to understand required sections.

5. Follow this execution flow:
    1. Parse user description; if empty: ERROR "No feature description provided"
    2. Extract key concepts: actors, actions, data, constraints
    3. For unclear aspects, make informed guesses. Mark with `[NEEDS CLARIFICATION: question]` only when the choice significantly impacts scope/UX and no reasonable default exists. **Maximum 3 markers total.**
    4. Fill User Scenarios & Testing; if no clear user flow: ERROR "Cannot determine user scenarios"
    5. Generate Functional Requirements — each must be testable
    6. Define Success Criteria — measurable, technology-agnostic, verifiable
    7. Identify Key Entities (if data involved)
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
      Items marked incomplete require spec updates before `__SPECKIT_COMMAND_CLARIFY__` or `__SPECKIT_COMMAND_PLAN__`
      ```

   b. **Run Validation**: Review spec against each checklist item; document specific failures.

   c. **Handle Results**:

      - **All pass**: Mark checklist complete and proceed to step 8.

      - **Items fail** (excluding [NEEDS CLARIFICATION]):
        1. List failing items and issues; update spec; re-run (max 3 iterations).
        2. After 3 iterations, document remaining issues and warn user.

      - **[NEEDS CLARIFICATION] markers remain**:
        1. Keep only the 3 most critical; make informed guesses for the rest.
        2. For each (max 3), present to user:

           ```markdown
           ## Question [N]: [Topic]

           **Context**: [Quote relevant spec section]
           **What we need to know**: [Specific question]

           **Suggested Answers**:

           | Option | Answer | Implications |
           |--------|--------|--------------|
           | A      | [First answer] | [Implications] |
           | B      | [Second answer] | [Implications] |
           | Custom | Provide your own | — |

           **Your choice**: _[Wait for user response]_
           ```

        3. Number questions Q1–Q3; present all before waiting for responses.
        4. Update spec with user's answers; re-run validation.

   d. **Update Checklist** after each validation iteration.

8. **Report completion** with:
   - `SPECIFY_FEATURE_DIRECTORY` and `SPEC_FILE`
   - Checklist results summary
   - Readiness for next phase (`__SPECKIT_COMMAND_CLARIFY__` or `__SPECKIT_COMMAND_PLAN__`)

9. **Check extension hooks (`hooks.after_specify` in `.specflow/extensions.yml`)**:
   Same rules as Pre-Execution Checks. For each executable hook emit:

   - `optional: true` → `## Extension Hooks` block with `**Optional Hook**: {extension}`, command, description, prompt.
   - `optional: false` → `## Extension Hooks` block with `**Automatic Hook**: {extension}`, `EXECUTE_COMMAND: {command}`.

**NOTE:** Branch creation is handled by the `before_specify` hook. Spec directory and file creation are always handled by this core command.

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
