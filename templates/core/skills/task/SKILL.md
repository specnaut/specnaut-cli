---
name: task
description: Carry one unit of work from the backlog to a merged branch — list, add, edit, close and groom items, then plan, implement, review and merge them, and audit the code. `/task <verb> [args]`; `/task` alone prints the overview.
argument-hint: "<list|next|add|edit|close|groom|plan|tasks|implement|review|merge|audit|constitution> [args]"
when_to_use: |
  Trigger phrases that should route here:
  - backlog: "add to backlog", "what's next?", "move task X", "close task X", "groom the backlog"
  - plan: "plan a feature", "spec out a feature", "I have a rough idea", "clarify requirements"
  - implement / review / merge: "implement the feature", "review the implementation", "merge the branch"
  - audit: "audit the codebase", "security audit", "check for vulnerabilities", "audit the architecture"
  - constitution: "update the constitution", "edit project rules"
---

# Task router

Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

**Response style** — brevity, visual order, questions as selections, badge colours — follows the `response-style-contract` skill; read it, never restate it here.

**Backlog references** follow the `backlog-reference-contract` skill — read it; never restate it here.

`$ARGUMENTS` carries the user's input. Parse it as `[--manual] [--manual-merge] <verb> [rest]`:

1. **Chain mode** — `--manual` is the only chain flag: present → CHAIN_MODE = `off` (run this one
   verb, then stop); absent → `auto`, the default. `--manual-merge` present → this run's merge mode
   is `manual` whatever `.specnaut/workflow.yml` says (`phases/auto-chain.md` reads it). It does not
   stop the chain anywhere else. Strip both.
2. **Verb** — the first remaining token. Everything after it is the verb's argument string.
3. **Nothing left** → render the **Overview** below and stop. Do not pick a verb yourself.

## Verbs

| Verb | Reference | One-liner |
| :--- | :--- | :--- |
| `list` _(or empty)_ | `backlog.md` | Backlog overview |
| `next` | `backlog.md` | Recommend the top 3 items, with workflow advice |
| `add <title>` | `backlog.md` | Create an item |
| `edit <id>` | `backlog.md` | Change an item's title, body, status or fields |
| `close <id> [--not-planned]` | `backlog.md` | Close an item — completed, or not planned |
| `estimate <id>` | `backlog.md` | Estimate complexity |
| `status` | `backlog.md` | Dashboard summary |
| `brief <id>` | `backlog.md` | Product-owner business brief |
| `<id>` | `backlog.md` | Show that item |
| `groom` | `groom.md` | Full grooming pass |
| `plan [<id>] [brief]` | `phases/plan.md` | The feature's **one** document, its architecture and security audit, then the stop. |
| `tasks` | `phases/tasks.md` | The dependency-ordered breakdown, derived from the **approved** plan. |
| `implement` | `phases/implement.md` | Build it. Ends by invoking `review`. |
| `review` | `phases/review.md` | The quality battery on a frozen tree. Its verdict is the merge request. |
| `merge` | `phases/merge.md` | Pre-merge validation; merge, push, close the item. |
| `audit [--security\|--archi\|--perf\|--a11y\|--deps]` | `phases/audit.md` | Read-only audit of a scope; every applicable axis with no flag. |
| `constitution` | `phases/constitution.md` | Amend the project's constitution, on the user's explicit request only. |

`phases/plan-audits.md`, `phases/merge-squash.md`, `phases/epic-commits.md`,
`phases/quality-gates.md`, `phases/epic-fixups.md`, `phases/merge-close.md`, `phases/epic-loop.md`
and `phases/auto-chain.md` are **contract docs, not verbs** — `plan` loads the first at its step 6,
`merge` loads the second at its step 4, `implement` loads the third when the item is an epic,
`implement` and `merge` share the fourth, `merge` loads the fifth before an epic merge and the sixth
after any push, `implement` loads the seventh on an epic, and this router loads the eighth when it
chains. Naming any of them as a verb prints the verb table and stops.

Unknown verb → print the verb table and stop. A verb that lived at another address before this
router existed is listed, with where it went, in the `specnaut` skill's **Retired addresses**
table.

## Which skill owns what

| Skill | Owns |
| :--- | :--- |
| `/task` | one unit of work — from backlog item to merged branch, audits included |
| `/specnaut` | the framework itself — its documentation, what is installed, upgrading it |
| `/ship` | production — getting a built thing out the door |

## All backlog writes go through the Product Owner

The main session does **not** run the backlog scripts' writing commands. Every create, edit, move
and close — including the ones `plan` and `merge` make — is dispatched to the `product-owner`
agent, the single owner of backlog state. The read-only scripts (`list.sh`, `view.sh`) may be run
directly.

<!-- BEGIN: spec-autogen=on -->
## Auto-generate a task's spec at creation (cloud, opt-in)

This project has `spec_autogen: true` and stores its specs on SpecNaut Cloud. After every
item `/task add` creates, also generate its spec — read `spec-autogen.md` and follow it.
<!-- END: spec-autogen=on -->

## Routing

1. **Read** the verb's reference file from the table, with the `Read` tool.
2. **Read the project addendum** `.specnaut/addenda/task/<verb>.md` if it exists, for `plan`,
   `tasks`, `implement`, `review`, `merge`, `audit`, `constitution` and `groom` — the project's own
   addition to that verb. It adds to the phase at the step it names and never replaces or skips a
   bundled step: where it contradicts one, the bundled step stands and you say so. No file means no
   addendum — say nothing about it. Contract docs take none; the parent verb's addendum names their
   step.
3. **Substitute** the stripped arguments for the reference's input.
4. **Execute** the procedure end-to-end, with the addendum applied.
5. **Decide whether to chain** (below).

## Chain decision

After the verb completes successfully:

- `CHAIN_MODE == off` → stop. Report the outcome.
- The verb is not chainable → stop. Chainable verbs: `plan`, `tasks`, `implement`, `review`.
- Otherwise → read `phases/auto-chain.md` and follow it.

**Re-entry needs no flag.** A verb whose downstream artefacts already exist runs one-shot; one whose
downstream artefacts are absent chains. `phases/auto-chain.md` holds the detection table.

## Overview

```
/task add → /task plan <id> → tasks → implement → review → merge
                 ▲                                  │        ▲
                 │                                  └────────┘
                 └── discovery (if fuzzy) → the one document
                     → architecture + security audit OF THE PLAN
                     → STOP 1
```

**Autopilot is the default: the chain stops at most once, at the end of `plan`**, and only to ask
what only the user can answer — business rules, scope, and anything irreversible, destructive,
public-breaking or costly. Architecture, security and performance forks are settled by the expert
seats and reported, never asked. Then it runs to a merged, **pushed** base branch and a closed
backlog item without asking again.

A second stop — the review verdict as the merge request, asked once — exists only when
`.specnaut/workflow.yml` says `merge: manual`, or the run says so (`--manual-merge`, "stop before
merging"). Every other boundary is crossed by invoking the next verb yourself, in the same turn.

To run a single verb only: `/task plan --manual "Add OAuth2 login"`.
