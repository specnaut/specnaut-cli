import { Char, isSpaceCode, wordEnd } from "./char_codes.ts";
import {
  type CodeUnit,
  type CodeUnitKind,
  openCodeUnit,
  type OpenUnit,
  wordOrNull,
} from "./code_unit.ts";
import type { Family } from "./language_families.ts";
import { CharRole, classifyChars } from "./lexical_state.ts";

interface Indented {
  readonly unit: OpenUnit;
  readonly indent: number;
}

interface Scan {
  readonly path: string;
  readonly text: string;
  readonly mask: Uint8Array;
  readonly family: Family;
  readonly units: OpenUnit[];
  readonly open: Indented[];
  /** The last line that holds code or string text: what a unit ends on, past comments and blanks. */
  lastLine: number;
  /** A logical line continues past a line end inside a bracket or after a backslash. */
  brackets: number;
  continued: boolean;
}

const TAB_STOP = 8;
const ASYNC = "async";
const OPENING: ReadonlySet<number> = new Set([Char.OpenParen, Char.OpenBracket, Char.OpenBrace]);
const CLOSING: ReadonlySet<number> = new Set([Char.CloseParen, Char.CloseBracket, Char.CloseBrace]);

function firstCharOf(s: Scan, start: number, end: number): number {
  let i = start;
  while (i < end && isSpaceCode(s.text.charCodeAt(i))) i++;
  return i < end && s.mask[i] !== CharRole.Comment ? i : -1;
}

/** Columns as Python counts them: a tab reaches the next multiple of eight. */
function indentOf(text: string, start: number, first: number): number {
  let column = 0;
  for (let i = start; i < first; i++) {
    column = text.charCodeAt(i) === Char.Tab ? column - (column % TAB_STOP) + TAB_STOP : column + 1;
  }
  return column;
}

function closeTo(s: Scan, indent: number): void {
  for (let top = s.open.at(-1); top !== undefined && top.indent >= indent; top = s.open.at(-1)) {
    top.unit.lines = s.lastLine - top.unit.startLine + 1;
    s.open.pop();
  }
}

function skipSpaces(text: string, i: number, end: number): number {
  while (i < end && isSpaceCode(text.charCodeAt(i))) i++;
  return i;
}

function kindOf(family: Family, word: string | null): CodeUnitKind | null {
  if (word === null) return null;
  if (family.functionWords.has(word)) return "function";
  return family.classWords.has(word) ? "class" : null;
}

function openIfHead(s: Scan, first: number, end: number, line: number, indent: number): void {
  let wordStop = wordEnd(s.text, first);
  let word = wordOrNull(s.text, first, wordStop);
  if (word === ASYNC) {
    const next = skipSpaces(s.text, wordStop, end);
    wordStop = wordEnd(s.text, next);
    word = wordOrNull(s.text, next, wordStop);
  }
  const kind = kindOf(s.family, word);
  if (kind === null) return;
  const nameAt = skipSpaces(s.text, wordStop, end);
  const name = wordOrNull(s.text, nameAt, wordEnd(s.text, nameAt));
  const unit = openCodeUnit(s.path, kind, name, line);
  s.units.push(unit);
  s.open.push({ unit, indent });
}

function followBrackets(s: Scan, start: number, end: number): void {
  let lastCode = 0;
  for (let i = start; i < end; i++) {
    if (s.mask[i] !== CharRole.Code) continue;
    const code = s.text.charCodeAt(i);
    if (isSpaceCode(code)) continue;
    lastCode = code;
    if (OPENING.has(code)) s.brackets++;
    if (CLOSING.has(code) && s.brackets > 0) s.brackets--;
  }
  s.continued = lastCode === Char.Backslash;
}

function readLine(s: Scan, start: number, end: number, line: number): void {
  const insideString = start > 0 && s.mask[start - 1] === CharRole.Text;
  const first = firstCharOf(s, start, end);
  if (first !== -1) {
    if (!insideString && s.brackets === 0 && !s.continued) {
      const indent = indentOf(s.text, start, first);
      closeTo(s, indent);
      openIfHead(s, first, end, line, indent);
    }
    s.lastLine = line;
    followBrackets(s, start, end);
  }
}

function newScan(path: string, text: string, family: Family): Scan {
  const mask = classifyChars(text, family.lexical);
  return {
    path,
    text,
    family,
    mask,
    units: [],
    open: [],
    lastLine: 0,
    brackets: 0,
    continued: false,
  };
}

/**
 * Extents by indentation, for Python. A unit ends before the next logical line indented no deeper
 * than its head. Only a logical line's first physical line is measured, so a bracket or a string
 * that returns to column zero does not end anything. Each unit is pushed and popped once.
 */
export function indentExtents(path: string, text: string, family: Family): readonly CodeUnit[] {
  const s = newScan(path, text, family);
  let line = 1;
  for (let start = 0; start < text.length; line++) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    readLine(s, start, end, line);
    start = end + 1;
  }
  closeTo(s, 0);
  return s.units;
}
