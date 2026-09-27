# Upgrading Specnaut

## 4.4.x → 4.5.0

### Add to a bundled phase without preserving it

A `/specnaut` or `/ship` phase now reads an optional **phase addendum** — a file your project owns
at `.specnaut/addenda/<skill>/<phase>.md`, e.g. `.specnaut/addenda/ship/release.md` for
`/ship release`. It adds to the phase at the step it names; it cannot replace or skip a bundled
step. The README's "Adding to a bundled phase without preserving it" covers the format and when a
full preserve is still the right tool.

`specnaut upgrade` delivers the instruction to your `AGENTS.md` as a fourth fenced block, grafted in
like the other three and printed by name:

```markdown
<!-- --- Specnaut: phase-addenda --- -->
```

It exists for the surfaces that reach a phase without going through a router — a per-phase workflow,
a stale plugin router. Nothing else changes, and nothing is created under `.specnaut/addenda/`: with
no addendum, a phase runs exactly as before.

**If you preserved a phase doc only to add to it**, you can move off the preserve:

1. `specnaut diff <path>` on the phase doc. If every difference is an addition of yours, it fits an
   addendum; if you changed or removed a bundled step, keep the preserve.
2. Move your additions into `.specnaut/addenda/<skill>/<phase>.md`, naming the step each one belongs
   to.
3. Remove the path from `.specnaut/preserve.yml`, delete the phase doc, and run `specnaut upgrade` —
   a deleted bundled file that is no longer declared comes back at the current version, and receives
   every later refresh.

## 4.0.x → 4.1.0

### `backlog-config.yml` no longer carries `project_node_id` / `status_field_id`

`specnaut init --backlog github` used to generate two extra keys with a comment saying they were
"cached on first run", and the board skill documented a PO that would refresh them automatically
when blank.

**Nothing ever implemented that.** A sweep of the whole repository found writers of the literal
empty string and the claim itself — no reader of either key, and nothing that would ever populate
one. Both keys are removed from the generated stub and from the documentation.

**An existing `backlog-config.yml` carrying them needs no edit.** The keys were inert, the config
reader only extracts `repo` and `project_number`, and an unrecognised key is ignored. Delete them or
leave them; the behaviour is identical either way.

The worked example's `project_number` is now a `<N>` placeholder rather than an integer, so it
cannot be copied as a working value, and the block names `gh project list --owner <org>` as the way
to resolve the real one.

## 3.2.x → 4.0.0

### `/backlog` is now `/board`

The skill drives all five status columns, but it was named after one of them. `/backlog close` on a
card sitting in **In review** read as a category error, and the bundled `backlog.md` said so against
itself: it describes "the 5 status columns" and then names the first one **Backlog**.

`board` is not new vocabulary — it is the word the skill's own prose already used everywhere ("board
drift", "reconcile the board", "any board audit"). Only the command changed to match.

| Before                    | After                   |
| :------------------------ | :---------------------- |
| `/backlog`                | `/board`                |
| `/backlog groom`          | `/board groom`          |
| `.claude/skills/backlog/` | `.claude/skills/board/` |

**`specnaut upgrade` does the whole migration.** The old skill files are removed, the new ones
added, and the emptied `backlog/` directory is pruned — no leftover folder, no manual step. A
customized `SKILL.md` is orphan-preserved and left for you to reconcile.

Upgrading from 3.2.0 reports **2 added, 5 removed**. The five are the two board skill files under
their old name, the two command shims below, and the retired `groom` router phase — so
`.claude/commands/` disappears during _this_ upgrade. That is expected; commit it.

**There is no `/backlog` alias.** The `.claude/commands/` shims were removed in the same development
cycle and reach you in this release; adding an alias now would rebuild one, for the reason they were
deleted: a second surface that has to be kept in agreement with the skill it fronts, and drifts the
moment it is not.

### What did _not_ change

The word "backlog" still names the set of work items, so everything storing them keeps it:
`backlog_backend` in `.specnaut/installed.lock`, the `--backlog` and `--backlog-url` flags,
`.specnaut/backlog.md`, `.specnaut/backlog/NNN-*.md`, `.specnaut/backlog-config.yml`, and
`.specnaut/scripts/backlog/`. No lock migration, no flag change. Only the command you type moved.

## 2.1.x → 3.0.0

### Two agents are renamed

| Before            | After                  |
| :---------------- | :--------------------- |
| `a11y-expert`     | `accessibility-expert` |
| `specnaut-expert` | `specnaut-guide`       |

