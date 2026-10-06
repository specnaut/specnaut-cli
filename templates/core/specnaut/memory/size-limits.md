> **Agents depend on this file.** Every phase and agent that judges the size of
> a file or a function cites it instead of carrying its own number. Moving or
> renaming it breaks those links in silence. Specnaut owns it: `specnaut
> upgrade` rewrites it, so a project changes its limits in its constitution,
> never here.

# Size limits

## Where the numbers come from — the one rule

**The `## Size limits` table in `.specnaut/memory/constitution.md` is the only
source of thresholds. The defaults below apply only to a unit that table does
not list** — including every unit, when the constitution has no such table.

A threshold written anywhere else — an agent, a phase, a catalogue leaf — is
not a threshold. Every size finding names the unit, the measured value, and the
limit with its source: `constitution` or `default`.

## Defaults

| Unit | Target | Ceiling |
| :--- | ---: | ---: |
| file | 300 | 500 |
| function | 30 | 50 |

## The table, in a constitution

```markdown
## Size limits

| Unit | Target | Ceiling |
| :--- | ---: | ---: |
| file | 300 | 500 |
| function | 30 | 50 |

Exempt: `*.lock`, `**/generated/**`
```

- One row per unit, no merged cells. `file` and `function` are the expected
  rows; others (`class`, `component`) are allowed and judged by the agents.
- A value is a whole number of lines, or `none`. `none` as a target turns off
  rule 2 for that unit; `none` as a ceiling turns off rule 1.
- `Exempt:` is optional: backquoted globs, comma-separated, matched against the
  path from the repository root. An exempt file has no file limit at all.
  Lockfiles, generated code and vendored bundles are what it is for.
- `.specnaut/scripts/bash/size-ratchet.sh` reads exactly this shape. A table it
  cannot read stops it with exit 2; it never passes silently.

## The three rules

1. **A unit over its ceiling fails.** Whatever the change, whatever it removed.
2. **A unit over its target may not grow.** Lines after ≤ lines before. It may
   stay the same size or shrink.
3. **Extract before you add.** When a change must touch a file over its target,
   the extraction lands first — as its own task — and moves out at least as many
   lines as the change adds, into a module with one responsibility.

A file is measured with `wc -l`. A function, class or component is measured by
the agent reading it, from its first line to its last.

## Severity, in a review

| What the diff does | Severity |
| :--- | :--- |
| A unit ends over its ceiling | HIGH |
| A unit already over its target grew | HIGH |
| A unit crosses its target for the first time | MEDIUM |
| A unit over its target shrank, or stayed the same | no finding — say so |

A HIGH size finding is routed like any other HIGH finding.

## A file that is not authored

Generated code, a vendored bundle, a lockfile, a data table: list it under
`Exempt:` rather than arguing each review. The god-file smell in
`.specnaut/memory/architecture/smells/god-file.md` covers the judgement call;
the limits above cover the number.

## In each phase

**plan** — § 7 of the plan carries the mandatory size row and the **Files
touched** table. `Lines now` is `wc -l`, measured at plan time. The plan is not
done while a file's lines after exceed its ceiling, or a file already over its
target has lines after > lines now. Complexity tracking cannot accept a size
violation: the remedy is an extraction inside the plan. Each new module gets a
one-line responsibility; one that needs "and" is two.

**tasks** — re-measure every file the plan touches with `wc -l`; the plan's
figure may be stale. For each file over its target, the first task that touches
it is an extraction that moves out at least the lines the feature adds, naming
the destination module and its one-line responsibility. New behaviour lands as
a "create module X" task; "add X to <file over target>" is never emitted.

**implement** — re-read the constitution before the first task, and put its
`## Size limits` table (or this file's path, when it has none) in every
subagent's dispatch brief: a subagent sees one task and one file, and without
the table has no reason to stop a file from growing. Run `wc -l` on each file a
task touches, before and after, and report every one as
`file: before → after (target T, ceiling C)`. A file over its target that grew,
or any file over its ceiling, is a blocker: fix it — extract — before handing
off to review, never after.

**review** — the review coordinator measures every changed file at the base
and at head, and briefs each seat with both counts and the table. The severity
table above is the only one; `code-reviewer` cites it and reports
`wc -l <before> → <after>` for every file that ends over its target. A HIGH size
finding is routed back to the implementer like any other HIGH.
