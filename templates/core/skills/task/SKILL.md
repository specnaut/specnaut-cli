---
name: task
description: Carry one unit of work from the backlog to a merged branch — list, add, edit, close and groom items, then plan, implement, review and merge them, and audit the code. `/task <verb> [args]`; `/task` alone prints the overview.
argument-hint: "<list|next|add|edit|close|groom|resume|plan|implement|review|merge|audit|constitution> [args]"
when_to_use: |
  Trigger phrases that should route here:
  - backlog: "add to backlog", "what's next?", "move task X", "close task X", "groom the backlog"
  - plan: "plan a feature", "spec out a feature", "I have a rough idea", "clarify requirements"
  - implement / review / merge: "implement the feature", "review the implementation", "merge the branch"
  - resume: "resume task X", "continue where we stopped", "pick up the interrupted chain"
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
| `next` | `backlog.md` | Count work in progress, then recommend the top 3 items, with workflow advice |
| `add <title>` | `backlog.md` | Create an item |
| `edit <id>` | `backlog.md` | Change an item's title, body, status or fields |
| `close <id> [--not-planned]` | `backlog.md` | Close an item — completed, or not planned |
| `estimate <id>` | `backlog.md` | Estimate complexity |
| `status` | `backlog.md` | Dashboard summary |
| `brief <id>` | `backlog.md` | Product-owner business brief |
| `<id>` | `backlog.md` | Show that item |
| `groom` | `groom.md` | Full grooming pass |
| `resume <id>` _(or `continue <id>`)_ | `resume.md` | Rebuild where a stopped chain stood, from git, and re-enter it |
| `plan [<id>] [--full] [brief]` | `phases/plan.md` | The feature's brief — or the full plan — its architecture and security audit, then the stop. |
| `implement` | `phases/implement.md` | Build it, ordering the work itself. Ends by invoking `review`. |
| `review` | `phases/review.md` | The quality battery on a frozen tree. Its verdict is the merge request. |
| `merge` | `phases/merge.md` | Pre-merge validation; merge, push, close the item. |
| `audit [--scan\|--security\|--archi\|--perf\|--a11y\|--deps]` | `phases/audit.md` | Read-only audit of a scope; every applicable axis with no flag; `--scan` the size map alone. |
| `constitution` | `phases/constitution.md` | Amend the project's constitution, on the user's explicit request only. |

These are **contract docs, not verbs** — naming one prints the verb table and stops:

| Contract doc | Loaded by |
| :--- | :--- |
| `phases/merge-squash.md` | `merge`, at its step 4 |
| `phases/epic-commits.md` | `implement`, on an epic |
| `phases/quality-gates.md` | `implement`, `review` and `merge` |
| `phases/epic-fixups.md` | `merge`, before an epic merge |
| `phases/merge-close.md` | `merge`, after any push |
| `phases/epic-loop.md` | `implement`, on an epic |
| `phases/auto-chain.md` | this router, when it chains |
| `phases/remote-gates.md` | `auto-chain`, in remote mode |
| `phases/orphan-specs.md` | `groom`, when specs are kept locally |
| `phases/review-seats.md` | `review`, before its first seat brief |

Unknown verb → look it up first in the `specnaut` skill's **Retired addresses** table: a verb
retired from this router, or one from before it existed, is answered with where it went. Any other
unknown verb → print the verb table and stop.

## Which skill owns what

| Skill | Owns |
| :--- | :--- |
| `/task` | one unit of work — from backlog item to merged branch, audits included |
| `/specnaut` | the framework itself — its documentation, what is installed, upgrading it |
| `/ship` | production — getting a built thing out the door |

## All backlog writes go through the Product Owner

The product owner proposes; a bundled executor applies. Every create, edit, move and close —
including the ones `plan` makes — follows `backlog.md`'s "The session protocol" (`read-items.sh`, the
dispatch, `apply-plan.sh`), its one home;
`merge`'s close after a push is the one write it names itself (`phases/merge-close.md`). The
read-only scripts (`list.sh`, `view.sh`) may be run directly. The product owner decides what its
"What you decide" section lists: the session neither asks the user those calls nor makes them
(`backlog.md`, step 2).

<!-- BEGIN: spec-autogen=on -->
## Auto-generate a task's spec at creation (cloud, opt-in)

This project has `spec_autogen: true` and stores its specs on SpecNaut Cloud. After every
item `/task add` creates, also generate its spec — read `spec-autogen.md` and follow it.
<!-- END: spec-autogen=on -->

## Routing

1. **Read** the verb's reference file from the table, with the `Read` tool.
2. **Read the project addendum** `.specnaut/addenda/task/<verb>.md` if it exists, for `plan`,
   `implement`, `review`, `merge`, `audit`, `constitution` and `groom` — the project's own
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
- The verb is not chainable → stop. Chainable verbs: `plan`, `implement`, `review`.
- Otherwise → read `phases/auto-chain.md` and follow it.

**Re-entry needs no flag.** Whether a verb invoked directly chains is decided by the re-entry table
in `phases/auto-chain.md`, from git and the item's state.

## Overview

```
/task add → /task plan <id> → implement → review → merge
                 ▲                         │        ▲
                 │                         └────────┘
                 └── discovery (if fuzzy) → the brief (or --full)
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
