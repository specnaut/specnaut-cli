
## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check extension hooks (`hooks.before_clarify` in `.specflow/extensions.yml`)**:
Skip silently if the file is absent or unparseable. For each enabled entry
(treat missing `enabled` as `true`) without a non-empty `condition`, emit:

- `optional: true` → `## Extension Hooks` block with `**Optional Pre-Hook**: {extension}`,
  command, description, and prompt.
- `optional: false` → `## Extension Hooks` block with `**Automatic Pre-Hook**: {extension}`,
  `EXECUTE_COMMAND: {command}`, and wait for the result before proceeding.

Hooks with non-empty `condition` are deferred to the HookExecutor.

## Outline

Goal: Detect and reduce ambiguity or missing decision points in the active feature specification and record the clarifications directly in the spec file.

Note: This clarification workflow is expected to run (and be completed) BEFORE invoking `/specflow plan`. If the user explicitly states they are skipping clarification (e.g., exploratory spike), you may proceed, but must warn that downstream rework risk increases.

Execution steps:

1. Run `{SCRIPT}` from repo root **once** (combined `--json --paths-only` mode / `-Json -PathsOnly`). Parse minimal JSON payload fields:
   - `FEATURE_DIR`
   - `FEATURE_SPEC`
   - (Optionally capture `IMPL_PLAN`, `TASKS` for future chained flows.)
   - If JSON parsing fails, abort and instruct user to re-run `/specflow specify` or verify feature branch environment.
   - For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. Load the current spec file. Perform a structured ambiguity & coverage scan. For each category mark status: Clear / Partial / Missing (internal map only; do not output unless no questions will be asked).

   Taxonomy categories:
   - Functional Scope & Behavior (goals, out-of-scope, roles)
   - Domain & Data Model (entities, identity, lifecycle, scale)
   - Interaction & UX Flow (journeys, error/empty states, a11y)
   - Non-Functional Quality Attributes (perf, scalability, reliability, observability, security, compliance)
   - Integration & External Dependencies (APIs, formats, versioning)
   - Edge Cases & Failure Handling (negatives, rate-limiting, conflicts)
   - Constraints & Tradeoffs (technical constraints, rejected alternatives)
   - Terminology & Consistency (canonical terms, avoided synonyms)
   - Completion Signals (testable AC, measurable DoD indicators)
   - Misc / Placeholders (TODOs, vague adjectives lacking quantification)

   For each Partial or Missing category, add a candidate question unless clarification would not materially change implementation or is better deferred to planning.

3. Generate (internally) a prioritized queue of candidate clarification questions (maximum 5). Do NOT output them all at once. Apply these constraints:
    - Maximum of 5 total questions across the whole session.
    - Each question must be answerable with EITHER:
       - A short multiple‑choice selection (2–5 distinct, mutually exclusive options), OR
       - A one-word / short‑phrase answer (explicitly constrain: "Answer in <=5 words").
    - Only include questions whose answers materially impact architecture, data modeling, task decomposition, test design, UX behavior, operational readiness, or compliance validation.
    - Ensure category coverage balance: attempt to cover the highest impact unresolved categories first; avoid asking two low-impact questions when a single high-impact area (e.g., security posture) is unresolved.
    - Exclude questions already answered, trivial stylistic preferences, or plan-level execution details (unless blocking correctness).
    - Favor clarifications that reduce downstream rework risk or prevent misaligned acceptance tests.
    - If more than 5 categories remain unresolved, select the top 5 by (Impact * Uncertainty) heuristic.

4. Sequential questioning loop (interactive):
    - Present EXACTLY ONE question at a time.
    - For multiple‑choice questions:
       - **Analyze all options** and determine the **most suitable option** based on best practices, common patterns, risk reduction, and alignment with project goals.
       - Present your **recommended option prominently** at the top: `**Recommended:** Option [X] - <reasoning>`
       - Render all options as a Markdown table:

       | Option | Description |
       |--------|-------------|
       | A | <Option A description> |
       | B | <Option B description> |
       | C | <Option C description> (add D/E as needed up to 5) |
       | Short | Provide a different short answer (<=5 words) (Include only if free-form alternative is appropriate) |

       - After the table, add: `You can reply with the option letter (e.g., "A"), accept the recommendation by saying "yes" or "recommended", or provide your own short answer.`
    - For short‑answer style (no meaningful discrete options):
       - Provide your **suggested answer** based on best practices and context.
       - Format as: `**Suggested:** <your proposed answer> - <brief reasoning>`
       - Then output: `Format: Short answer (<=5 words). You can accept the suggestion by saying "yes" or "suggested", or provide your own answer.`
    - After the user answers:
       - If the user replies with "yes", "recommended", or "suggested", use your previously stated recommendation/suggestion as the answer.
       - Otherwise, validate the answer maps to one option or fits the <=5 word constraint.
       - If ambiguous, ask for a quick disambiguation (count still belongs to same question; do not advance).
       - Once satisfactory, record it in working memory (do not yet write to disk) and move to the next queued question.
    - Stop asking further questions when:
       - All critical ambiguities resolved early (remaining queued items become unnecessary), OR
       - User signals completion ("done", "good", "no more"), OR
       - You reach 5 asked questions.
    - Never reveal future queued questions in advance.
    - If no valid questions exist at start, immediately report no critical ambiguities.

