**The epic close-gate now tells you which thing went wrong.**

`cascade-check.sh` — the gate `/specnaut merge` runs before closing a linked issue or a parent epic
— reported three different events with one sentence and one exit code. A typo in the argument, an
issue number that does not exist, and a genuinely unreadable API all produced
`✗ could not read the children of #N — refusing to answer`, exit 3. That is the code the merge phase
teaches you to read as "a token, scope or network problem" — so a mistyped argument looked like a
broken token, and a merge could stall on a diagnosis that was never true.

Two causes, and fixing either alone left a case standing. The usage check only tested whether an
argument was present, so any non-empty string became an issue number and went out to the API. And
the "issue not found" branch could never run: `gh` writes the API's error body to standard output on
a 404, so the check for empty output was false even for an issue that does not exist. That message
was unreachable code, and the failure of the _next_ call spoke in its place.

A non-numeric argument now exits 2 and names what you typed. A missing issue says it is missing. An
unreadable API still says so, distinctly. The github and gitlab backends gained the numeric check
the local and cloud ones already had.

Nothing about the gate's safety changed, and nothing was ever unsafe here: every non-zero exit meant
"do not close" before this release and still does. The gate refused correctly and explained wrongly.

**A guard against a limit you would otherwise meet as a broken install.**

Windsurf caps a workflow file at 12,000 characters, and Specnaut emits 65 of them. A test has
enforced a per-file budget for some time, but a ceiling is satisfied by trimming whichever file
touched it — which has happened twice in a single day. Eight workflows now sit within 300 characters
of the budget.

This release adds a second gate on the _number_ of files crowding the limit, not on the largest one.
It cannot be satisfied by shortening a single file. Nothing you run changes; it is a promise that
the next thing added to Specnaut cannot quietly push a Windsurf install over the vendor's limit.
