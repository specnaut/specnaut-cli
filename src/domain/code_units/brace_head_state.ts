import type { CodeUnitKind } from "./code_unit.ts";
import type { Family } from "./language_families.ts";

/**
 * Decides what the next `{` opens, from the tokens since the last statement boundary. It keeps a
 * few integers and one candidate head, so it costs O(1) a token whatever the file holds. Parens and
 * angle brackets are counters: an unbalanced one only spoils the estimate of the statement it is in.
 */
export interface Head {
  readonly kind: CodeUnitKind;
  readonly fromKeyword: boolean;
  readonly parens: number;
  readonly line: number;
  name: string | null;
  /** The name can no longer change: it was captured, or a `:` ended the part that could hold it. */
  locked: boolean;
}

export interface HeadState {
  readonly family: Family;
  head: Head | null;
  /** A control word was seen, so `word(...) {` in this statement is not a function. */
  blocked: boolean;
  arrowLine: number | null;
  arrowNamed: boolean;
  assignName: string | null;
  assignLine: number;
  lastWord: string | null;
  lastWordLine: number;
  prevCode: number;
  parens: number;
  angles: number;
}

/** What survives across a brace inside a head, like `function f({ a, b }) {`. */
export type HeadResume = Pick<
  HeadState,
  "head" | "blocked" | "parens" | "angles" | "assignName" | "assignLine"
>;

export function newHeadState(family: Family): HeadState {
  return {
    family,
    head: null,
    blocked: false,
    arrowLine: null,
    arrowNamed: false,
    assignName: null,
    assignLine: 0,
    lastWord: null,
    lastWordLine: 0,
    prevCode: 0,
    parens: 0,
    angles: 0,
  };
}

/** A statement boundary: everything pending is dropped. */
export function clearHeads(s: HeadState): void {
  s.head = null;
  s.blocked = false;
  s.arrowLine = null;
  s.assignName = null;
  s.lastWord = null;
  s.parens = 0;
  s.angles = 0;
}

export function saveHeads(s: HeadState): HeadResume {
  const { head, blocked, parens, angles, assignName, assignLine } = s;
  return { head, blocked, parens, angles, assignName, assignLine };
}

export function restoreHeads(s: HeadState, resume: HeadResume): void {
  clearHeads(s);
  Object.assign(s, resume);
}
