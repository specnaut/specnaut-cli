> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# God File

**Family:** Structural

## How to spot it

A single file far larger than its neighbours, usually accumulating unrelated
responsibilities. **The finding's threshold is the file limit in the project's
constitution** — `.specnaut/memory/size-limits.md` holds the rule and the
defaults; no other number decides it. In an audit, also report the
**distribution**: a file three times the size of the next-largest tells the
reader where to start. It is context for the finding, not a second threshold.

## What it costs

It becomes the file everyone edits, so it collides, resists review, and cannot
be reasoned about in one sitting. It is usually
[Divergent Change](divergent-change.md) with a size symptom attached.

## Cure

[Extract Class](../refactorings/extract-class.md) along the reasons to change,
not along line count. Splitting by size alone produces arbitrary parts that
still change together.

## When it is NOT a smell

Generated code, a vendored bundle, a lockfile, a data table, or a
deliberately-single-file module whose content is one long flat list — list it
under the constitution's `Exempt:` line; an authored file is still held to its
limit. Judge by
responsibilities, and check whether the file is authored at all before
flagging it.
