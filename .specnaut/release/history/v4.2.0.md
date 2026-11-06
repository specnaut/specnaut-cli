**Specnaut now specifies how the assistant answers you, once, instead of leaving it to whichever
harness and model happen to be driving.**

Until now this tool shipped hundreds of files telling an assistant _what to do_ and not one saying
_how to reply_. The result was the thing everyone recognises: long tirades, the same point made
three ways, a wall of prose where a table and three lines would do — and a different interaction
quality per harness from the same tool.

There is now one contract, `response-style-contract`, and every surface that must honour it points
at it rather than restating it. It asks for concise, visually ordered answers, for a question to the
user to be a small selection with a recommendation rather than an open prompt, and for technical
topics to be explained as simply as the topic allows unless you ask for depth.

**Reports now say where things stand, not what the journey was.** Four badges, four meanings: green
success, blue information, orange still open, red failing now. The rule that picks one is the part
worth knowing — _a badge describes the state at the time of reading, not the path taken to reach
it._ Work that found and fixed three defects reads as a success, because it is one. Previously such
a report showed three red circles and looked at a glance like three standing failures.

Two limits ship with it, both deliberate. Brevity removes restatement — never a finding, a required
field, or a constraint enumeration; where this contract and a contract defining a machine-readable
block disagree, the block wins. And badges stay out of those fenced blocks entirely, so a report
carries a badged summary for you and an untouched block for tooling.

It arrives in existing projects as a `## Response style` section in your `AGENTS.md` on the next
`specnaut upgrade`, and reaches all seven harnesses.

**Any UI you build — web or native — is now assumed mobile-first, without you asking.** Nothing in
the shipped tree previously told an agent that an interface should adapt to the device it runs on;
the only responsive vocabulary anywhere was WCAG criteria applied by an _invoked_ audit, after the
code exists. So you had to say it, every time.

`mobile-first-contract` states obligations and never values — the narrow viewport is the base case,
breakpoints are declared tokens, input modality is not assumed, zoom is not disabled, native UI is
held to the same rules in its own terms. The numbers stay yours, in your `DESIGN.md` or your
constitution, because a number in the contract would compete with them. It is a default, not a
mandate: a project genuinely targeting a narrower surface declares that once and is never asked
again.

**A fix worth knowing about if you hand-edit `AGENTS.md`.** A stray Specnaut fence marker sitting
above a real managed block — an HTML comment, invisible in a rendered diff — made `upgrade` delete
every line you had written between the two. The file is written without a backup, and the report
said `refreshed` on one line with no indication of volume. Upgrade now resolves the closing fence
first and walks back to the nearest opening one, stepping over the stray marker instead of treating
it as the block's start.
