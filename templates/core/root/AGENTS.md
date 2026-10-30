# AGENTS.md — Project Context

> Read this first. It holds the project's working context — its stack, its conventions, and how
> the agents here work. The rules every change is held to are in `docs/constitution.md`.

<!-- --- Specnaut: constitution --- -->

## Constitution

*Owned by Specnaut — this section is not a placeholder to fill in. Edit the rest freely.*

Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

@docs/constitution.md

It holds the principles every plan, change and review is checked against, and it is the team's
document. When a request conflicts with it, stop and ask which one gives way — never work around
it, and never amend it to fit. Claude Code loads it into every session, so it imports no other
file, and a change to it is reviewed like code.

<!-- --- End Specnaut: constitution --- -->

## Tech stack

_(Describe your stack here — languages, frameworks, databases, deployment targets.)_

## Architecture rules

_(These live in `docs/constitution.md`, so there is one place to write a rule. Add here only how
this codebase applies them — where each layer sits, which module owns what.)_

## Conventions

_(Naming, testing, commits, branches.)_

<!-- --- Specnaut: chain-stops --- -->

## The Specnaut chain runs on autopilot after the plan

*Owned by Specnaut — this section is not a placeholder to fill in. Edit the rest freely.*

Specnaut builds **long-lived** software — clean, SOLID, secure by default — and a technical decision
is taken against that intent by whoever is expert in it, not handed back to the user.

`plan → implement → review → merge → push`. It stops at most once by default:

1. **The end of `plan`** — only to ask what only the user can answer: business rules, scope, and
   anything irreversible, destructive, public-breaking or costly. Architecture, security and
   performance forks are settled by the expert seats (`architect-expert`, `security-expert`,
   `performance-expert`) and reported, never put to a vote. Nothing open → no stop.
2. **The review verdict — only under `merge: manual`** in `.specnaut/workflow.yml`, or when the
   run says so (`--manual-merge`, "stop before merging"). Asked once, naming the word to reply:
   `merge`; that reply covers the push. Otherwise the chain merges, pushes and closes the item
   without asking.

Every other boundary is crossed by **invoking the next phase yourself, in the same turn** — your own
next action, never a command printed for someone to paste:

| Boundary | What happens |
| :--- | :--- |
| last question answered → `implement` | invoked in the same turn |
| gates green, tree frozen → `review` | invoked in the same turn |
| `review` verdict, nothing CRITICAL/HIGH left → `merge` → push | same turn (`auto`) · **STOP** — the merge request (`manual`) |
| `merge` lands → push | never asked, in either mode |

**Genuinely blocked is not the same as stopped.** If something truly blocks part of the work, say
what is blocked in one or two sentences, implement everything that is not blocked, and name the
remainder. Stopping with nothing built is reserved for the case where proceeding under any
assumption would be unsafe or would make the work useless if wrong. "I would like confirmation" is
not that case.

**Only a CRITICAL or HIGH finding buys another fix cycle**; MEDIUM and LOW go to the backlog and the
branch ships. Those cycles run before the merge — don't ask again between each one.

**`merge` and the push are automatic** under `merge: auto`, the default — the plan stop was the
approval, and it is not re-collected. Under `manual` the merge is asked for once, **unless the user
already said to merge**: that is their instruction, followed without a second confirmation.
**The file is enforced, not just read**: under `merge: manual` a hook holds every landing on the base
branch until the user's own prompt in that turn says `merge` — a "yes", or a "merge it" from an
earlier turn, does not release it. When the hook refuses, say what to type; never route around it.

<!-- --- End Specnaut: chain-stops --- -->

## Project-specific gotchas

_(Sharp edges new contributors must know.)_

<!-- --- Specnaut: ui-defaults --- -->

## UI defaults

*Owned by Specnaut — this section is not a placeholder to fill in. Edit the rest freely.*

**Any UI you build — web or native — follows the `mobile-first-contract` skill.**
Read it; never restate it here. It is a **default, not a mandate**: a project
whose target surface is genuinely narrower says so once, in `.specnaut/ui.yml`,
and is not asked again.

<!-- --- End Specnaut: ui-defaults --- -->

<!-- --- Specnaut: response-style --- -->

## Response style

*Owned by Specnaut — this section is not a placeholder to fill in. Edit the rest freely.*

