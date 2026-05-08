
## Checklist Purpose: "Unit Tests for English"

**CRITICAL CONCEPT**: Checklists are **UNIT TESTS FOR REQUIREMENTS WRITING** — they validate quality, clarity, and completeness of requirements. They do NOT verify implementation behavior.

- ❌ NOT "Verify the button clicks correctly" / "Test error handling works" / "Confirm API returns 200"
- ✅ "Is 'prominent display' quantified with specific sizing/positioning?" (clarity)
- ✅ "Are hover state requirements consistent across all interactive elements?" (consistency)
- ✅ "Does the spec define what happens when logo image fails to load?" (edge cases)

If your spec is code written in English, the checklist is its unit test suite — testing whether requirements are well-written and ready for implementation, NOT whether the implementation works.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check extension hooks (`hooks.before_checklist` in `.specflow/extensions.yml`)**:
Skip silently if the file is absent or unparseable. For each enabled entry
(treat missing `enabled` as `true`) without a non-empty `condition`, emit:

- `optional: true` → `## Extension Hooks` block with `**Optional Pre-Hook**: {extension}`,
  command, description, and prompt.
- `optional: false` → `## Extension Hooks` block with `**Automatic Pre-Hook**: {extension}`,
  `EXECUTE_COMMAND: {command}`, and wait for the result before proceeding.

Hooks with non-empty `condition` are deferred to the HookExecutor.

## Execution Steps

1. **Setup**: Run `{SCRIPT}` from repo root and parse JSON for FEATURE_DIR and AVAILABLE_DOCS list.
   - All file paths must be absolute.
   - For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. **Clarify intent (dynamic)**: Derive up to THREE contextual clarifying questions (no pre-baked catalog). Questions MUST be generated from the user's phrasing + signals extracted from spec/plan/tasks; skip any already answered in `$ARGUMENTS`; cover only information that materially changes checklist content.

   Archetypes: scope refinement, risk prioritization, depth calibration (lightweight sanity vs. formal release gate), audience framing (author vs. PR reviewer), boundary exclusion, scenario class gaps (recovery/rollback in scope?). Present options as a compact table (Option | Candidate | Why It Matters), max A–E; use free-form if clearer. Never ask the user to restate what they said.

   Defaults when interaction impossible: Depth=Standard; Audience=Reviewer(PR) for code, Author otherwise; Focus=top 2 relevance clusters.

   Label Q1/Q2/Q3. After answers, if ≥2 scenario classes (Alternate/Exception/Recovery/NFR) remain unclear, ask up to TWO follow-ups Q4/Q5 with one-line justification each. Max five questions total; skip escalation if user declines.

3. **Understand user request**: Combine `$ARGUMENTS` + clarifying answers:
   - Derive checklist theme (e.g., security, review, deploy, ux)
   - Consolidate explicit must-have items mentioned by user
   - Map focus selections to category scaffolding
   - Infer any missing context from spec/plan/tasks (do NOT hallucinate)

4. **Load feature context**: Read from FEATURE_DIR:
   - spec.md: Feature requirements and scope
   - plan.md (if exists): Technical details, dependencies
   - tasks.md (if exists): Implementation tasks

   **Context Loading Strategy**:
   - Load only necessary portions relevant to active focus areas (avoid full-file dumping)
   - Prefer summarizing long sections into concise scenario/requirement bullets
   - Use progressive disclosure: add follow-on retrieval only if gaps detected
   - If source docs are large, generate interim summary items instead of embedding raw text

5. **Generate checklist** - Create "Unit Tests for Requirements":
   - Create `FEATURE_DIR/checklists/` directory if it doesn't exist
   - Generate unique checklist filename using short, descriptive domain name (e.g., `ux.md`, `api.md`, `security.md`)
   - File handling: if file does NOT exist create new and number from CHK001; if file exists append continuing from last CHK ID. Never delete or replace existing content.

   **CORE PRINCIPLE - Test the Requirements, Not the Implementation**:
   Every checklist item MUST evaluate the REQUIREMENTS THEMSELVES for:
   - **Completeness**: Are all necessary requirements present?
   - **Clarity**: Are requirements unambiguous and specific?
   - **Consistency**: Do requirements align with each other?
   - **Measurability**: Can requirements be objectively verified?
   - **Coverage**: Are all scenarios/edge cases addressed?

   **Category Structure** - Group items by requirement quality dimensions:
   - **Requirement Completeness**, **Requirement Clarity**, **Requirement Consistency**
   - **Acceptance Criteria Quality**, **Scenario Coverage**, **Edge Case Coverage**
   - **Non-Functional Requirements** (Performance, Security, Accessibility)
   - **Dependencies & Assumptions**, **Ambiguities & Conflicts**

   **ITEM STRUCTURE**: Question format testing requirement quality. Include quality dimension in brackets. Reference `[Spec §X.Y]` for existing requirements; use `[Gap]` for missing ones. MINIMUM ≥80% of items MUST carry a traceability marker: `[Spec §X.Y]`, `[Gap]`, `[Ambiguity]`, `[Conflict]`, or `[Assumption]`.

   Examples by dimension:
   - Completeness: `"Are error handling requirements defined for all API failure modes? [Gap]"`
   - Clarity: `"Is 'fast loading' quantified with specific thresholds? [Clarity, Spec §NFR-2]"`
   - Consistency: `"Do navigation requirements align across all pages? [Consistency, Spec §FR-10]"`
   - Coverage: `"Are requirements defined for zero-state scenarios? [Coverage, Edge Case]"`
   - Measurability: `"Can 'balanced visual weight' be objectively verified? [Measurability, Spec §FR-2]"`

   **Scenario Classification**: Confirm requirements exist for Primary, Alternate, Exception/Error, Recovery, and Non-Functional scenarios. For any missing class: "Are [scenario type] requirements intentionally excluded? [Gap]". Include rollback requirements when state mutation occurs.

   **Content Consolidation**: Soft cap 40 items — prioritize by risk/impact, merge near-duplicates, collapse >5 low-impact edge cases into one item.

   **🚫 PROHIBITED**: Items starting with "Verify/Test/Confirm/Check" + behavior; references to code execution or user actions; "displays correctly", "works properly", implementation details.

   **✅ REQUIRED**: "Are [X] defined/specified for [scenario]?" · "Is [vague term] quantified?" · "Are requirements consistent between [A] and [B]?" · "Can [requirement] be objectively measured?"

