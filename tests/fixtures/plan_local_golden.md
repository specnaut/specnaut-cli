## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## What this phase is for

**One planning document per feature**: what it does, the architecture it must obey, and the
questions only the user can answer. It replaces four phases and asks the one question that decides
whether a feature ships once or four times: **what are this feature's decisions, and where does each
one live?** A developer free to choose where a rule lives will spell it twice, and finding that at
review time means rebuilding after the code exists. So: **shorter** than what it replaced,
**stricter** about that one thing.

## Pre-Execution Checks

**Check `hooks.before_plan` in `.specnaut/extensions.yml`** — skip silently if absent or
unparseable. For each enabled entry (missing `enabled` counts as `true`) with no non-empty
`condition`, emit an `## Extension Hooks` block: `**Optional Pre-Hook**` with command, description
and prompt, or `**Automatic Pre-Hook**` with `EXECUTE_COMMAND: {command}` — then wait for its
result. Non-empty `condition`s are deferred to the HookExecutor.

## Steps

### 1. If the idea is still fuzzy, find out what it is — then keep going

Judge the input on one question: **can this be planned as written?** A brief naming an outcome, an
actor and a rough scope can; "something to keep track of runs" cannot.

When it cannot, run a short discovery dialogue **before** writing anything. How a question is put
is decided by the `response-style-contract` skill — read it; never restate it here. What is specific
to discovery: offer genuinely different **shapes**, not three phrasings of one, and stop as soon as
you can state the outcome, the actor, and what is out of scope.

Then **continue into step 2 in the same turn.** Discovery opens this phase; it is not a phase of its
own, and not a reason to hand control back.

### 2. Resolve the feature and create its home

Generate a concise short name (2–4 words, action-noun where possible — `add-user-auth`,
`fix-payment-bug`), preserving technical terms and acronyms. Then:

```bash
.specnaut/scripts/bash/create-new-feature.sh --json --short-name "<short-name>" [--issue <N>] "<description>"
```

Read `BRANCH_NAME`, `SPEC_FILE` and the feature directory from the JSON. `create-new-feature.sh` is
re-entrant: run against an existing feature it switches to the existing branch. Specs live under
`.specnaut/specs/<prefix>-<short-name>/`, the prefix following `branch_numbering` in
`.specnaut/init-options.json`.

Persist `{ "feature_directory": "<dir>", "linked_issue": <N or null> }` to
`.specnaut/feature.json`: `<dir>` is the real `.specnaut/specs/<prefix>-<name>`, repo-relative.
Never absolute: it is committed. `linked_issue` is the backlog item id when `--issue <N>` was passed
(or a hook returned one); `merge` reads it to close the item, and its absence is a no-op downstream.

**Persist it before the next command, not after.** Every script that resolves feature paths reads
`.specnaut/feature.json` ahead of the branch name, so one left naming the previous feature sends the
next command's writes into that feature's directory. Then:

```bash
.specnaut/scripts/bash/setup-plan.sh --json
```

**The card moves itself.** With `--issue <N>`, `create-new-feature.sh` moves that item to
`In progress` as part of creating the branch, and reports the outcome — including when nothing
moved. Do **not** move it yourself as well: the workflow's board writes have one home each, this
one and `merge`'s move to `Done`.

**One feature per invocation.** The feature directory name and the branch name are independent.

### 3. Read the ground truth before writing a line

- `.specnaut/memory/constitution.md` — binding, and it outranks this file.
- The linked backlog item's body, when there is one.
- **The code the feature touches.** Most of what looks like a design question is already decided
  somewhere in the repository, and a plan that re-decides it produces a second spelling — the exact
  defect this phase exists to prevent.

### 4. Write ONE document: `plan.md`

One file, read whole by whoever implements. Twelve sections, in order, **none optional**:

1. **Why this exists** — the problem in the user's terms, measured where a measurement is available.
2. **User scenarios** — prioritised journeys (P1, P2, P3…), each independently testable, with
   Given/When/Then acceptance scenarios. Edge cases named.
3. **Requirements** — `FR-001…`, each testable.
4. **Success criteria** — `SC-001…`, measurable and technology-agnostic.
5. **🔒 The decision table** — step 5. **This is the section this phase exists for.**
6. **Technical context** — language, storage, testing, constraints, scale. Where the feature has
   entities worth naming, the domain model goes here: bounded context, vocabulary, entities (which
   have identity), value objects, invariants.
7. **Constitution check** — every principle, with a verdict. A violation goes in Complexity Tracking
   with its justification, or the plan is not done.
8. **Surface impact** — every client surface the feature touches, plus the interface contracts it
   exposes. "One surface only" is a valid answer; an unstated one is not.
   **Front-end / UX-UI features**: where the project has a front-end surface, add a
   `## Visual Prototyping with Claude Artifacts` subsection. Detect that surface with the SAME
   signals the accessibility gate uses — the `accessibility-expert` FE-surface list; don't invent a second
   heuristic. No front-end surface → the plan **must not mention** artifacts at all.
   The plan's requirements follow the `mobile-first-contract` skill — read it; never restate it here.
