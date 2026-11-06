**A script whose job is to seed your plan was overwriting the one you had already written.**

`setup-plan.sh` copied the blank plan template over `plan.md` unconditionally. On the first feature
of a project that is harmless — the file does not exist yet. On every feature after it,
`.specnaut/feature.json` still named the _previous_ feature at the moment the script ran,
`get_feature_paths()` reads that file ahead of the branch name, and the copy landed in the finished
feature's directory. A completed plan, replaced by an empty template. No backup, no confirmation, no
way back except git.

The ordering that produced it was written down in the phase doc: `plan` ran `create-new-feature.sh`,
then `setup-plan.sh`, and persisted `feature.json` only afterwards. So the defect was invisible
exactly once — on the run everybody tests.

Three things changed, because any one of them alone leaves the next caller exposed. The copy refuses
to write over an existing plan, which costs nothing: `create-new-feature.sh` has already put the
template there by the time this runs. A resolution that contradicts the branch is now an error
rather than an output — previously the same JSON object could carry a `BRANCH` and an `IMPL_PLAN`
naming different features, with nothing comparing them. And the phase doc persists `feature.json`
**before** the next command instead of after.

The PowerShell twin had the same defect and passed an explicit `-Force`. It was also the half
nothing in this repository executed: no test touched a `.ps1`, and no workflow ran one. Both
implementations are now driven by the same scenarios from one definition, and the PowerShell arm
fails the suite rather than skipping when its interpreter is missing on CI.

**A path rule that only knew one platform's idea of absolute.** The guard above decides which
feature a path belongs to by reading its directory name — and `get_feature_paths()` tested for a
leading `/` to decide whether a path was absolute at all. Under Git Bash on Windows, `feature.json`
legitimately carries `C:\Users\...`, which fails that test; the repo root was then prepended, and
the resulting string had no usable directory name in it. So on Windows the new guard refused a
`feature.json` that agreed with the branch perfectly, and the template copy resolved nowhere. The
PowerShell twin never had it — it asks the platform whether a path is rooted rather than spelling
the rule by hand.

That one surfaced the way it should have: four of the five new scenarios are satisfied by the script
_not_ writing, and only the one that asserts a write went red. An assertion that can pass without
the code running is the thing this release is least short of evidence about.

Two gates on this repository's own release path were repaired in the same pass, and they are worth a
line because they are what stands between you and a broken build. The tag pipeline never read
whether the commit it was about to publish was green — it does now, and refuses to publish over a
failing one. And the local preflight could announce "smoke audit is red — fix the findings" over an
audit that had found nothing, because piping its output aborted it mid-report with the same exit
code a real finding uses. A reporting channel that can forge a verdict channel is not a gate.
