# Upgrading Specnaut

## 7.0.x → 7.1.0

Run `specnaut upgrade`. You act by hand only if you edited `.claude/CLAUDE.md`.

### One instruction file: `AGENTS.md`

`.claude/CLAUDE.md` and `.codex/AGENTS.md` are now relative symlinks to `../AGENTS.md`, so Claude
Code and Codex both load the project's root `AGENTS.md`. Where the system refuses symlinks, each is
a one-line pointer file instead (`@../AGENTS.md` on Claude Code). `init` and `upgrade` say which
form they wrote.

**If you edited `.claude/CLAUDE.md`, `upgrade` replaces it with the link** and backs your copy up to
`.claude/CLAUDE.md.specnaut.bak`. The report lists it under "replaced with a link to AGENTS.md".
Your old text is no longer loaded. Move whatever you still need into `AGENTS.md`, outside the
sections marked as owned by Specnaut. Do not copy the backup back over the link. To keep your old
file instead, list `.claude/CLAUDE.md` in `.specnaut/preserve.yml` before you upgrade.

On a clone made with `core.symlinks=false`, git checks the link out as a small text file, and
`upgrade` may show a type change there. Either form loads the same file, so you can commit whichever
git gives you.

### Codex: `goal.md` is retired, and agents are enabled

- `.codex/goal.md` is no longer shipped. Codex's `/goal <objective>` never read it. An untouched
  copy is removed. A copy you edited is kept, and the report names it.
- The `[agents]` block in `.codex/config.toml` gains `enabled = true`, so Codex can start the
  Specnaut agents by name. If you own the `[agents]` table yourself, it is left alone and the report
  lists the keys to add by hand.

## 6.x → 7.0.0

Run `specnaut upgrade`. Most projects need nothing else. You act by hand only if you edited one of
the retired files, or if your own docs or scripts invoke a retired command.

### The second, derived workflow is retired

Specnaut used to ship two workflows for the same job. 7.0.0 keeps only its own:
`plan → tasks → implement → review → merge`. These are no longer shipped:

- the skills `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`,
  `requesting-code-review`, `verification-before-completion` and `using-specnaut`;
- `.specnaut/harness-tools.md`;
- the phases `/specnaut audit security|performance|accessibility|architecture|dependencies`.

`specnaut upgrade` deletes every copy you never edited and drops it from the lock. A copy you did
edit is kept and listed under "removed but customized (not touched without --force)". Delete it
yourself, or run `specnaut upgrade --force`, which moves it aside to `<file>.specnaut.bak` first.

### Audits: use the per-axis skills

`/specnaut audit <axis>` now answers with a notice instead of running. The same experts are reached
through `/sec-audit`, `/perf-audit`, `/a11y-audit`, `/arch-audit` and `/dep-audit`, or `/code-audit`
for every axis at once. These return their findings inline. `/code-audit` can still save a dated
report under `docs/specnaut/audits/`.

### Plugins inject nothing at session start

The Claude Code, Cursor and OpenCode plugins no longer inject a bootstrap skill when a session
starts. Skills and agents are still discovered from the plugin. Update the plugin the way your
harness does. On Cursor, updating also removes a session hook that ran a script by a path relative
to the working directory.

## 5.5.x → 6.0.0

Only projects installed for **Windsurf** need to act. Every other harness upgrades as usual.

### Windsurf is no longer supported

5.5.0 is the last release that installs Windsurf. From 6.0.0, `specnaut upgrade`, `diff`,
`reconcile` and `check` on a Windsurf project exit 1 with:

```
error: this project was installed for windsurf, which Specnaut no longer supports (5.5.0 was the last release to install it). Nothing was changed.
```

Nothing in the project is touched — not `.windsurf/`, not `.specnaut/installed.lock`, not your own
files. To keep using Specnaut, switch the project to a supported harness:

```bash
specnaut init --here --force --ai <claude|cursor|codex|copilot|opencode|antigravity>
```

`--force` is needed because the shared `.specnaut/` files the Windsurf install wrote are already
there. Every file it replaces is first backed up to `<file>.specnaut.bak`, so your `AGENTS.md` and
constitution edits are one copy away. `.windsurf/` is left in place; delete it when you no longer
need it.

## 5.2.x → 5.3.0

Nothing to edit by hand. One behaviour changes for every project:

### Reviews hold file sizes, with defaults when your constitution sets none

The review now flags a file that is over its target and grew (HIGH), or that ends over its ceiling
without shrinking (HIGH). The numbers come from the `## Size limits` table in
`.specnaut/memory/constitution.md`. `specnaut upgrade` never rewrites an existing constitution, so
until you add the table the defaults in `.specnaut/memory/size-limits.md` apply: 300 / 500 lines per
file, 30 / 50 per function. To set your own, or opt out with `none`, run `/specnaut constitution` —
it proposes the table — or add it by hand in the shape that file shows.

