**One workflow, not two.** Specnaut used to ship a second, derived workflow beside its own
`plan → tasks → implement → review → merge` pipeline. It is retired:

- the skills `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`,
  `requesting-code-review`, `verification-before-completion` and `using-specnaut`;
- `.specnaut/harness-tools.md`;
- the `/specnaut audit <axis>` phases.

`specnaut upgrade` removes every copy you never edited. A copy you edited is kept and listed, and is
yours to delete. `/specnaut audit <axis>` now names its replacement: `/sec-audit`, `/perf-audit`,
`/a11y-audit`, `/arch-audit`, `/dep-audit`, or `/code-audit` for every axis. The plugins no longer
inject anything at session start; update the plugin on every harness you installed it on. The rule
for dispatching an agent by name, rather than by a description of the task, moves into `AGENTS.md`,
so existing projects receive it too. `UPGRADING.md` has the details.

**The constitution has a size budget.** It is loaded into every session, so the size ratchet now
measures it against its own `constitution` unit, 300 / 500 lines by default. The constitution phase
replaces its Sync Impact Report on each amendment instead of stacking a new one.

**A plan justifies every new helper.** Before a plan adds a script or an automation, it lists what
already exists and how often the procedure has really recurred. Below two earlier occurrences, the
answer is to reuse the existing commands.