**How you answer — brevity, visual order, how a question is put, and what a badge colour
means — follows the `response-style-contract` skill.** Read it; never restate it here.
It is in force on **every** turn, not only when a skill or an agent is involved.

<!-- --- End Specnaut: response-style --- -->

<!-- --- Specnaut: phase-addenda --- -->

## Project addenda to Specnaut phases

*Owned by Specnaut — this section is not a placeholder to fill in. Edit the rest freely.*

**Whenever you run one of these, however it was reached** — a router, a per-phase command or
workflow, a chained step — read its addendum if the file exists:

| What runs | Its addendum |
| :--- | :--- |
| `plan`, `implement`, `review`, `merge`, `audit`, `constitution`, `groom` | `.specnaut/addenda/task/<name>.md` |
| `tag`, `release` | `.specnaut/addenda/ship/<name>.md` |
| `doc`, `list`, `upgrade` | `.specnaut/addenda/specnaut/<name>.md` |

So `/task plan` reads `.specnaut/addenda/task/plan.md`, and so does any older router that still runs
a `plan` phase. It is this project's own addition to that phase. It adds to the phase at the step it
names and never replaces or skips a bundled step: where it contradicts one, the bundled step stands
and you say so. No file means no addendum — say nothing about it.

<!-- --- End Specnaut: phase-addenda --- -->

<!-- --- Specnaut: agent-dispatch --- -->

## Dispatching Specnaut agents

*Owned by Specnaut — this section is not a placeholder to fill in. Edit the rest freely.*

**Dispatch a Specnaut agent by its name, never by describing the task.** On Claude Code that is
`Task(subagent_type: "<name>")`; on Codex, `spawn_agent(agent_type="<name>")`. A child started
from a description selects no role: it runs without that agent's instructions and, on Codex, on
the primary session's model.

Each step of the chain that delegates names its agent:

| Step | Agent |
| :--- | :--- |
| `plan` — the architecture audit | `architect-expert` |
| `plan` — the security audit | `security-expert` |
| `plan` — the performance audit, when the plan has a hot path | `performance-expert` |
| `review` — the seats, dispatched from the main session | `code-reviewer`, `security-expert`; `accessibility-expert`, `dependency-expert`, `performance-expert` when their signal selects them |
| every backlog write — create, clarify, move, close | `product-owner` |

Each name is the `name` of an agent Specnaut scaffolded for your harness.

<!-- --- End Specnaut: agent-dispatch --- -->

<!-- --- Specnaut: backlog --- -->

## Backlog

*Owned by Specnaut — this section is not a placeholder to fill in. Edit the rest freely.*

<!-- BEGIN: backend=local -->
The backlog is managed through the `task` skill — local Markdown backend, indexed in
`.specnaut/backlog.md`.
<!-- END: backend=local -->
<!-- BEGIN: backend=github -->
The backlog is managed through the `task` skill — GitHub Issues and a GitHub Project, configured
in `.specnaut/backlog-config.yml`.
<!-- END: backend=github -->
<!-- BEGIN: backend=gitlab -->
The backlog is managed through the `task` skill — GitLab Issues, configured in
`.specnaut/backlog-config.yml`.
<!-- END: backend=gitlab -->
<!-- BEGIN: backend=cloud -->
The backlog is managed through the `task` skill — Specnaut Cloud, configured in
`.specnaut/backlog-config.yml`.
<!-- END: backend=cloud -->

**Backlog references** follow the `backlog-reference-contract` skill — read it; never restate it here.

<!-- --- End Specnaut: backlog --- -->

<!-- --- Specnaut: optional-integrations --- -->

## Optional integrations

*Owned by Specnaut — this section is not a placeholder to fill in. Edit the rest freely.*

Specnaut configures no harness feature beyond what it scaffolds; the ones that pair well with this
workflow are documented for Claude Code and Codex only — on another harness, see its own docs.

<!-- BEGIN: harness=claude -->
Claude Code features that pair well with this workflow — `/loop`, `/goal`, `claude agents`, headless
runs, MCP servers — are in `.claude/skills/specnaut-facts/integrations.md`; read it when asked.
<!-- END: harness=claude -->
<!-- BEGIN: harness=codex -->
Codex features that pair well with this workflow — `/goal`, the CLI reference — are in
`.agents/skills/specnaut-facts/integrations.md`; read it when asked.
<!-- END: harness=codex -->

<!-- --- End Specnaut: optional-integrations --- -->
