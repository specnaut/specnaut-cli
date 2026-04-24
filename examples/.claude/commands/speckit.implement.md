---
description: Execute the implementation plan with a coordinated agent team — developer, reviewers, and QA tester working together.
handoffs:
  - label: Run Quality Review
    agent: speckit.review
    prompt: Run all quality checks on the implemented feature
    send: true
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

---

## Overview — Agent Team Orchestration

This command deploys a **coordinated agent team** to implement, review, and test
a feature. The lead (you) orchestrates the workflow:

```
┌─────────────────────────────────────────────────────────┐
│                    TEAM LEAD (you)                       │
│         Setup → Coordinate → Fix → Report               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Phase 0: PO BRIEF ──────────────── @product-owner      │
│     └─ Business context, rules, acceptance criteria     │
│                                                         │
│  Phase 1: SETUP ──────────────────── Lead reads specs   │
│                                                         │
│  Phase 2: IMPLEMENT ─────────────── @developer agent    │
│     └─ Executes tasks phase by phase                    │
│                                                         │
│  Phase 3: REVIEW GATE ───────────── @review-coordinator │
│     ├─ @code-reviewer     (parallel)                    │
│     ├─ @security-auditor  (parallel)                    │
│     ├─ @test-reviewer     (parallel)                    │
│     └─ @performance-analyst (parallel)                  │
│                                                         │
│  Phase 4: FIX ───────────────────── @developer agent    │
│     └─ Fixes issues from review gate                    │
│                                                         │
│  Phase 5: QUALITY GATES ─────────── Lead runs checks    │
│     └─ Prettier → ESLint → TypeCheck → Tests            │
│                                                         │
│  Phase 6: QA TESTING ────────────── @qa-tester agent    │
│     └─ Writes + runs Playwright/Japa tests              │
│                                                         │
│  Phase 7: FINAL REPORT ─────────── Lead summarizes      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 0: Product Owner Brief

Before any implementation begins, spawn the **product-owner** agent to provide
business context for the feature:

```
@product-owner

We are about to implement the feature in [FEATURE_DIR].

Generate a business brief for the implementation team. Read the spec.md and
plan.md to understand the feature, then provide:

1. Feature purpose — why this exists, who benefits
2. Business rules — domain constraints that MUST be respected
3. User stories — key scenarios from the user's perspective
4. Gotchas — business edge cases the developer might miss
5. Acceptance criteria — how to know it's done from a business perspective