5. Integration after EACH accepted answer (incremental update approach):
    - Maintain in-memory representation of the spec (loaded once at start) plus the raw file contents.
    - For the first integrated answer in this session:
       - Ensure a `## Clarifications` section exists (create it just after the highest-level contextual/overview section per the spec template if missing).
       - Under it, create (if not present) a `### Session YYYY-MM-DD` subheading for today.
    - Append a bullet line immediately after acceptance: `- Q: <question> → A: <final answer>`.
    - Then immediately apply the clarification to the most appropriate section(s):
       - Functional ambiguity → Update or add a bullet in Functional Requirements.
       - User interaction / actor distinction → Update User Stories or Actors subsection (if present).
       - Data shape / entities → Update Data Model (add fields, types, relationships) preserving ordering.
       - Non-functional constraint → Add/modify measurable criteria in Success Criteria > Measurable Outcomes.
       - Edge case / negative flow → Add a new bullet under Edge Cases / Error Handling (or create subsection if missing).
       - Terminology conflict → Normalize term across spec; retain original only if necessary by adding `(formerly referred to as "X")` once.
    - If the clarification invalidates an earlier ambiguous statement, replace that statement instead of duplicating; leave no obsolete contradictory text.
    - Save the spec file AFTER each integration to minimize risk of context loss (atomic overwrite).
    - Preserve formatting: do not reorder unrelated sections; keep heading hierarchy intact.
    - Keep each inserted clarification minimal and testable (avoid narrative drift).

6. Validation (performed after EACH write plus final pass):
   - Clarifications session contains exactly one bullet per accepted answer (no duplicates).
   - Total asked (accepted) questions ≤ 5.
   - Updated sections contain no lingering vague placeholders the new answer was meant to resolve.
   - No contradictory earlier statement remains.
   - Markdown structure valid; only allowed new headings: `## Clarifications`, `### Session YYYY-MM-DD`.
   - Terminology consistency: same canonical term used across all updated sections.
   - **Domain Model exit gate (NON-NEGOTIABLE)**: the spec's `## Domain Model` section MUST be fully populated — Bounded context, Vocabulary, Entities, Value objects, Invariants, and Out of scope all filled, with no `[NEEDS CLARIFICATION]` markers and no template placeholders remaining. If unfilled fields remain at the end of the clarify session, do not advance — surface them as Outstanding and recommend running `/specflow clarify` again. The downstream `/specflow implement` step will refuse to proceed without this section.

7. Write the updated spec back to `FEATURE_SPEC`.

8. Report completion (after questioning loop ends or early termination):
   - Number of questions asked & answered.
   - Path to updated spec.
   - Sections touched (list names).
   - Coverage summary table: each taxonomy category with Status: Resolved / Deferred / Clear / Outstanding.
   - If any Outstanding or Deferred remain, recommend whether to proceed to `/specflow plan` or run `/specflow clarify` again.
   - Suggested next command.

Behavior rules:

- If no meaningful ambiguities found, respond: "No critical ambiguities detected worth formal clarification." and suggest proceeding.
- If spec file missing, instruct user to run `/specflow specify` first (do not create a new spec here).
- Never exceed 5 total asked questions (clarification retries for a single question do not count as new questions).
- Avoid speculative tech stack questions unless the absence blocks functional clarity.
- Respect user early termination signals ("stop", "done", "proceed").
- If no questions asked due to full coverage, output a compact coverage summary (all categories Clear) then suggest advancing.
- If quota reached with unresolved high-impact categories remaining, explicitly flag them under Deferred with rationale.

Context for prioritization: {ARGS}

## Post-Execution Checks

**Check extension hooks (`hooks.after_clarify` in `.specflow/extensions.yml`)**:
Skip silently if the file is absent or unparseable. For each enabled entry
(treat missing `enabled` as `true`) without a non-empty `condition`, emit:

- `optional: true` → `## Extension Hooks` block with `**Optional Hook**: {extension}`,
  command, description, and prompt.
- `optional: false` → `## Extension Hooks` block with `**Automatic Hook**: {extension}`,
  `EXECUTE_COMMAND: {command}`.

Hooks with non-empty `condition` are deferred to the HookExecutor.
