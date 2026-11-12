// The product owner's single-home guard (cli#744, cli#770, cli#777): whether
// prose restates the list of calls `product-owner.md`'s "What you decide"
// section holds, read by po_decides_classification_test.ts.

import { flat } from "./task_docs.ts";

const ITEM = /^\s*(?:[-*] |\d+\. )/;
const SENTENCE_END = /(?<=[.;])\s/;

/** Prose blocks: code is dropped, and a blank line, table row, heading or list item ends one. */
function blocks(text: string): string[] {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ")
    .split(/\n\s*\n|\n(?=\s*(?:[|#]|[-*] |\d+\. ))/);
}

/** Prose sentences. A colon does not end one (cli#786): what follows it is the same sentence. */
const sentences = (prose: string[]) => prose.flatMap((b) => flat(b).split(SENTENCE_END));

/**
 * Each list a sentence introduces with a colon (cli#786): that sentence as its
 * lead, and the items after it joined, so "decides:" is read with the calls it
 * lists. The decider is looked for in the lead only: a long list of steps
 * read as one sentence would pair a verb and two calls from unrelated items.
 * A lead that is itself an item owns only the items nested under it.
 */
function introducedLists(prose: string[]): Array<{ lead: string; items: string }> {
  const lists: Array<{ lead: string; items: string }> = [];
  let min = -1; // the least indent an item of the open list has; -1: none is open
  for (const block of prose) {
    const at = block.search(/\S/);
    const joins = min >= 0 && ITEM.test(block) && at >= min;
    if (joins) lists[lists.length - 1].items += ` ${flat(block)}`;
    if (/:\s*$/.test(block)) {
      lists.push({ lead: flat(block).split(SENTENCE_END).at(-1)!, items: "" });
      min = ITEM.test(block) ? at + 1 : 0;
    } else if (!joins) min = -1;
  }
  return lists;
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
 * (cli#770). "Called" and "made", "the decision of the", the bare "sets",
 * "picks" and "calls", and a possessive "'s call" say it only of a decider: of
 * a script or a field they are neutral prose (cli#786).
 */
const DECIDES = new RegExp(
  [
    String.raw`\b(decid(e|es|ed|ing)|assigns?|chooses|determines)\b`,
    String.raw`${DECIDER}\s+(?:\w+\s+)?(sets|picks|calls)\b`,
    String.raw`${MODAL}(decide|set|assign|choose|pick|determine)\b`,
    String.raw`\b(set|decided|chosen|picked|assigned|determined)\s+by\b`,
    String.raw`\b(called|made)\s+by\s+${DECIDER}`,
    String.raw`\b(is|are|was|were|be|been)\s+(decided|chosen|picked|assigned|determined)\b`,
    String.raw`${DECIDER}['\u2019]s\s+(decision|call|choice)s?\b`,
    String.raw`\b(is|are|remains?)\s+${DECIDER}['\u2019]s(?=\s*(?:[.;,:!?)]|$))`,
    String.raw`\b(decision|call|choice)s?\s+of\s+${DECIDER}`,
    String.raw`\b(is|are|remains?)\s+up\s+to\b`,
  ].join("|"),
  "i",
);

/**
 * A sentence restates the list when it names a split beside a priority, or names
 * two of the calls as somebody's decision; so does a list whose lead names the
 * decider and whose items name the calls. Two of them without a deciding verb
 * is how the backlog docs describe the fields themselves, and is not flagged.
 */
export function restates(text: string): boolean {
  const prose = blocks(text);
  const decided = (lead: string, all: string) =>
    DECIDES.test(lead) && CALLS.filter((c) => c.test(all)).length >= 2;
  return sentences(prose).some((s) =>
    (/\bpriority\b/i.test(s) && /\bsplits?\b/i.test(s)) || decided(s, s)
  ) || introducedLists(prose).some(({ lead, items }) => decided(lead, `${lead} ${items}`));
}
