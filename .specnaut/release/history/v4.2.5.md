**A shipped feature's spec directory is now deleted when its issue closes at merge.**

If you use `/specnaut merge`, this changes what your working tree looks like after a feature lands:
`.specnaut/specs/<feature-dir>/` goes away, in its own commit, alongside `.specnaut/feature.json`.

It is not a loss. `/specnaut plan` commits the spec directory at plan time, before any code exists,
so it is already in git history when the close happens — `git log --all -- .specnaut/specs/<dir>/`
brings it back verbatim. The removal is refused outright if git has never seen the directory, which
is the case that would have destroyed the only copy. The same `yes` that authorises the close
authorises the removal; there is no second prompt, and a refused close leaves everything alone.

The reasoning is that a plan is consumed once the code ships. The code is the authority afterwards,
and the intent survives on the backlog item you just closed.

**Two ordering defects in the same file, both found by shipping the first change.**

`merge-close.md` gave two contradictory orderings for the same pair of operations. Its epic path
closed the issue and then moved the card, explaining at length that the reverse manufactures the
exact `REOPENED` drift `sweep-closed.sh` exists to report. Its standalone path did the reverse. A
single item merged through Specnaut therefore opened that window every time, and the smoke check
named "the issue closes BEFORE the card moves" passed on it — it grepped for the rule sentence,
which lives in the path that obeys it. The rule now lives in one place above both paths, and the
check reads the order rather than the prose.

The second was found while applying the new deletion by hand: removing the directory left
`.specnaut/feature.json` still naming it, and `common.sh` never verifies that the name still
resolves. Callers got a path to a directory that no longer existed, exit 0, no warning. The removal
now takes that file with it.
