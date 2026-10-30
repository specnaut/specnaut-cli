/**
 * What the mobile-first sweeps share: the vocabulary that derives their
 * populations and the whitespace-flattening every prose assertion goes through.
 * One definition, so the agent sweep and the skill sweep cannot drift apart.
 */

/**
 * Markdown is hard-wrapped, so a prose assertion keyed on a sentence fails on
 * a line break that changed nothing. Collapse whitespace before matching —
 * otherwise the assertion is about the rendering, not the content, and it goes
 * red the next time someone runs a formatter.
 */
export function flat(s: string): string {
  return s.replace(/\s+/g, " ");
}

/**
 * Front-end vocabulary, used to DERIVE the candidate set rather than to
 * hand-list it. A positive membership list can only be wrong in one direction,
 * and the precedent's list proves it: it still carves out a phase doc deleted
 * two releases ago.
 *
 * `layout` and `component` are NOT in this vocabulary, and their absence is the
 * point. `layout` matched `product-owner` three times — on "Local Markdown
 * layout", "GitHub layout", "Specnaut Cloud layout", every one of them a
 * backlog storage layout. A word that means two things recruits false
 * candidates, and the cure for a false candidate is a tighter word, never an
 * exclusion that records a decision nobody actually took.
 */
export const FE_VOCAB = /front-?end|\bUI\b|\bUX\b|markup|\bCSS\b|viewport|responsive/i;
