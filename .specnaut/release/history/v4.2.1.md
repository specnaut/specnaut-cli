**The agent whose job is to explain Specnaut to you could not finish a sentence about it.**

`specnaut-guide` shipped with a turn budget of ten — the smallest in the whole fleet, against twenty
for every review lens and eighty for `developer`. Ask it more than one thing about a project you
have just upgraded and it would spend the entire budget looking, then return an opening line and
nothing else. No partial answer, no statement of what it had found, nothing to act on.

The budget was not merely low against its siblings. The same file prescribes a seven-step
`review-upgrade` walk with two nested per-item loops, each iteration able to dispatch a sub-agent,
run a diff and commit. Ten turns cannot cover a small one. And that walk is the **default path**:
`specnaut upgrade` prints `@specnaut-guide review-upgrade` as its own suggested next step, so the
failure landed exactly where a user has the most to ask and the least context to ask it from.

It now carries sixty, matching the other seat whose protocol is an interactive walk that dispatches
sub-agents. Its `Agent` grant is scoped to the single seat it actually dispatches instead of to
every agent in your project. And it carries two rules it never had: look in its preloaded knowledge
first and then read the one installed file that answers the question, rather than sweeping a tree;
and render what you have before running out — a question needing more than a handful of lookups is
several questions, so answer the ones you reached and name the ones you did not.

Neither value was pinned by any assertion, which is how ten survived. Both are now asserted per
seat, with the population derived from the bundle itself, so an agent that arrives without a budget
fails the suite rather than shipping on whatever default its harness happens to apply.