Also check if this feature corresponds to a backlog task (tasks/backlog/).
If so, update its status to `in_progress` in both the task file and
tasks/backlog.md.
```

**Save the PO brief** — it will be passed to the developer agent in Phase 2 as
part of their context. This ensures the dev team understands the "why" behind
every technical decision.

---

## Phase 1: Setup & Context Loading

1. Run
   `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks`
   from repo root and parse FEATURE_DIR and AVAILABLE_DOCS list. All paths must
   be absolute. For single quotes in args like "I'm Groot", use escape syntax:
   e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. **Check checklists status** (if FEATURE_DIR/checklists/ exists):
   - Scan all checklist files in the checklists/ directory
   - For each checklist, count:
     - Total items: All lines matching `- [ ]` or `- [X]` or `- [x]`
     - Completed items: Lines matching `- [X]` or `- [x]`
     - Incomplete items: Lines matching `- [ ]`
   - Create a status table:

     ```text
     | Checklist | Total | Completed | Incomplete | Status |
     |-----------|-------|-----------|------------|--------|
     | ux.md     | 12    | 12        | 0          | ✓ PASS |
     | test.md   | 8     | 5         | 3          | ✗ FAIL |
     ```

   - **If any checklist is incomplete**:
     - Display the table with incomplete item counts
     - **STOP** and ask: "Some checklists are incomplete. Do you want to proceed
       with implementation anyway? (yes/no)"
     - Wait for user response before continuing

   - **If all checklists are complete**:
     - Display the table showing all checklists passed
     - Automatically proceed

3. Load and analyze the implementation context:
   - **REQUIRED**: Read tasks.md for the complete task list and execution plan
   - **REQUIRED**: Read plan.md for tech stack, architecture, and file structure
   - **REQUIRED**: Read `.claude/skills/adonisjs-v7/SKILL.md` (for backend
     tasks) AND/OR `.claude/skills/react/SKILL.md` (for frontend tasks) before
     writing any code. Determine relevant sub-sections based on the tasks.
   - **IF EXISTS**: Read data-model.md for entities and relationships
   - **IF EXISTS**: Read contracts/ for API specifications and test requirements
   - **IF EXISTS**: Read research.md for technical decisions and constraints
   - **IF EXISTS**: Read quickstart.md for integration scenarios

4. **Project Setup Verification**:
   - **REQUIRED**: Create/verify ignore files based on actual project setup:

   **Detection & Creation Logic**:
   - Check if the following command succeeds to determine if the repository is a
     git repo (create/verify .gitignore if so):

     ```sh
     git rev-parse --git-dir 2>/dev/null
     ```

   - Check if Dockerfile\* exists or Docker in plan.md → create/verify
     .dockerignore
   - Check if .eslintrc\* exists → create/verify .eslintignore
   - Check if eslint.config.\* exists → ensure the config's `ignores` entries
     cover required patterns
   - Check if .prettierrc\* exists → create/verify .prettierignore
   - Check if .npmrc or package.json exists → create/verify .npmignore (if
     publishing)

   **If ignore file already exists**: Verify it contains essential patterns,
   append missing critical patterns only. **If ignore file missing**: Create
   with full pattern set for detected technology.

5. Parse tasks.md structure and extract:
   - **Task phases**: Setup, Tests, Core, Integration, Polish
   - **Task dependencies**: Sequential vs parallel execution rules
   - **Task details**: ID, description, file paths, parallel markers [P]
   - **Execution flow**: Order and dependency requirements

6. **Display team deployment plan** to the user:

   ```text
   🚀 SpecKit Implement — Agent Team Deployment

   Feature: [feature name]
   Tasks: [N] tasks across [M] phases

   Team:
   ├── 🟡 Product Owner — Business guardian & domain expert (Opus)
   ├── 🔵 Developer — Full-stack developer (Opus)
   ├── 🟣 Review Coordinator — Spawns parallel reviewers
   │   ├── Code Reviewer (Sonnet)
   │   ├── Security Auditor (Sonnet)
   │   ├── Test Reviewer (Sonnet)
   │   └── Performance Analyst (Sonnet)
   ├── 🟢 QA Tester — Playwright + Japa tests (Opus)
   └── ⚪ Team Lead (you) — Orchestration + quality gates

   Proceeding with implementation...
   ```

7. **Workflow supervision**:
   - Long-running implementations SHOULD use the structured workflow ledger in
     `.claude/logs/`.
   - If the work is expected to run for more than a few minutes, start a status
     audit loop such as:

     ```text
     /loop 5m /status-audit [feature id or latest]
     ```

   - Use the audit output to detect blocked, stale, or improperly handed-off
     agent phases.

---

## Phase 2: Implementation (Developer Agent)

Spawn the **developer** sub-agent to execute the tasks:

```
@developer

You are implementing the feature defined in [FEATURE_DIR].

## Context

- Feature spec: [FEATURE_DIR]/spec.md
- Implementation plan: [FEATURE_DIR]/plan.md
- Task list: [FEATURE_DIR]/tasks.md
- Data model: [FEATURE_DIR]/data-model.md (if exists)
- Contracts: [FEATURE_DIR]/contracts/ (if exists)

## Product Owner Brief

[Paste the PO brief from Phase 0 here — business rules, user stories, gotchas,
acceptance criteria. This is your source of truth for business logic.]

## Task List

[Paste the full content of tasks.md here]

## Instructions

Execute each task phase by phase:

1. Complete Setup phase first
2. For TDD tasks: write tests before implementation
3. Core development phase
4. Integration phase
5. Polish phase

Rules:

- Mark each completed task as [X] in tasks.md
- Report progress after each completed task
- Stop and report if you encounter a blocker
- Follow ALL architecture rules from SKILL.md files
- Apply the Boy Scout Rule: fix warnings in files you touch
- End each major phase with the workflow status block and handoff block
```

**Wait for the developer to complete all tasks.**

If the developer reports blockers:

- Analyze the blocker
- Provide guidance or adjust the task
- Resume the developer via SendMessage

---

## Phase 3: Review Gate (Review Coordinator Agent)

Once implementation is complete, spawn the **review-coordinator** to run
parallel reviews:

```
@review-coordinator

The developer has completed the feature in [FEATURE_DIR].

Run a full review gate:

1. Spawn code-reviewer and security-auditor (mandatory)
2. Spawn test-reviewer (if test files exist)
3. Spawn performance-analyst (if DB queries or React components were changed)
4. Spawn accessibility-auditor (if frontend files were changed)
5. Spawn api-contract-reviewer (if both controller + page were changed)
6. Spawn design-system-enforcer (if frontend components were changed)
7. End with the normalized `REVIEW SUMMARY` block
8. End with the workflow status block and handoff block

