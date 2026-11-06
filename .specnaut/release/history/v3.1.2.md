**`specnaut upgrade` told you what it planned, not what it did.**

Three defects, one root. The report was rendered from the plan computed _before_ the write phase and
presented as the outcome, so under `--force` it stated the opposite of the truth twice over: every
file it overwrote was still listed under "customized locally (not touched)" — a run that replaced 64
files summarised them as "64 preserved" — and the files that had just received a long-delayed update
were the ones warned to have missed it, with "Nothing will deliver them on a later run" said about
work the same command had completed a second earlier. The report now renders from the paths the run
actually wrote, under their own "overwritten (was customized)" heading. A dry run still forecasts,
because there the plan _is_ the outcome.

The third defect was the costly one. `--reset-baseline` re-baselined every file whose content
disagreed with the lock, rather than the "customized, and behind" list its own help text names — so
a project with 2 files behind and 111 merely customized lost all 113 — and it wrote none of the
`.specnaut.bak` copies the hint beside it promises, because the backup was keyed on `--force` alone.
It destroyed more than `--force` did, and more quietly. It is now bounded to files upstream has
actually moved for, leaves deliberate edits alone, and backs up everything it overwrites.

Any project that runs a markdown formatter over its own tree reaches all three: bundled templates
are not shipped formatter-clean, so the first pass marks most of the scaffold customized, and both
flags are entered through that bucket.

This release also fixes a publishing defect with no user-visible surface: the script that reaps
superseded branches from the Codex marketplace fork matched only the post-rebrand branch prefix,
while its counterpart for the other channel matched both. Three pre-rebrand branches were therefore
invisible to the mechanism meant to delete them and stayed published long after their content was
removed here. They are gone, both reapers now share one filter, and a test asserts they always will.