`a11y-expert` was the only agent in the fleet that abbreviated its domain — its four siblings are
`architect-expert`, `dependency-expert`, `performance-expert`, `security-expert`. The abbreviation
costs twice: a reader who does not know the numeronym cannot guess the name, and a model matching a
request against agent descriptions gets a far weaker signal from `a11y` than from `accessibility`.
The audit **skill** stays `/a11y-audit`, and that asymmetry is deliberate — a skill name is typed by
a human, where short wins; an agent name is matched semantically by a model, where the full word
does.

`specnaut-expert` was the only `-expert` that is not a review lens. In this fleet the suffix means
"has a `/specnaut audit <domain>` phase", which this agent does not and should not have — it answers
questions about Specnaut, it does not review your code. `specnaut-guide` says that.

**The issue label is now `from:specnaut-guide`.** It routes the maintainer triage inbox. The
previous entry claimed the old spelling was stamped on filed issues and that renaming would mean
rewriting them — neither was true: no issue has ever carried any spelling, because the label named
in the prefill did not exist on the repo and GitHub drops unknown labels silently.

### Every bundled agent is now Opus, at `high` or `xhigh`

Previously the fleet mixed Sonnet and Opus across four effort tiers. It is now uniformly
`model: opus`, with `effort: high` as the floor and `xhigh` for exactly two seats:
`architect-expert` and `security-expert`.

The old rubric put review lenses at `medium` and orchestrators at `low`. Both were wrong in the same
way: **an under-provisioned review lens fails quietly.** It returns a well-formatted report with
fewer findings, which is indistinguishable from clean code — no error, no retry, nothing downstream
notices. The saving was visible and the cost was not.

`xhigh` is reserved for the two seats whose misses are _unrecoverable_, not for the ones doing the
hardest work. Ask what catches an agent that thinks too little: a shallow pass by `developer` meets
a test suite, a review gate, and a human reading the diff. Nothing checks `security-expert` — a
clean report is indistinguishable from clean code — and a missed layering violation is load-bearing
by the time anyone notices.

This costs more per run. If that is not the trade you want, both fields are plain frontmatter — edit
them in your own `.claude/agents/`, and note that doing so marks the file customized, so `upgrade`
will stop refreshing it.

### Codex agents now pick a GPT-5.6 model, and finally honour `effort:`

Two things were wrong on the Codex harness, and the second was hiding behind the first.

`model_reasoning_effort` was derived from the agent's **`model:`** tier — `opus` → `high`, `sonnet`
→ `medium` — and the `effort:` field was never read at all. That produced a plausible spread only
while the fleet was split across Sonnet and Opus. The all-Opus retune above would have collapsed
every one of the fifteen agents onto `high`, and the five `xhigh` seats would have lost their budget
on Codex with no error and nothing in the emitted TOML to show it.

`effort:` is now read directly. Specnaut's vocabulary — `low`, `medium`, `high`, `xhigh` — is a
strict subset of Codex's own, so it passes through verbatim.

That frees `model:` to do what it was named for. A Codex subagent TOML accepts a `model` key, so the
capability tier now picks one:

| Specnaut | Codex                                                 |
| :------- | :---------------------------------------------------- |
| `opus`   | `gpt-5.6-sol` — complex, open-ended, high-value work  |
| `sonnet` | `gpt-5.6-terra` — the everyday all-rounder            |
| `haiku`  | `gpt-5.6-luna` — clear, repeatable, high-volume tasks |

The same ids work whether Codex is signed in with ChatGPT or with your own API key.

**One behaviour change to know about.** An agent of your own that declares `model:` but no `effort:`
used to inherit an effort guessed from its tier; it now omits the key and inherits the parent Codex
session's setting instead. Deriving a reasoning budget from a model name was always the wrong
signal. Add an explicit `effort:` to any agent where the budget matters.

Nothing pins a model id anywhere else in Specnaut, so the GPT-5.4 retirement on 31 August 2026 needs
no action from you.

### Antigravity projects were installable but not upgradable

Three defects, found by auditing every harness's agent path end to end.

**`specnaut init --ai antigravity` wrote a lock that `specnaut upgrade` then refused to read**,
crashing with an unhandled `Unsupported harness 'antigravity'`. The CLI kept two hand-maintained
lists of harnesses; the picker's included Antigravity and the lock's did not. Install succeeded,
`check` reported all-clear, and the project was a dead end. They are now one list, with a test that
round-trips every registered harness through the lock.

**The output tree was `.agent/`; Antigravity reads `.agents/`.** Agents, skills, workflows and
phases all moved. Antigravity keeps backward support for `.agent/rules`, but `.agents/` is the
documented default for everything else. An existing Antigravity project should delete the stale
`.agent/` tree after upgrading — nothing removes it for you, because `upgrade` tracks paths, and
from its point of view these are simply new ones.