Produce a unified report with prioritized findings. Feature directory:
[FEATURE_DIR]
```

**Wait for the review coordinator to produce its report.**

---

## Phase 4: Fix Review Issues (Developer Agent)

If the review gate found **CRITICAL** or **HIGH** issues:

1. Resume the **developer** agent via SendMessage:

```
The review gate found issues that need fixing:

[Paste the CRITICAL and HIGH issues from the review report]

Fix each issue, then report what was changed.
```

2. After fixes, **re-run a targeted review** if needed (only for the specific
   issues that were flagged).

3. If only MEDIUM or LOW issues remain, proceed — they can be addressed later.

---

## Phase 5: Quality Gates (Lead Runs Directly)

Run the quality gates sequentially — stop at the first failure and fix it:

### 5.1 Format (Prettier)

```bash
npm run format
```

- If Prettier modified files, note which files changed and re-run to confirm
  they are now clean.

### 5.2 Lint (ESLint)

```bash
npm run lint
```

- If there are auto-fixable errors, run `npm run lint -- --fix` first, then
  re-check.
- For remaining errors, fix them manually.

### 5.3 TypeScript Type Check

```bash
npm run typecheck
```

- If there are type errors, fix them.

### 5.4 Tests (Japa)

```bash
node ace test
```

- If tests fail, investigate and fix.

---

## Phase 6: QA Testing (QA Tester Agent)

Spawn the **qa-tester** sub-agent for comprehensive testing:

```
@qa-tester

The feature in [FEATURE_DIR] has been implemented and passed quality gates.

## Your Mission
1. Audit existing test coverage for this feature
2. Identify untested user flows
3. Write missing tests (browser, functional, and unit)
4. Run the full test suite and report results

## Context
- Feature spec: [FEATURE_DIR]/spec.md
- Implementation plan: [FEATURE_DIR]/plan.md
- Changed files: [list from git diff --name-only main]

## Priority
- P0: Browser tests for critical user flows
- P1: Functional tests for API endpoints
- P2: Unit tests for service logic

IMPORTANT: Read .claude/skills/write-tests/SKILL.md BEFORE writing any test.
Also include the normalized `QA SUMMARY` block.
Also end your QA report with the workflow status block and handoff block.
```

**Wait for the QA tester to complete and produce its report.**

If the QA tester finds bugs:

1. Resume the **developer** to fix them
2. Re-run failed tests to confirm fixes

---

## Phase 7: Final Report

After all phases complete, produce the final summary:

```text
✅ SpecKit Implement — COMPLETE

## Feature: [feature name]

## Team Activity
| Agent | Role | Status | Duration |
|-------|------|--------|----------|
| 🔵 Developer | Implementation | ✅ Done | [N] tasks completed |
| 🟣 Review Coordinator | Code review | ✅ Done | [N] issues found |
| 🟢 QA Tester | Test coverage | ✅ Done | [N] tests written |
| 🟡 Lead | Quality gates | ✅ Done | All passing |

## Implementation Summary
- [N] files created, [M] files modified
- Key changes: [brief summary]

## Review Results
- Critical issues fixed: [N]
- High issues fixed: [N]
- Remaining (low): [N]

## Test Coverage
| Suite      | Tests | Pass | Fail | New |
|------------|-------|------|------|-----|
| Unit       | ...   | ...  | ...  | ... |
| Functional | ...   | ...  | ...  | ... |
| Browser    | ...   | ...  | ...  | ... |

## Quality Gates
| Gate       | Status  |
|------------|---------|
| Prettier   | ✅ PASS |
| ESLint     | ✅ PASS |
| TypeCheck  | ✅ PASS |
| Tests      | ✅ PASS |

## Next Step
```

Then suggest the next command:

```
/speckit review NNN
```

---

## Error Handling

- **Developer blocked**: Analyze the blocker, provide guidance, resume.
- **Review gate FAIL**: Route fixes to developer, re-review.
- **Quality gate FAIL**: Fix directly (formatting, lint) or route to developer
  (logic errors).
- **QA tests fail**: Route bugs to developer, re-run tests.
- **Agent timeout**: Report which agent timed out and suggest manual
  intervention.

If the entire pipeline fails after 2 fix cycles on the same issue, **STOP** and
escalate to the user with a clear description of the blocker.
