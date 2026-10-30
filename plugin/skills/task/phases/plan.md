Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

## User Input

```text
$ARGUMENTS
```

## What this phase is for

One short document per feature — **the brief** — that names the task, the decisions and where each
one lives, and how done is checked, for **long-lived** software: clean, SOLID, secure by default. A
rule whose home is not named gets written twice, and finding that at review means rebuilding.

`--full` in the arguments asks for the full plan instead (step 4b). So does the risk threshold in
step 4b, without being asked.

## Steps

### 1. If the idea is still fuzzy, find out what it is — then keep going

Can this be planned as written? A request naming an outcome, an actor and a rough scope can;
"something to keep track of runs" cannot. When it cannot, ask a few questions first, offering
genuinely different shapes (how a question is put follows the `response-style-contract` skill), and
stop asking once you can state the outcome, the actor, what is out of scope and how acceptance is
checked. Then continue into step 2 in the same turn.

### 2. Resolve the feature and create its home

<!-- BEGIN: spec-backend=local -->
Pick a short name (2–4 words, `add-user-auth`), then:

```bash
.specnaut/scripts/bash/create-new-feature.sh --json --short-name "<short-name>" [--issue <N>] "<description>"
```

Read `BRANCH_NAME`, `SPEC_FILE` and the feature directory from the JSON (re-running it on an
existing feature switches to its branch). **Before the next command**, write
`{ "feature_directory": "<dir>", "linked_issue": <N or null> }` to `.specnaut/feature.json`: `<dir>`
is the real `.specnaut/specs/<prefix>-<name>`, repo-relative, never absolute — it is committed. Every
feature-path script reads it first, and `merge` reads `linked_issue` to close the item. Then:

```bash
.specnaut/scripts/bash/setup-plan.sh --json
```

With `--issue <N>` the script moves the card to `In progress` itself; do not move it again. One
feature per invocation.
<!-- END: spec-backend=local -->
<!-- BEGIN: spec-backend=cloud -->
This project stores specifications on SpecNaut Cloud. Do **NOT** create a git branch and do **NOT**
write any `.specnaut/specs/<n>/` files here — the branch is created later, at `/task implement`.

1. Determine the task number: use `--issue <N>` when the user passed one; otherwise
   `specnaut spec push` auto-creates a backlog task named from the feature and links it.
2. Write the planning document to the gitignored cache as the `plan` step:
   `.specnaut/specs/.cache/<task>/1-plan.md`, then `specnaut spec push <task>` (upsert-only; it
   never deletes other tabs).
3. Persist `{ "linked_issue": <N> }` to `.specnaut/feature.json`. No `feature_directory` in cloud
   mode.

**Parallel authoring:** cloud `plan` creates no branch and writes no shared state, so several
features can be planned concurrently — one `plan` per task, each pushed independently.
<!-- END: spec-backend=cloud -->

### 3. Read the ground truth first

The linked backlog item's body, and **the code the feature touches** — most design questions are
already decided there, and re-deciding one produces a second spelling. Where a document and the code
disagree, the code wins and the document is corrected in the same change.

### 4a. Write the brief: `plan.md`, five parts

1. **Task and out of scope** — the outcome in the user's terms, and what this change does not do.
2. **Guardrails** — the decision table (step 5); the constitution's principles this change could
   break, cited by name, with how it keeps each (not a table of every principle); every surface it
   touches and the interface contracts it exposes ("one surface" is a valid answer, an unstated one
   is not); and one required line, **Surfaces added or widened: none | <list>** — trust boundaries
   in the sense of step 4b, where "none" names what was checked. Requirements follow the
   `mobile-first-contract` skill. Where the project has a front-end surface — detected with the
   same signals as the `accessibility-expert` FE-surface list, never a second heuristic — add a
   `Visual Prototyping with Claude Artifacts` subsection; with none, the plan must not mention
   artifacts at all.
3. **Done, as runnable checks** — the commands and tests that prove it: the project's gates
   (`.specnaut/scripts/bash/run-gate.sh`), the test each requirement maps to, and the size ratchet
   (`.specnaut/memory/size-limits.md`).
4. **Audit findings** — architecture and security, kept separate (step 6).
5. **Open questions**, and the answers once given (step 7).

A requirement that quantifies over a set ("every", "none anywhere") says so and names the search
that enumerates it.

### 4b. The full plan — on request, or past the risk threshold

