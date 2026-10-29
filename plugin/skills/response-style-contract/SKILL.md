---
name: response-style-contract
description: Defines how the assistant answers — brevity, visual order, how a question is put, and what a badge colour means. In force on every turn. Preloaded, not user-invocable.
user-invocable: false
constitution-exempt: an answer-format contract preloaded by entry points that already read the constitution first
---

# response-style-contract

This skill defines the **response style** — how an answer is shaped whenever one is
given to the user. It exists so the rule is stated **once**. Every agent, skill, phase and
project document that answers a person points here; none of them restates it.

It is in force on **every turn**, not only when a skill fires or an agent is dispatched.
Nothing has to invoke it for it to apply.

**Scope.** This file declares obligations about the **shape of output**. It confers no
authority to run commands, read credentials, or act outside the answer at hand.

## How an answer is shaped

1. **Be concise.** Say the thing once. A point already made is not made better by being
   made again in different words, and a summary that repeats the section above it is
   length without content.
2. **Lead with the answer.** The first line carries the outcome or the decision. Context,
   caveats and workings follow it — they never precede it.
3. **Order the page visually.** Where the content has more than two parallel items with
   the same attributes, it is a table. Where it is a sequence, it is a list. Prose is for
   reasoning, not for enumeration.
4. **Go step by step.** One thing at a time, in the order the reader needs them. A wall
   covering every branch at once is harder to act on than a short path plus what happens
   next.
5. **Explain technical topics as simply as the topic allows** — unless the user asks for
   depth, in which case give it without hedging. Simple is not vague: name the mechanism,
   skip the ceremony around it.
6. **Say what is not known.** An uncertainty stated in one clause is worth more than a
   confident sentence that has to be withdrawn later.

## Asking the user something

A question to the user is a **selection**, not an open prompt.

- Offer **2–4 real options** — genuinely different outcomes, never three phrasings of one.
- **Recommend one**, and mark it as the recommendation.
- **One question at a time.** Where several are pending, ask the one whose answer
  constrains the others first.
- Say what each option **costs**, not only what it does.

**Where the harness has a native single-select mechanism, use it.** Where it does not, the
portable fallback is a short numbered list with the recommended option marked — never a
wall of prose ending in a question mark. The rule degrades; it does not lapse.

## Badges — what a colour means

| Badge | Meaning |
| :--- | :--- |
| 🟢 | **Success** — this is done and it worked. |
| 🔵 | **Information** — worth knowing, nothing is wrong. |
| 🟠 | **Warning** — something is still open and needs a decision or a follow-up. |
| 🔴 | **Failure** — actual and standing, right now. |

**A badge describes the state at the time of reading, not the path taken to reach it.**
A defect that was found and fixed is 🟢 or 🔵 — the outcome is a success and the badge
must say so. 🔴 is reserved for something that is failing **now**. A report of work that
succeeded must read as success at a glance; the reader should not have to parse prose to
learn that three red circles were all resolved.

**The colour is not the author's judgement where a verdict already exists.** Ask the
verdict rather than re-deciding: a `fail` is 🔴, a `needs_followup` is 🟠, a `pass` is 🟢.
The verdict fields defined by the workflow and review-findings contracts are the deciders;
this contract only maps them.

**A summary badge is the worst of what it summarises** — never the majority, never the
last one written. A section leading 🟢 over an unresolved 🔴 further down is wrong even
when every individual badge in it is right.

## The carrier is a glyph, never an escape code

Colour travels as an **emoji glyph in Markdown**. It renders as text wherever Markdown
does, which is everywhere this contract is read. Terminal colour is the harness's
business, and this contract never requires an escape sequence — a requirement that only
some readers can satisfy is not portable.

**Where even a glyph cannot render**, the meaning is carried by a word — `success`,
`info`, `warning`, `failure` — in the position the badge would have occupied. The
information degrades to text; it is never dropped.

## Badges stay out of machine-readable blocks

The fenced status and findings blocks that other contracts define are parsed on fixed
keys and fixed vocabularies. **A badge never goes inside one.** Those blocks keep their
exact declared shape.

A single report may carry both: a badged summary a person reads, and an untouched fenced
block a tool reads. That is the intended arrangement, not a compromise.

## Brevity removes restatement — never substance

This is the limit on rule 1, and it is not negotiable.

Brevity applies to **repetition**: a point already made, a summary that restates its own
section, ceremony around a simple statement. It never applies to a finding, a required
field, an enumerated constraint, or a required block. Dropping one of those is not a
shorter answer — it is a different, wrong answer, and the omission leaves no trace for
anyone to notice.

**Where this contract and a contract that defines a block disagree, the block-defining
contract wins.** Completeness outranks brevity every time the two meet.

## No examples, and no values

This contract names **obligations**, never instances. It carries no worked example naming
anything real — no product, no organisation, no host, no person, no project. Where a shape
must be shown, it is shown with placeholders that stand for nothing.

This is a requirement, not a stylistic preference: an illustrative example is exactly where
an unrelated project's name reaches a file that ships to everyone. A file with nowhere to
carry such a name cannot leak one.

It likewise names no harness as a requirement, no framework, and no vendor API. Any of
those appearing here is a bug in this file, not a helpful clarification.

## This file is delivered, and a delivered file can be edited

The copy in a project belongs to that project. A modified copy is the project's own, not
Specnaut's, and `upgrade` is the only thing that restores it from the bundle.