6. **Structure Reference**: Generate the checklist following the canonical template in `templates/checklist-template.md` for title, meta section, category headings, and ID formatting. If template is unavailable, use: H1 title, purpose/created meta lines, `##` category sections containing `- [ ] CHK### <requirement item>` lines with globally incrementing IDs starting at CHK001.

7. **Report**: Output full path to checklist file, item count, and summarize whether the run created a new file or appended to an existing one. Summarize focus areas selected, depth level, actor/timing, and any explicit user-specified must-have items incorporated.

**Important**: Each `/specflow checklist` command invocation uses a short, descriptive checklist filename and either creates a new file or appends to an existing one — allowing multiple checklists of different types (e.g., `ux.md`, `test.md`, `security.md`). Use descriptive types and clean up obsolete checklists when done.

## Example Checklist Types & Sample Items

**UX Requirements Quality:** `ux.md`
- "Are visual hierarchy requirements defined with measurable criteria? [Clarity, Spec §FR-1]"
- "Are interaction state requirements (hover, focus, active) consistently defined? [Consistency]"
- "Are accessibility requirements specified for all interactive elements? [Coverage, Gap]"
- "Is fallback behavior defined when images fail to load? [Edge Case, Gap]"

**API Requirements Quality:** `api.md`
- "Are error response formats specified for all failure scenarios? [Completeness]"
- "Are rate limiting requirements quantified with specific thresholds? [Clarity]"
- "Are retry/timeout requirements defined for external dependencies? [Coverage, Gap]"

**Performance Requirements Quality:** `performance.md`
- "Are performance requirements quantified with specific metrics? [Clarity]"
- "Are performance targets defined for all critical user journeys? [Coverage]"
- "Are degradation requirements defined for high-load scenarios? [Edge Case, Gap]"

**Security Requirements Quality:** `security.md`
- "Are authentication requirements specified for all protected resources? [Coverage]"
- "Is the threat model documented and requirements aligned to it? [Traceability]"
- "Are security failure/breach response requirements defined? [Gap, Exception Flow]"

## Anti-Examples: What NOT To Do

**❌ WRONG - These test implementation, not requirements:**

```markdown
- [ ] CHK001 - Verify landing page displays 3 episode cards [Spec §FR-001]
- [ ] CHK002 - Test hover states work correctly on desktop [Spec §FR-003]
- [ ] CHK003 - Confirm logo click navigates to home page [Spec §FR-010]
```

**✅ CORRECT - These test requirements quality:**

```markdown
- [ ] CHK001 - Are the number and layout of featured episodes explicitly specified? [Completeness, Spec §FR-001]
- [ ] CHK002 - Are hover state requirements consistently defined for all interactive elements? [Consistency, Spec §FR-003]
- [ ] CHK003 - Are navigation requirements clear for all clickable brand elements? [Clarity, Spec §FR-010]
- [ ] CHK004 - Is the selection criteria for related episodes documented? [Gap, Spec §FR-005]
- [ ] CHK005 - Can "visual hierarchy" requirements be objectively measured? [Measurability, Spec §FR-001]
```

Key differences: Wrong tests if the system *works*; Correct tests if requirements are *written correctly*. Wrong: "Does it do X?" — Correct: "Is X clearly specified?"

## Post-Execution Checks

**Check extension hooks (`hooks.after_checklist` in `.specflow/extensions.yml`)**:
Skip silently if the file is absent or unparseable. For each enabled entry
(treat missing `enabled` as `true`) without a non-empty `condition`, emit:

- `optional: true` → `## Extension Hooks` block with `**Optional Hook**: {extension}`,
  command, description, and prompt.
- `optional: false` → `## Extension Hooks` block with `**Automatic Hook**: {extension}`,
  `EXECUTE_COMMAND: {command}`.

Hooks with non-empty `condition` are deferred to the HookExecutor.