**Agent frontmatter now carries `subagent: true` and a translated model.** Without the flag
Antigravity discovers an agent file but the primary agent cannot reach it through `invoke_subagent`
— the seat scaffolds and is then undispatchable, which is indistinguishable from a working install.
And the `model:` tier was copied verbatim, so agents shipped as `model: opus`, a value Antigravity
has no meaning for; its vocabulary is `inherit | flash | pro`, and the capable tiers now map to
`pro`.

None of this affects the other six harnesses.

### The naming convention is now written down

`.claude/agents/README.md` gained a suffix table: `<domain>-expert` for a lens that also has an
audit phase, `<domain>-reviewer` for a lens that only ever sees a diff, `-coordinator` for a
single-phase fan-out, `-manager` for a multi-phase delivery, and a plain role noun for agents that
do the work rather than judge it. The rule that matters when you add one: **`-expert` ⇔ an audit
phase exists.** Give `code-reviewer` an audit phase and you rename it in the same change, or the
suffix stops predicting anything.

The convention had been followed consistently for a year without ever being stated — which is
exactly how conventions die.

### What `upgrade` moves, and what it cannot

`specnaut upgrade` moves the two agent files for you. **What it cannot move is your own writing**:
if you reference either agent by name in your `AGENTS.md`, your own skills, a script, or a saved
prompt, update it. There are no aliases — an unknown agent name fails at dispatch time, not at
scaffold time, so a stale reference stays silent until the moment you need the seat.

If you kept a local copy of either agent (a `preserve.yml` entry, or a file `upgrade` reports as
customized), the rename lands as a **new** path and your copy stays behind under the old one. Move
your customisation across yourself, and re-point the `preserve.yml` entry — otherwise the old path
protects a file nothing reads, and the new path is left unprotected.

## 2.0.x → 2.1.0

> This release renames the five expert agents. `specnaut upgrade` moves the files for you; it cannot
> update references you wrote yourself, and there are no aliases — a stale name fails at dispatch
> time, not at scaffold time. If you read one section below, read that one.

### The architect now reads a catalogue before it judges

`specnaut upgrade` adds `.specnaut/memory/architecture/` — an offline catalogue with one file per
code smell, refactoring technique and design pattern, plus a hub file for layering and SOLID. It
sits beside the security knowledge base that already shipped, and needs nothing from you.

What changes is the agent's obligation. `architect-expert` now has a mandatory Step 0: read the
index, then **open the leaf for every item it names in the report** — not for every candidate it
considered — read the _When it is NOT a smell_ section looking for the reason it is wrong, cite the
leaf in the finding, and state which leaves it read. A named smell with no leaf behind it is
downgraded by the agent itself.

The point is narrow and worth stating plainly: an optional lookup does not happen. A catalogue an
agent _may_ consult produces findings built from vocabulary rather than from method — the right
technical word attached to the wrong diagnosis, delivered with full confidence, and expensive
precisely because it reads as expert.

The catalogue is Specnaut-owned, so `upgrade` keeps it current. If you want to add project-specific
entries, put them in your own file and reference it from `AGENTS.md` rather than editing a leaf — an
edited leaf becomes a customized file that `upgrade` will stop refreshing.

### Accessibility gets a catalogue too, keyed to WCAG

`specnaut upgrade` adds `.specnaut/memory/a11y/` — a triage gate plus ten files grouped by the
surface under review: images, structure, forms, keyboard, ARIA, contrast, zoom and reflow, media,
navigation, and live regions. Every failure mode inside a file names the WCAG 2.1 success criterion
it violates, and `a11y-expert` now has to open the file for the surface it is reviewing and cite the
criterion in the finding.

The layout is deliberately not the architecture catalogue's. Accessibility is the one axis entered
by one key and left by another: you arrive from "this diff touches a form" and you leave at "3.3.2
Labels or Instructions". The grouping follows the way in; the criteria inside each file, and the
index in its `README.md`, keep the way out addressable.

No W3C text is reproduced — the files describe the mechanism and link to the specification. The
front-end gate still runs first, so on a repo with no front-end surface `a11y-expert` stops before
it reads anything.

### The remaining seats are grounded without a new catalogue

Not every seat needed one, and two deliberately did not get one.

- **`security-expert`** — the domain files it already read gained a _When it is NOT a finding_
  section, and the seat must read it for every finding it ships. Every file has one except
  `00-triage.md`, which is that same gate in its general form.
