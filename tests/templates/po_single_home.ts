// The product owner's single-home guard (cli#744, cli#770, cli#777): whether
// prose restates the list of calls `product-owner.md`'s "What you decide"
// section holds, read by po_decides_classification_test.ts.

import { flat } from "./task_docs.ts";

/** Prose sentences: code is dropped, and a table row, heading or list item ends one. */
function sentences(text: string): string[] {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ")
    .split(/\n\s*\n|\n(?=\s*(?:[|#]|[-*] |\d+\. ))/)
    .flatMap((block) => flat(block).split(/(?<=[.;:])\s/));
}

const CALLS = [/\bpriority\b/i, /\bsizes?\b/i, /\btypes?\b/i, /\bsplits?\b/i];
/** Who a sentence can name as deciding: "the product owner", "the user", "an agent". */
const WHO = ["owner", "user", "agent", "seat", "maintainer", "lead", "manager", "team"];
const DECIDER = String.raw`(?:the\s+|an?\s+)?(?:[\w-]+\s+)?(?:${WHO.join("|")})\b`;
const MODAL = String.raw`\b(will|shall|must|should|can|may|would)\s+`;
/**
 * Somebody deciding, in any of the ways prose says it: an active verb ("the
 * product owner sets", "will set", "determines"), a passive one with or without
 * its agent ("are set by", "are chosen, never asked"), a noun ("the product
 * owner's decision", "the call of the product owner", "are the product
 * owner's"), or "is up to". Active verbs alone let a passive restatement through
 * (cli#770). "Called" and "made", and "the decision of the", say it only of a
 * decider: of a script or a field they are neutral prose.
 */
const DECIDES = new RegExp(
  [
    String.raw`\b(decid(e|es|ed|ing)|sets|assigns?|chooses|picks|calls|determines)\b`,
    String.raw`${MODAL}(decide|set|assign|choose|pick|determine)\b`,
    String.raw`\b(set|decided|chosen|picked|assigned|determined)\s+by\b`,
    String.raw`\b(called|made)\s+by\s+${DECIDER}`,
    String.raw`\b(is|are|was|were|be|been)\s+(decided|chosen|picked|assigned|determined)\b`,
    String.raw`['\u2019]s\s+(decision|call|choice)s?\b`,
    String.raw`\b(is|are|remains?)\s+${DECIDER}['\u2019]s(?=\s*(?:[.;,:!?)]|$))`,
    String.raw`\b(decision|call|choice)s?\s+of\s+${DECIDER}`,
    String.raw`\b(is|are|remains?)\s+up\s+to\b`,
  ].join("|"),
  "i",
);

/**
 * A sentence restates the list when it names a split beside a priority, or names
 * two of the calls as somebody's decision. Two of them without a deciding verb
 * is how the backlog docs describe the fields themselves, and is not flagged.
 */
export const restates = (text: string) =>
  sentences(text).some((s) =>
    (/\bpriority\b/i.test(s) && /\bsplits?\b/i.test(s)) ||
    (DECIDES.test(s) && CALLS.filter((c) => c.test(s)).length >= 2)
  );
