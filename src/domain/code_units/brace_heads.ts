import { Char, isWordCode } from "./char_codes.ts";
import type { CodeUnitKind } from "./code_unit.ts";
import { clearHeads, type Head, type HeadState } from "./brace_head_state.ts";

export type BraceOpening =
  | { readonly open: "plain" }
  | { readonly open: "parameter" }
  | {
    readonly open: "unit";
    readonly kind: CodeUnitKind;
    readonly name: string | null;
    readonly line: number;
  };

const LINE_CONTINUES_AFTER: ReadonlySet<number> = new Set([
  Char.Comma,
  Char.Less,
  Char.OpenBracket,
  Char.Ampersand,
  Char.Pipe,
  Char.Colon,
  Char.Equals,
]);
const TYPE_LITERAL_AFTER: ReadonlySet<number> = new Set([Char.Colon, Char.Pipe, Char.Ampersand]);
const PLAIN: BraceOpening = { open: "plain" };
const PARAMETER: BraceOpening = { open: "parameter" };

function isNameBefore(prev: number): boolean {
  return isWordCode(prev) || prev === Char.Greater || prev === Char.CloseBracket;
}

function tryCallHead(s: HeadState, line: number): void {
  if (!s.family.callHeads || s.blocked || s.head?.locked) return;
  if (!isNameBefore(s.prevCode)) return;
  const computed = s.prevCode === Char.CloseBracket;
  const name = computed ? null : s.lastWord;
  const at = computed ? line : s.lastWordLine;
  s.head = { kind: "function", name, line: at, parens: 0, fromKeyword: false, locked: false };
}

function atOpenParen(s: HeadState, line: number): void {
  const head = s.head;
  if (!head?.fromKeyword) {
    if (s.parens === 0) tryCallHead(s, line);
    return;
  }
  if (head.parens !== s.parens) return;
  if (head.kind === "class") {
    if (s.family.classParams) return;
    s.head = null;
    tryCallHead(s, line);
    return;
  }
  if (head.locked || !isNameBefore(s.prevCode) || s.lastWord === null) return;
  head.name = s.family.neverNames.has(s.lastWord) ? null : s.lastWord;
  head.locked = head.name !== null;
}

function setAssign(s: HeadState): void {
  if (s.assignName !== null || !isWordCode(s.prevCode)) return;
  s.assignName = s.lastWord;
  s.assignLine = s.lastWordLine;
}

/** A `=` that is not part of `=>`: the value that follows belongs to no pending head. */
function onEquals(s: HeadState): void {
  if (s.parens > 0 || s.angles > 0) return;
  setAssign(s);
  s.head = null;
}

function onColon(s: HeadState): void {
  if (s.parens > 0 || s.angles > 0) return;
  setAssign(s);
  if (s.head) s.head.locked = true;
}

function onCloseParen(s: HeadState): void {
  s.parens = Math.max(0, s.parens - 1);
  if (s.head && s.parens < s.head.parens) s.head = null;
}

/** Generics and subscripts alike hide their words from a name; only their balance matters. */
function moveAngles(s: HeadState, delta: number): void {
  if (s.parens === 0) s.angles = Math.max(0, s.angles + delta);
}

export function onArrow(s: HeadState, line: number): void {
  s.arrowLine = s.family.arrows ? line : null;
  s.arrowNamed = s.parens === 0 && s.assignName !== null;
  s.prevCode = Char.Greater;
}

/** `<-`: not a generic's bracket, whatever the `<` looks like. A channel type follows. */
export function onChannelArrow(s: HeadState): void {
  s.arrowLine = null;
  s.prevCode = Char.Minus;
}

/** Applies one punctuation character that is not a brace or part of an arrow. */
export function onPunctuation(s: HeadState, code: number, line: number): void {
  if (code !== Char.OpenParen) s.arrowLine = null;
  if (code === Char.OpenParen) {
    if (s.angles === 0) atOpenParen(s, line);
    s.parens++;
  }
  if (code === Char.CloseParen) onCloseParen(s);
  if (code === Char.Semicolon) clearHeads(s);
  if (code === Char.Equals) onEquals(s);
  if (code === Char.Colon) onColon(s);
  if (code === Char.Comma && s.parens === 0 && s.angles === 0) s.assignName = null;
  if (code === Char.Less || code === Char.OpenBracket) moveAngles(s, 1);
  if (code === Char.Greater || code === Char.CloseBracket) moveAngles(s, -1);
  s.prevCode = code;
}

/** A character of a string: the statement moved on, so whatever comes next is no arrow's body. */
export function onStringText(s: HeadState): void {
  s.arrowLine = null;
  s.prevCode = Char.DoubleQuote;
}

/**
 * A line end in code. Without semicolons it may be the statement's end: a `<` that was a comparison
 * must not hide the next head, so only a line that plainly continues keeps its count. A pending
 * assignment name lasts only while the value has yet to start.
 */
export function onCodeNewline(s: HeadState): void {
  if (s.parens > 0) return;
  if (s.family.newlineEndsHead) {
    s.head = null;
    s.prevCode = 0;
  }
  if (!LINE_CONTINUES_AFTER.has(s.prevCode)) s.angles = 0;
  const open = s.prevCode === Char.Equals || s.prevCode === Char.Colon || s.arrowLine !== null;
  if (!open) s.assignName = null;
}

/** The brace of a body follows a closing paren, a type or a closed annotation; not an operator. */
function canPrecedeBody(prev: number): boolean {
  return isNameBefore(prev) || prev === Char.CloseParen || prev === Char.CloseBrace;
}

/** A brace in the signature: a parameter's, a generic's, or a type after `:` or inside a union. */
function isAnnotationBrace(s: HeadState, head: Head): boolean {
  return s.parens > head.parens || TYPE_LITERAL_AFTER.has(s.prevCode) || s.angles > 0 ||
    isGoTypeLiteral(s, head);
}

/** `func f() interface{} {`: a keyword right before the brace, in a function's signature. */
function isGoTypeLiteral(s: HeadState, head: Head): boolean {
  if (!s.family.namedTypeLiterals || head.kind !== "function" || !isWordCode(s.prevCode)) {
    return false;
  }
  return s.lastWord !== null && s.family.classWords.has(s.lastWord);
}

function arrowOpening(s: HeadState, arrowLine: number): BraceOpening {
  const name = s.arrowNamed ? s.assignName : null;
  return { open: "unit", kind: "function", name, line: s.arrowNamed ? s.assignLine : arrowLine };
}

export function classifyOpenBrace(s: HeadState): BraceOpening {
  if (s.arrowLine !== null) return arrowOpening(s, s.arrowLine);
  const head = s.head;
  if (head === null) return PLAIN;
  if (isAnnotationBrace(s, head)) return PARAMETER;
  if (!head.fromKeyword && !canPrecedeBody(s.prevCode)) return PLAIN;
  const name = head.name ?? (head.parens === 0 ? s.assignName : null);
  return { open: "unit", kind: head.kind, name, line: head.line };
}