- **`dependency-expert`** — pointed at `.specnaut/memory/security/06-supply-chain-and-integrity.md`,
  which already covered its ground and which the seat was not reading. A parallel catalogue would
  only have created a second source free to drift from the first.
- **`performance-expert`** — grounded in your project rather than in a document: the budgets your
  constitution declares, and whatever benchmark or profile the repo actually holds. No
  stack-agnostic normative source exists for performance, and inventing one would have produced
  exactly the vocabulary-shaped findings this programme exists to remove. The seat now also has to
  answer whether it measured anything before it ships a finding.

All three, and `a11y-expert` with them, carry the same two rules that need no catalogue: a finding
it cannot cite is **downgraded by the agent itself and labelled a suspicion**, so it cannot fail a
gate on its own; and the report **states which sources were read**, once, at the top — a skipped
read is otherwise invisible, and you cannot tell a judgement from a guess.

Nothing here changes how you invoke anything.

### The five auditor agents are now experts

`auditor` described one dispatch shape out of several. These seats are also asked for their
expertise on a **plan**, before any code exists — `/specnaut plan` has always done this at step 6,
mandatorily — so the name described the narrower half of what they do.

| Before                 | After                |
| :--------------------- | :------------------- |
| `architecture-auditor` | `architect-expert`   |
| `security-auditor`     | `security-expert`    |
| `performance-auditor`  | `performance-expert` |
| `a11y-auditor`         | `a11y-expert`        |
| `dependency-auditor`   | `dependency-expert`  |

`specnaut upgrade` moves the agent files for you. **What it cannot move is your own writing**: if
you reference an agent by name in your `AGENTS.md`, your own skills, a script, or a saved prompt,
update it. There are no aliases — an unknown agent name fails at dispatch time, not at scaffold
time, so a stale reference stays silent until the moment you need the seat.

The audit **skills** keep their names — `/arch-audit`, `/sec-audit`, `/perf-audit`, `/dep-audit`,
`/a11y-audit`. They genuinely run audits; it was only the seats that were misnamed.

If you kept a local copy of one of these agents (a `preserve.yml` entry, or a file `upgrade` reports
as customized), the rename lands as a **new** path and your copy stays behind under the old one.
Move your customisation across yourself, and re-point the `preserve.yml` entry — otherwise the old
path protects a file nothing reads, and the new path is left unprotected.

### The architect and the security expert now declare a plan mode

Both agents gained a third mode describing the plan-time dispatch `/specnaut plan` already
performed. Previously they were handed a plan document while their own definition offered only
"review the files provided" or "audit the whole codebase" — neither of which fits a document that
describes code that does not exist yet.

Nothing changes in how you invoke them. The findings get better because the seat now knows which
question it is being asked.

### `upgrade` no longer calls a skipped file a success

A file whose contents diverge from the recorded baseline is preserved rather than overwritten. That
is unchanged and correct. What was wrong is that the summary called every such file _customized
locally_ and closed with a green tick, so a file that had silently missed a published update looked
exactly like one you had deliberately edited.

The two are not distinguishable by content, and this release does not pretend otherwise. What it
reports instead is **age**. When a file diverges from the current template _and_ its lock entry
never caught up to a later release, `upgrade` lists it under **customized, and behind**, grouped by
the version and date it was last written:

```
last written by v1.12.0 on 2026-05-26 — every upgrade since has skipped these 3:
  ⚠ .claude/agents/README.md
      specnaut reconcile .claude/agents/README.md --accept-upstream
```

The grouping matters more than it looks. Files rarely drift one at a time — a repo-wide rename
strands a whole set at the same version on the same day, and seeing the shared freeze point names
the event that caused it. A flat list repeating the same date on every line hides it.

Each path carries the `specnaut reconcile … --accept-upstream` command for that path, and the run
now ends on a warning line instead of an unqualified tick. A file you edited yourself that has
nothing published against it stays quiet: it has missed nothing, and warning about it would train
you to skip the section that matters.

You do not have to act on any of this. Nothing is overwritten, and a path you declared in
`preserve.yml` is never listed — you already said that file is yours.

## 1.x → 2.0.0

### At a glance

| Before                                                | After                                                 |
| :---------------------------------------------------- | :---------------------------------------------------- |
| 9 chainable phases                                    | **5** — `plan → tasks → implement → review → merge`   |
| 5 chain flags                                         | **1** — `--manual`                                    |
| up to 8 files per feature                             | **2** — `plan.md` + `tasks.md`                        |
| stops when clarification is needed, then before merge | **exactly 2** — end of `plan`, and the review verdict |