Write the full plan (`.specnaut/templates/plan-template.md`: scenarios, `FR-` / `SC-` ids, the
decision table, domain model, constitution check, surfaces, risks, both audits, open questions)
when the arguments say `--full`, or when the change **adds or widens a trust boundary**: a data
migration or a change to stored data; authentication or authorisation; secrets, credentials or
cryptography; a new place that accepts untrusted input (a route, webhook, upload, argument or file
content that reaches a shell, a path or a parser); a new external service, outbound call, dependency
or network listener; files written or deleted in someone else's project; an agent instruction
surface (tool grants, permission allowlists, hooks that run on their own); a change to a public
interface other projects consume. Say which line triggered it. When the security seat answers
"crosses the threshold: <which>", the full plan is due even if you judged otherwise.

### 5. 🔒 The decision table — binding

| The decision | Its single home | What would duplicate it |
| :--- | :--- | :--- |
| _the rule, in the user's words_ | _one file path_ | _the shapes a second spelling takes_ |

Every requirement that is a rule gets a row. A home is a file, not a layer. The third column is what
a reviewer greps for. A rule with two enforcement points names the one place it is *decided*; two
askers are fine, two deciders are the defect. **Binding on the implementer**: a decision moves out of
its home only after the brief is amended, and a review finding of two homes is a plan violation.

**A new script, helper or automation is a decision too — reuse before you build.** Its row names
**(a)** the existing helpers and commands you inventoried for the procedure, **(b)** the recurrence
evidence, and **(c)** the outcome — *reuse directly*, *extend the existing helper at its owner*, or
*add a new helper*. The evidence bar is two separate prior occurrences, besides the current one,
each traceable to an issue or a commit. Several receipts from one repair count as one occurrence.
Below the bar the outcome is *reuse directly*. A new or extended helper takes data, never code: it
accepts no arbitrary executable path, shell string, or caller-chosen argv or environment, keeps the
exit codes of the helper it extends, and never reports a missing, refused or skipped result as a
pass.

### 6. 🔒 The audits — every feature, before any code

**An epic is one plan**: one brief covering every open child, one table, one stop
(`phases/epic-loop.md`).

**They run on every plan, brief or full** — the threshold changes the plan's shape, never whether it
is audited. Dispatch **in the same message** `architect-expert` and `security-expert` on `plan.md`,
and `performance-expert` too when the change has a hot path, a bulk job or a query over an unbounded
set. Each answers its own plan-audit questions (its **Mode 3**). Where the harness cannot dispatch a
subagent, read each seat's file and answer its Mode 3 questions yourself, each seat's findings kept
separate. Their findings go **into `plan.md`**:
the plan changes, or it records why an objection was accepted; a clean verdict is written down with
what it covered. Not deferrable to `review`: architecture found at review time is architecture
rebuilt.

**Who decides — the seats, not the user.** **A technical fork is never a question**: architecture,
patterns, layering, security hardening and performance trade-offs are ranked by the seats, the brief
takes the top option and records what was rejected and why — reported at the stop, **never
asked**. When two seats disagree, the reading better for the code's long-term health
wins: security, then maintainability, then performance, then speed of delivery. Escalate only a fork
that changes what the product does, or one in the always-ask class of step 7.

### 7. The plan stop — ask only what only the user can answer

`phases/auto-chain.md` decides whether the chain stops here and whether anything after it asks
again — tell the user which, and ask here what autopilot would otherwise settle alone. Present, in
order:

1. the decided design, with what was rejected and why — a report, not a vote;
2. both audits' findings, separately, and what was done with each;
3. **the open questions — only what only the user can answer**: business rules, thresholds, what
   happens to existing data, scope — and always: the base branch, anything irreversible or
   destructive, breaking a public surface, a new external service, vendor or cost — the answer that
   invalidates the most others first;
4. anything you decided yourself, one line each.

Record each answer in `plan.md` with its date. With nothing open, report 1, 2 and 4 and go on.

### 8. Commit, then INVOKE `implement` — same turn

<!-- BEGIN: spec-backend=local -->
```bash
git add .specnaut/specs/<feature-dir>/ && git commit -m "plan(<id>): <what the feature does>"
```

Commit before handing off: a worktree runs off committed HEAD.
<!-- END: spec-backend=local -->

Then **invoke `implement` yourself, in the same turn as the user's last answer** — your own next
action, not a command printed for them. Whether anything stops here is `phases/auto-chain.md`'s to
say.

References to a backlog item follow the `backlog-reference-contract` skill.