`.specnaut/scripts/bash/size-ratchet.sh` is new and runs nowhere on its own: Specnaut installs no
git hook. Wire it into your pre-commit runner if you want direct edits held too.

## 5.0.x → 5.1.0

Nothing to edit by hand, but one thing to know: for Claude Code projects, `specnaut upgrade` now
declares a plugin that runs code once someone installs it. The upgrade prints a line for each key it
adds.

### Claude Code projects offer the Specnaut Cockpit

`specnaut upgrade` adds two keys to `.claude/settings.json` for projects scaffolded for Claude Code:

- `extraKnownMarketplaces["specnaut-marketplace"]`: Specnaut's catalog, read from the specnaut-cli
  repository **at the release tag** of the binary that wrote it;
- `enabledPlugins["specnaut-cockpit@specnaut-marketplace"]`.

When someone trusts the project, Claude Code offers to install the marketplace and the cockpit mod.
The mod shows usage limits, context and cost above the prompt, and holds the autopilot cleanly
before it runs out of quota. A mod runs a hooks module inside Claude Code with the user's
permissions. The cockpit's only process is `git rev-parse`, and the only call it ever refuses is the
step that would start a phase past the quota threshold. Each later `specnaut upgrade` re-pins the
marketplace to its own release. See
[`mods/specnaut-cockpit/README.md`](mods/specnaut-cockpit/README.md).

To decline it for a project, set the plugin to `false`:

```json
{ "enabledPlugins": { "specnaut-cockpit@specnaut-marketplace": false } }
```

The merge only adds keys that are absent, so a `false` survives every later `specnaut upgrade`. So
does a marketplace you pointed somewhere else, and the upgrade says so each time. Deleting the key
brings it back on the next upgrade, so use `false` rather than deleting it.

### The Claude Code marketplace installs again

`/plugin install` from the marketplace installed an empty plugin, because the published catalog did
not match Claude Code's format. The catalog is fixed, and the right commands are:

```text
/plugin marketplace add specnaut/specnaut-marketplace
/plugin install specnaut-plugin@specnaut-marketplace
```

## 4.6.x → 5.0.0

**Breaking: `/specnaut` merges and pushes without asking.** A project that relied on the "Ready to
merge?" stop gets the old behaviour back only by adding `merge: manual` to `.specnaut/workflow.yml`
— see below. Nothing else needs a hand edit.

### Technical decisions are no longer put to you

At the end of `plan`, architecture, design patterns, layering, security hardening and performance
trade-offs are now settled by the expert agents — `architect-expert`, `security-expert`, and
`performance-expert` when the plan has a hot path — against Specnaut's intent: long-lived software,
clean, SOLID, secure by default. The plan stop reports what they decided and why; it asks only what
only you can answer — business rules, scope, and anything irreversible, destructive, breaking a
public surface, or bringing in a new external service, vendor or cost. When none of that is open,
there is no stop at all: the plan is reported and the chain goes on. Fix loops in `implement` and
`review` no longer ask you to choose between technical fixes either.

Nothing to do on upgrade: the `chain-stops` block of your `AGENTS.md` is refreshed in place.

### The chain now merges and pushes on its own

`/specnaut` runs on **autopilot** by default. It still stops at the end of `plan` — the
architecture, both audits' findings and the open questions are put to you there, before any code
exists — but after your answers it no longer stops at the review verdict. It implements, reviews,
fixes every CRITICAL or HIGH finding, merges into the base branch, **pushes**, and closes the
backlog item without asking "Ready to merge?" or "Push to origin?".

`specnaut upgrade` adds `.specnaut/workflow.yml` with the default spelled out, and refreshes the
`chain-stops` block of your `AGENTS.md` to match. Nothing else is required.

**If a human must read every change before it lands**, restore the merge stop in one line:

```yaml
# .specnaut/workflow.yml
merge: manual
```

The chain then stops at the review verdict and asks "Ready to merge?" once; a yes covers the merge,
the push and the close. A value the file cannot be read as — a typo — counts as `manual`, so a
broken setting never pushes. For a single run, `--manual-merge` or "stop before merging" in your
request does the same, and `/specnaut merge --pr` still delivers through a pull request.

Two things no longer ask in either mode: the push after a merge, and closing the linked item. A
rejected push is reported and never forced; the item then stays open. A feature delivered across
several branches passes `--no-close` to `/specnaut merge` on every branch but the last — that used
to be a "no" at the close question. Remote mode (`specnaut gate`) still raises its merge-approval
gate.

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

## Older releases

- [2.1.x → 3.0.0 and 3.2.x → 4.0.0](docs/upgrading/2.x-to-4.0.md)
- [1.x → 2.0.0 and 2.0.x → 2.1.0](docs/upgrading/1.x-to-2.1.md)