Run `specnaut upgrade` in each scaffolded project; it removes the files this version no longer
ships. Nothing migrates your existing spec directories — they are left on disk untouched.

### Phases that no longer exist

An old phase name now prints the phase index and stops. There are no aliases — this is a clean
break.

| Gone                    | Where its work happens now                                                                       |
| :---------------------- | :----------------------------------------------------------------------------------------------- |
| `/specnaut brainstorm`  | `/specnaut plan`, step 1 — the discovery dialogue, run only when the input is too vague to plan. |
| `/specnaut specify`     | `/specnaut plan` — the same document, sections 1–4.                                              |
| `/specnaut clarify`     | `/specnaut plan`, step 8 — questions asked one at a time at the stop, before any code exists.    |
| `/specnaut analyze`     | **Replaced, not moved.** See below.                                                              |
| `/specnaut checklist`   | `plan.md`'s success criteria and decision table.                                                 |
| `/specnaut list-skills` | Read `.specnaut/installed.lock` directly.                                                        |

The chain is now:

```
plan → tasks → implement → review → merge
```

### Flags that no longer exist

`--once`, `--continue`, `--lite` and `--full` are removed, along with the lite-chain concept and the
`lite-heuristic` contract doc. **`--manual` is the only surviving flag.**

Re-entry needs no flag: invoking a phase whose downstream artefacts already exist runs one-shot;
invoking one whose downstream artefacts are absent chains. `workflow_shape` is gone from
`.specnaut/feature.json`; an existing file carrying it is ignored, not an error.

### Artefacts: eight files down to two

A feature now produces exactly `plan.md` and `tasks.md`.

`spec.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/` and `checklists/` are no
longer generated, and `spec-template.md` and `checklist-template.md` no longer ship. Where their
content matters it lives in `plan.md` — the domain model in section 6, interface contracts in
section 8.

**Your existing spec directories are left on disk untouched.** Nothing migrates them, and the `plan`
phase reads whatever is there without failing. Migrate them by hand if you want the new shape, or
leave them; they are a record of work already done.

### What replaces the rigour that was removed

This is the part a shorter phase list hides. `analyze` was **replaced**, not dropped.

With one planning document there are no artefacts left to hold in agreement, so a cross-artefact
consistency check has nothing to check. Its successor runs _earlier_ and costs less:

- **A binding decision table** in `plan.md` — every rule the feature introduces, its **single home**
  (a file path, never a layer), and what would count as a second spelling. The implementer may not
  move a decision out of its home without the plan being amended first.
- **Two audits of the plan itself**, dispatched concurrently **before a line of code exists** —
  `architect-expert` and `security-expert`. Their findings are written back into `plan.md`: either
  the plan changes, or it records why the objection was accepted.

Architecture found at review time is architecture rebuilt. This moves that discovery to where
changing your mind is still free.

### Two stops, and no third

The chain stops at exactly two points: the **end of `plan`**, where you approve the architecture and
answer the open questions, and the **review verdict**, which _is_ the merge request. Every other
boundary is crossed automatically.

Only a CRITICAL or HIGH finding buys another fix cycle; MEDIUM and LOW go to the backlog and the
branch ships.

### Merge now squashes by scope

`/specnaut merge` performs the squash itself: **one commit per scope**, not one per branch. The
feature, its generated artefacts, unrelated configuration, docs, and any fix to a pre-existing
defect each get their own commit — the last one carrying **its own** backlog id, not the feature's.

If your default branch is protected, the local fast-forward path will not work; the phase does not
implement a forge-side path.

### `AGENTS.md` on upgrade

`AGENTS.md` is yours. `specnaut upgrade` does not rewrite it, and does not reorder it. But the
two-stop rule above only works from a file that is always in context, so the one section Specnaut
owns is delivered as a fenced block:

```markdown
<!-- --- Specnaut: chain-stops --- -->

## The Specnaut chain has exactly two stops

...

<!-- --- End Specnaut: chain-stops --- -->
```

Appended to the end if your file has no such block; replaced in place if it does. Everything around
it stays byte-identical, the fences are Markdown comments so nothing renders, and the run prints one
line naming what it did. Re-running changes nothing. Delete the block and the next upgrade restores
it — that is the only section on the file Specnaut claims.

Declaring `AGENTS.md` in `.specnaut/preserve.yml` freezes it completely: the section is not
delivered either, and `--force` does not change that. `--reset-preserved` is the only way through.

One related fix: an upgrade no longer records a pre-existing `AGENTS.md` in
`.specnaut/installed.lock`. It used to adopt the file it had just decided not to write, which made
every later run report your own document as "customized locally" — and let `--force` replace it with
the template.
