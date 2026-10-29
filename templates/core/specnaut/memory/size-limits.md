> **Agents depend on this file.** Every phase and agent that judges the size of
> a file or a function cites it instead of carrying its own number. Moving or
> renaming it breaks those links in silence. Specnaut owns it: `specnaut
> upgrade` rewrites it, so a project changes its limits in
> `.specnaut/size-limits.yml`, never here.

# Size limits

## Where the numbers come from — the one rule

**`.specnaut/size-limits.yml` is the only source of a project's thresholds.
The defaults below apply only to a unit that file does not set** — including
every unit, when the project has no such file. The project owns the file:
Specnaut never ships or rewrites it, and where the harness runs Specnaut's
hooks, an agent's edit to it needs the user's approval: loosening a limit
disarms its own gate.

A threshold written anywhere else — an agent, a phase, a catalogue leaf, a
table in the constitution — is not a threshold. Every size finding names the
unit, the measured value, and the limit with its source: `config` or
`default`.

## Defaults

| Unit | Target | Ceiling |
| :--- | ---: | ---: |
| file | 300 | 500 |
| function | 30 | 50 |
| constitution | 60 | 100 |

`constitution` is `docs/constitution.md` itself. It is loaded into every
session, so every line it gains is paid by every later session: it keeps
principles only, which is why its limits are the shortest.

## The config file

```yaml
# .specnaut/size-limits.yml — set only what differs from the defaults
file:
  target: 300
  ceiling: 500
function:
  target: 30
  ceiling: 50
constitution:
  target: 60
  ceiling: 100
exempt:
  - "*.lock"
  - "**/generated/**"
```

- Each unit — `file`, `function`, `constitution` — sets both `target` and
  `ceiling`. A value is a whole number of lines, or `none`. `none` as a target
  turns off rule 2 for that unit; `none` as a ceiling turns off rule 1. Other
  units (`class`, `component`) are the agents' judgement, never the config's.
- `exempt:` is optional: globs, one per line and quoted (`*.lock` bare is not
  YAML), matched against the path from the repository root. An exempt file has
  no file limit at all. Lockfiles, generated code and vendored bundles are what
  it is for.
- The form is a narrow block YAML: a key alone on its line, children indented
  two spaces, full-line `#` comments. A flow map (`file: {…}`), a tab, a
  trailing comment, a repeated key, a link at the path, or a value that is not
  a number or `none` stops `.specnaut/scripts/bash/size-ratchet.sh` with exit 2;
  it never passes silently and never falls back to the defaults.
- Specnaut's own files — `.specnaut/**` and everything `.specnaut/installed.lock`
  lists — are exempt without being listed: `specnaut upgrade` rewrites them.
  The constitution is the exception: whenever it changes, the ratchet holds it
  to the `constitution` unit, and `exempt:` globs do not reach it. To lift its
  limit, set both its values to `none`.
- A constitution written before this file existed may still carry a size
  table. It is no longer read: `specnaut upgrade` copies a non-default one into
  `.specnaut/size-limits.yml` once, when that file is absent, and says the
  table can be deleted.

## The three rules

1. **A unit over its ceiling fails** — unless the change shrinks it. A unit
   already over its ceiling can only get out by shrinking, a commit at a time;
   refusing that commit would refuse the remedy.
2. **A unit over its target may not grow.** Lines after ≤ lines before. It may
   stay the same size or shrink.
3. **Extract before you add.** When a change must add to a file over its
   target, the extraction lands first — as its own task — and moves out at least
   as many lines as the change adds *to that file*, into a module with one
   responsibility. After it, the addition is allowed: the file still ends no
   larger than it was.

**"Before" is the size where the change began** — at plan time in a plan, at the
branch's merge base in implement, review and the ratchet. Never the previous
commit or task: measured that way, rule 3's second step (add, after the
extraction) would read as growth and be refused.

A file is measured with `wc -l`. A function, class or component is measured by
the agent reading it, from its first line to its last.

## Severity, in a review

| What the diff does | Severity |
| :--- | :--- |
| A unit ends over its ceiling and did not shrink | HIGH |
| A unit already over its target grew | HIGH |
| A unit crosses its target for the first time | MEDIUM |
| A unit over its ceiling shrank | no finding — report how far over it still is |
| A unit over its target shrank, or stayed the same | no finding — say so |

These severities are fixed. They replace any floor a seat applies to
constitution violations in general, and the lead does not re-judge them by
harm: a HIGH size finding is routed back like any other HIGH, every time.

## A file that is not authored

Generated code, a vendored bundle, a lockfile, a data table: list it under
`exempt:` in the config rather than arguing each review. A file that is authored is not
excused by the smell's "when it is not a smell" — the limit still applies. The god-file smell in
`.specnaut/memory/architecture/smells/god-file.md` covers the judgement call;
the limits above cover the number.

## In each phase

**plan** — the brief's guardrails name every file the change touches and its
`wc -l` now; the full plan carries them in § 7's **Files touched** table. `Lines now` is `wc -l`, measured at plan time. The plan is not
done while a file's lines after exceed its ceiling without shrinking, or a file
already over its target has lines after > lines now. Complexity tracking cannot
accept a size violation: the remedy is an extraction inside the plan. Each new
module gets a one-line responsibility; one that needs "and" is two. The
architecture audit of the plan re-measures the table with `wc -l`.

**implement** — first re-measure every file the plan touches with `wc -l`; the
plan's figure may be stale. For each file over its target, the first change to
it is an extraction task, in its own commit, that moves out at least the lines
the feature will add, naming the destination module and its one-line
responsibility. New behaviour lands in a new module wherever it can; an addition
to a file over its target comes only after that file's extraction, and keeps it
within its size at plan time. Read `.specnaut/size-limits.yml` before the first change, and
put its limits (or this file's path, when the project has none) in every
subagent's dispatch brief: a subagent sees one task and one file, and without
the limits has no reason to stop a file from growing. Run `wc -l` on each file a
task touches and report every one as
`file: before → after (target T, ceiling C)`, "before" being its size at the
branch's merge base. The developer puts that line in its completion report's
`Decisions`. A file over its target that grew, or a file over its ceiling that
did not shrink, is a blocker: fix it — extract — before handing off to review,
never after.

**review** — the review coordinator runs
`bash .specnaut/scripts/bash/size-ratchet.sh --since <merge base> --report`, which
measures every changed file at the base and at head (a renamed file against its
old path), and briefs each seat with that output and the limits. It runs for
every reviewed change, standalone or epic. The severity
table above is the only one; `code-reviewer` cites it and reports
`wc -l <before> → <after>` for every file that ends over its target. A HIGH size
finding is routed back to the implementer like any other HIGH.
