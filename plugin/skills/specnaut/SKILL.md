---
name: specnaut
description: The Specnaut framework itself — `/specnaut doc` explains how it works, `/specnaut list` shows the skills and agents installed in this project, `/specnaut upgrade` updates the binary and the project's Specnaut files. Work on the project goes through `/task`; production through `/ship`.
argument-hint: <doc|list|upgrade> [args]
when_to_use: |
  Trigger phrases that should route here:
  - doc: "how does specnaut work", "explain specnaut", "what is /task"
  - list: "which skills are installed", "list the specnaut agents"
  - upgrade: "upgrade specnaut", "update the specnaut templates", "get the latest specnaut"
---

# Specnaut router

**Response style** — brevity, visual order, questions as selections, badge colours — follows the `response-style-contract` skill; read it, never restate it here.

`$ARGUMENTS` carries the user's input. The first token is the verb; everything after it is the
verb's argument string. Nothing → render the verb table below and stop.

## Verbs

| Verb | Reference | One-liner |
| :--- | :--- | :--- |
| `doc [topic]` | `phases/doc.md` | How Specnaut works, its commands, harnesses and backends. |
| `list` | `phases/list.md` | The skills and agents installed in this project, from `.specnaut/installed.lock`. |
| `upgrade` | `phases/upgrade.md` | Update the `specnaut` binary if a newer one is out, run `specnaut upgrade`, verify, commit. |

All three are one-shot; none chains.

## Which skill owns what

| Skill | Owns |
| :--- | :--- |
| `/task` | one unit of work — from backlog item to merged branch, audits included |
| `/specnaut` | the framework itself — its documentation, what is installed, upgrading it |
| `/ship` | production — getting a built thing out the door |

## Routing

1. **Read** the verb's reference file with the `Read` tool.
2. **Read the project addendum** `.specnaut/addenda/specnaut/<verb>.md` if it exists — the
   project's own addition to that verb. It adds to the phase at the step it names and never replaces
   or skips a bundled step: where it contradicts one, the bundled step stands and you say so. No
   file means no addendum — say nothing about it.
3. **Execute** the procedure end-to-end, with the addendum applied.

## Retired addresses — this is deliberate, not a gap

If the user names a verb or skill below, **do not run it, and do not improvise the old behaviour**.
Print the one line naming its new address, then stop. A bare "unknown verb" reads as a bug to
someone following an instruction written before the move, which is exactly who arrives here.

| Retired address | New address |
| :--- | :--- |
| `/specnaut plan` | `/task plan` |
| `/specnaut tasks` | `/task tasks` |
| `/specnaut implement` | `/task implement` |
| `/specnaut review` | `/task review` |
| `/specnaut merge` | `/task merge` |
| `/specnaut constitution` | `/task constitution` |
| `/specnaut audit` (any axis or spelling) | `/task audit` (`--security`, `--archi`, `--perf`, `--a11y`, `--deps`) |
| `/specnaut tag-version` | `/ship tag` |
| `/specnaut release-version` | `/ship release` |
| `/board` | `/task` (`list`, `next`, `add`, `close`, `groom`, …) |
| `/board update` | `/task edit` |
| `/code-audit` | `/task audit` |
| `/sec-audit` | `/task audit --security` |
| `/arch-audit` | `/task audit --archi` |
| `/perf-audit` | `/task audit --perf` |
| `/a11y-audit` | `/task audit --a11y` |
| `/dep-audit` | `/task audit --deps` |

The line to print: "`<retired>` moved to `<new>`." — then stop.

`/board` and the `*-audit` skills are no longer installed, so the harness itself answers them as
unknown; their rows are here so a reader looking for them finds the new address.

| Gone without a successor address | Where its work happens now |
| :--- | :--- |
| `brainstorm` | `/task plan`, step 1 — the discovery dialogue when the input is too fuzzy to plan. |
| `specify` | `/task plan` — the same document, sections 1–4. |
| `clarify` | `/task plan`, step 8 — questions asked at the stop, before any code exists. |
| `analyze` | Replaced, not moved: the plan-time architecture and security audits run *before* the code. |
| `checklist` | `/task plan`'s success criteria and decision table. |
| `list-skills` | `/specnaut list`. |