9. **Risks** — each with its mitigation.
10. **Architecture audit** — findings, and what was done with each. Step 6.
11. **Security audit** — same, and kept **separate**: the two answer different questions and a
    reader needs both verdicts on their own terms.
12. **Open questions**, and the answers once given. Step 8.

Write for whoever implements: **what** and **why**, and the **how** only where it is a decision the
implementer must not re-take.

Use `.specnaut/templates/plan-template.md` — it carries these twelve sections with the decision
table pre-stubbed.

### 5. 🔒 The decision table — binding, and mechanically checkable

Prose does not bind anything. A table does, because a reviewer can diff the code against it. For
every rule the feature introduces:

| The decision | Its single home | What would duplicate it |
| :--- | :--- | :--- |
| _the rule, in the user's words_ | _one file path_ | _the shapes a second spelling takes_ |

- **Every requirement that is a rule gets a row.** If a requirement says "closed by default", the
  table says where "closed" is decided.
- **A home is a file, not a layer.** "the service layer" is not a home.
- **The third column is the useful one.** It is what a reviewer greps for, and writing it forces you
  to notice when a schema constraint and an application check are two spellings of one rule.
- **A rule with two genuine enforcement points** names the ONE place the *decision* is made, and
  records that both *ask* it. Two askers is fine; two deciders is the defect.

**Binding on the implementer.** A decision may not move out of its home without the plan being
amended first. A review finding that a decision has two homes is a **plan violation, not a style
opinion**.

### 6. 🔒 The two audits — MANDATORY, and they audit the PLAN, not the code

**An epic is one plan.** If the item has open sub-issues, write **one**
`plan.md` covering every child — one decision table, one stop — not one per
child. `phases/epic-loop.md` has the rest.

Read `phases/plan-audits.md` and follow it. It dispatches `architect-expert` and
`security-expert` on `plan.md` **in the same message**, before a single line is written, and it
carries the eight questions they are asked and the rule that their findings land **in `plan.md`**.

Not optional, and not deferrable to `review`: architecture found at review time is architecture
rebuilt, and a security finding against existing code moves a boundary the whole feature was built
against.

### 8. STOP — the user answers before any code exists

**Mandatory. Never skipped, never inferred, never assumed from silence.** This is stop 1 of the
chain's two stops. Present, in this order:

1. **The architecture, as a proposal with its alternatives.** Name what you rejected and why. A
   single option presented as settled gets approved by default — the same as not asking.
2. **Both audits' findings — architecture AND security** — and what you did with each: changed the
   plan, or accepted the objection with a reason. Never as a formality that passed, never folded
   together.
3. **The open questions** — business rules, thresholds, what happens to existing data, anything
   where two readings lead to materially different work. Put them per the
   `response-style-contract` skill, ordered so the answer that invalidates the most others comes
   first.
4. **Anything you decided yourself** because the code or a standing decision already answered it —
   one line each, so a wrong assumption is visible rather than buried.

Record every answer **in `plan.md` as a settled decision, with its date**. If there is genuinely
nothing to ask, say so and present the architecture anyway: **the user's veto on the architecture is
the point of this stop, not the questions.**

### 9. Commit, then INVOKE `tasks` — same turn

```bash
git add .specnaut/specs/<feature-dir>/ && git commit -m "plan(<id>): <what the feature does>"
```

Commit **before** handing off: a worktree runs off committed HEAD, and an uncommitted plan is
invisible to whoever needs it.

**INVOKE `tasks` yourself, in the same turn as the user's last answer** — your own next action, not
a command printed for them to paste. The stop is over the moment the questions are answered; asking
for a second approval re-litigates what they just decided.

`tasks` derives from the **approved** plan — hence a separate phase; decomposing here would break
down an architecture the user has not approved. Only an **unanswered** question legitimately holds
it. Answered means go. Pause only when the run was started with `--manual`.

## Post-Execution Checks

**Check `hooks.after_plan`** — same rules, `**Optional Hook**` / `**Automatic Hook**` wording.

## Key rules

- **Absolute paths** for filesystem operations; project-relative paths inside documents.
- **A number is not a name.** Follow the `backlog-reference-contract` skill for every reference.
- **A requirement that quantifies over a set must say so unambiguously.** "every", "all", "none
  anywhere" names a set, and `tasks` decomposes it by SEARCH, never by example. Name the search that
  enumerates it where you can.
- **Make informed guesses** from context and common patterns, recorded under open questions as
  decisions you took — one line each. No need to ask about data retention, performance targets,
  error handling, authentication method or integration patterns.
- **Success criteria are measurable, technology-agnostic and user-focused.** "Users complete
  checkout in under 3 minutes", not "API response time under 200ms".
- **The code is the present; a document is a claim about the past.** Where they disagree, the code
  wins and the document is corrected in the same change.
- **There is no cross-artefact consistency check any more, and none should be re-added.** With one
  document there are no artefacts to hold in agreement — the step-6 audits replaced it, and run
  before the code exists rather than after.
- **Do not pad.** A plan long enough to be skimmed is a plan nobody reads.
