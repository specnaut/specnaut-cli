import { Char, isWordCode } from "./char_codes.ts";
import type { CodeUnitKind } from "./code_unit.ts";
import type { Head, HeadState } from "./brace_head_state.ts";

/** Stands in for "the last token was a word": which word is in `lastWord`. */
const WORD = "a".charCodeAt(0);

function keywordHead(s: HeadState, kind: CodeUnitKind, line: number, name: string | null): Head {
  return { kind, name, line, parens: s.parens, fromKeyword: true, locked: name !== null };
}

/** Go writes function types with the same word: `func f() func() {`, `[]func(){ a, b }`. */
function isGoFunctionType(s: HeadState): boolean {
  if (!s.family.namedTypeLiterals) return false;
  return s.prevCode === Char.CloseBracket || (s.head?.kind === "function" && s.head.fromKeyword);
}

function tryFunctionWord(s: HeadState, word: string, line: number): boolean {
  if (!s.family.functionWords.has(word) || s.prevCode === Char.Dot) return false;
  // A keyword deeper than a pending head is part of its signature: `func f(cb func() int) {`.
  if (s.head?.fromKeyword && s.head.parens !== s.parens) return false;
  if (isGoFunctionType(s)) return false;
  s.head = keywordHead(s, "function", line, null);
  s.lastWord = null;
  s.angles = 0;
  return true;
}

function goTypeWord(s: HeadState, word: string, line: number): void {
  if (s.head?.fromKeyword && s.head.kind === "function") {
    s.lastWord = word;
    return;
  }
  // `Name struct`, or `Name[T any] struct`; a value like `x := []struct{` has its name assigned.
  const afterName = isWordCode(s.prevCode) || s.prevCode === Char.CloseBracket;
  if (!afterName || s.assignName !== null || s.lastWord === null) return;
  if (!s.family.neverNames.has(s.lastWord)) s.head = keywordHead(s, "class", line, s.lastWord);
}

function tryClassWord(s: HeadState, word: string, line: number): boolean {
  if (!s.family.classWords.has(word)) return false;
  // `a.class`, `Foo::class` and `where T : class` are values or constraints, not heads.
  if (s.prevCode === Char.Dot || s.prevCode === Char.Colon) return false;
  if (s.family.namedTypeLiterals) {
    goTypeWord(s, word, line);
    return true;
  }
  // Inside parens it is a parameter's type; after a function head, a return type: `-> impl Trait`.
  if (s.parens > 0 || (s.head?.fromKeyword && s.head.kind === "function")) return false;
  s.head = keywordHead(s, "class", line, null);
  return true;
}

function captureClassName(s: HeadState, word: string): void {
  const head = s.head;
  if (head?.kind !== "class" || head.locked || s.parens !== head.parens) return;
  head.name = s.family.neverNames.has(word) ? null : word;
  head.locked = true;
}

function noteWord(s: HeadState, word: string | null, line: number): void {
  if (word !== null && s.family.notCallHeads.has(word)) {
    s.blocked = true;
    if (s.head && !s.head.fromKeyword) s.head = null;
    return;
  }
  if (s.angles > 0) return;
  captureClassName(s, word ?? "");
  s.lastWord = word;
  s.lastWordLine = line;
}

/** `null` is a word too long to be a keyword or a name. */
export function onWord(s: HeadState, word: string | null, line: number): void {
  s.arrowLine = null;
  const known = word !== null && (tryFunctionWord(s, word, line) || tryClassWord(s, word, line));
  if (!known) noteWord(s, word, line);
  s.prevCode = WORD;
}
