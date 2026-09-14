# Groom report — the output contract

Loaded by the board skill's `groom` pass at its end. Split out of `groom.md`
under #562: the pass and the shape of its report change for different reasons,
and the report is a contract worth reading on its own.

End with a single summary block. **The per-ticket lines and the
size/priority-missing escalation block are mandatory contract output,
not optional** — they are how the user verifies the sizing + priority
contract was honoured.

Per-ticket lines should note when a value was persisted as a label
fallback rather than a native field — typically because the project
has no `Priority` / `Size` field, or because `priority:P3` does not
match a 3-level field. This makes the field-vs-label routing visible
in the report.

## The field-capabilities block, and why it is disclosed rather than fixed

The **field capabilities** block is mandatory too, and **unconditional**:
printed on a clean run exactly as on a failing one.

`groom.md` runs `detect-fields.sh` **once per run** — the right call, since
it is a GraphQL round-trip and a pass touches many tickets. But that makes
the board's capabilities a *sample*, taken at the start, and every later
`skip` / `REQUIRED` decision is taken against it. Step 3a gates on it
directly: **empty → skip**. So a field that became available after the
sample is skipped for every remaining ticket — and per the contract's own
words, that skip is *correct behaviour given the sample*. The inverse is
worse: a field sampled as present and since gone makes every later write a
REQUIRED one that cannot land.

**Why the sample is disclosed and not invalidated.** Recorded here so the
mtime/hash-check direction is not re-proposed: there is no cache object to
invalidate. `groom.md` is prose addressed to an agent, not code in a
long-lived process. The values arrive through `eval "$(detect-fields.sh)"`,
and shell state does not survive between tool calls — each one is a fresh
shell. So "run once per run" populates nothing on disk and nothing in a
daemon; it means the agent carries the IDs in its own context. An mtime or
hash check has nothing to attach to and no code path in which to run. The
only real invalidation is re-running the script per ticket, which is the
round-trip the once-per-run rule exists to avoid.

So the remedy is to make the sample *visible*, which is what this block is.

**And unconditionally.** Emitting it only when something went wrong would
reproduce the exact silence it exists to remove: a run that skipped
`Estimate` on every ticket because the board genuinely has no such field is
indistinguishable, in its output, from one that skipped it because the
sample was taken too early. Printing the sample is what lets a reader who
was not there tell those apart.

```
specnaut-groom report
─────────────────────
⚠  groom completed with <K> un-sized/un-prioritised tickets — re-run or fix manually
    (only emitted when K > 0, at the very top of the summary)

Fields:     sampled once at the start of this run via detect-fields.sh
            Priority=<present|absent>   Size=<present|absent>   Estimate=<present|absent>
            StartDate=<present|absent>  TargetDate=<present|absent>
            (ALWAYS emitted — including when every field is present and nothing
             was skipped. Its absence would be the same silence it exists to remove.)

Backlog:    <N> items reviewed, <P> promoted to Ready, <C> awaiting clarification
            <R> body rewrites, <S> sized, <Z> prioritised

Per-ticket:
  ↳ <backlog-reference> → promoted/comment/closure-recommended
       size=<X> + priority=<P> (field)
  ↳ <backlog-reference> → comment
       size=<X> (field) + priority=P3 (label fallback — no native option)
  ↳ ...

⚠ size / priority missing:
  ↳ <backlog-reference> — <reason: e.g. gh label create failed (rate-limited)>
  ↳ ...
  (omit this whole section when K == 0)

⚠ Roadmap dates missing (GitHub backend, soft):
  ↳ <backlog-reference> — Ready since <date>, no target date set
  ↳ <backlog-reference> — In progress, no start date set
  ↳ ...
  (omit this whole section when TARGETDATE_FIELD_ID / STARTDATE_FIELD_ID from
   detect-fields.sh is empty — the board has no such field, so nothing is
   missing — and when the fields exist but no dates are missing)

Stale PRs:  <S> open PRs idle > 48h
Orphan specs: <O> spec directories missing the next artefact

Next action: <one-line recommendation, or "no action needed">
```

If nothing needed action, say so explicitly. The point of the skill is
to be a **no-op when the project is healthy**.

