**Four gates that answered "fine" when they had not looked.**

This release is one defect wearing four costumes. In each case a command that decides something
could not obtain the information it decides on, and said so in the vocabulary of good news.

**A close gate that answered yes when it could not see.** `cascade-check.sh` decides whether an epic
may close, and `merge` runs it before closing a linked item and again before closing the parent.
Three states printed one `✓ safe to close`: every child genuinely closed; more than one API page of
children with the first page closed, because the call asked for neither pagination nor a page size;
and **the query having failed**, because it ended `|| echo 0` and substituted a count it never read.
The third needed no epic size at all — any parent, at any moment, on a bad token. The GitLab backend
carried the same defect in a shape no search for that idiom would find, its coercion being a pipe
into `wc -l`. All four backends now also separate "no child is linked" from "every child is closed":
both are safe, and they are different facts.

**A drift detector that reported a clean board it never read.** `sweep-closed.sh` makes three reads
and discarded the error from each. The project read at least announced itself, but as
`could not read Project #N for
owner X` — a permanent misconfiguration's vocabulary for a rate
limit, sending the reader to check a token that was fine. The two issue reads were silent: a failed
one produced "nothing was closed", so the drift set was empty, the summary said `drifted 0`, and it
exited 0. That is not only a bad report — `merge` pipes the drift lines into the correction, so a
false clean cancels a fix rather than merely failing to mention one.

**A freeze nothing could tell you had fallen behind.** Declaring a path in `preserve.yml` does more
than beat `--force`: it takes the file off every surface that reports drift, so `reconcile --status`
cannot list it. That exclusion is right — a freeze is not a pending reconciliation — but nothing
else said the frozen copy had gone stale. Upgrade already split preserved files into settled and
behind; that repair had been applied to one population only, and a declared preserve returned before
the check was ever computed. It landed under **"customized locally (not touched)"**, wrong twice:
the file was declared rather than customized, and "not touched" asserted the one thing a declaration
makes unverifiable. Declared preserves now report four states — level, behind with its freeze point,
no baseline recorded, and dropped upstream — using the same predicate as the other population, so
the two cannot part company again. Nothing is applied automatically and the declaration still wins
over `--force`; this is information, and a declaration is a maintenance obligation you could not
previously discharge.

**And a check the scheduled loop promised and nothing performed.** The bundled `/loop` prompt says
`/board groom` flags orphan specs. `groom.md` said the check was not its business and had moved; no
line told anyone to read the file it named; and the file itself believed it was reached "from a
grooming pass". Three documents, a loop advertising the check, nothing that ran it. The ownership
line stands — the walk reads spec artefacts and belongs on the specnaut side — and a grooming pass
now carries an instruction into it.

One consequence is worth naming, because it is the same defect one call further out.
`create-new-feature.sh` asks the close gate whether a linked issue is an epic, and tested its answer
for a single value — so a gate that refused to answer was read as "no open children", and the branch
was created standalone for what may be an epic. Before this release a refusal exited 0 and the
caller could not have known. It can now, and it says so.
