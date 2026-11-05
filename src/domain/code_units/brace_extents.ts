import { Char, isSpaceCode, isWordCode, wordEnd } from "./char_codes.ts";
import {
  type CodeUnit,
  type CodeUnitKind,
  openCodeUnit,
  type OpenUnit,
  wordOrNull,
} from "./code_unit.ts";
import { onWord } from "./brace_head_words.ts";
import {
  clearHeads,
  type HeadResume,
  type HeadState,
  newHeadState,
  restoreHeads,
  saveHeads,
} from "./brace_head_state.ts";
import {
  classifyOpenBrace,
  onArrow,
  onChannelArrow,
  onCodeNewline,
  onPunctuation,
  onStringText,
} from "./brace_heads.ts";
import type { Family } from "./language_families.ts";
import { CharRole, classifyChars } from "./lexical_state.ts";

/** A brace that matters when it closes: a unit's body, or a brace inside a head. Others are depth. */
interface Frame {
  readonly depth: number;
  readonly unit: OpenUnit | null;
  readonly resume: HeadResume | null;
}

interface Scan {
  readonly path: string;
  readonly heads: HeadState;
  readonly units: OpenUnit[];
  readonly frames: Frame[];
  depth: number;
  line: number;
}

function openUnit(s: Scan, kind: CodeUnitKind, name: string | null, line: number): OpenUnit {
  const unit = openCodeUnit(s.path, kind, name, line);
  s.units.push(unit);
  return unit;
}

function onOpenBrace(s: Scan): void {
  const opening = classifyOpenBrace(s.heads);
  if (opening.open === "unit") {
    const unit = openUnit(s, opening.kind, opening.name, opening.line);
    s.frames.push({ depth: s.depth, unit, resume: null });
  }
  if (opening.open === "parameter") {
    s.frames.push({ depth: s.depth, unit: null, resume: saveHeads(s.heads) });
  }
  clearHeads(s.heads);
  s.heads.prevCode = Char.OpenBrace;
  s.depth++;
}

function onCloseBrace(s: Scan): void {
  s.depth--;
  const top = s.frames[s.frames.length - 1];
  clearHeads(s.heads);
  if (top !== undefined && top.depth === s.depth) {
    s.frames.pop();
    if (top.unit !== null) top.unit.lines = s.line - top.unit.startLine + 1;
    if (top.resume !== null) restoreHeads(s.heads, top.resume);
  }
  s.heads.prevCode = Char.CloseBrace;
}

function consumeWord(s: Scan, text: string, i: number): number {
  const end = wordEnd(text, i);
  onWord(s.heads, wordOrNull(text, i, end), s.line);
  return end;
}

function consumePunctuation(s: Scan, text: string, i: number, code: number): number {
  const next = text.charCodeAt(i + 1);
  if (code === Char.Equals && next === Char.Greater) {
    onArrow(s.heads, s.line);
    return i + 2;
  }
  if (code === Char.Less && next === Char.Minus) {
    onChannelArrow(s.heads);
    return i + 2;
  }
  if (code === Char.OpenBrace) onOpenBrace(s);
  else if (code === Char.CloseBrace) onCloseBrace(s);
  else onPunctuation(s.heads, code, s.line);
  return i + 1;
}

function consumeNewline(s: Scan, isCode: boolean): void {
  if (isCode) onCodeNewline(s.heads);
  s.line++;
}

function walk(s: Scan, text: string, mask: Uint8Array): void {
  for (let i = 0; i < text.length;) {
    const code = text.charCodeAt(i);
    const role = mask[i];
    if (code === Char.Newline) {
      consumeNewline(s, role === CharRole.Code);
      i++;
    } else if (role !== CharRole.Code) {
      if (role === CharRole.Text) onStringText(s.heads);
      i++;
    } else if (isSpaceCode(code)) i++;
    else if (isWordCode(code)) i = consumeWord(s, text, i);
    else i = consumePunctuation(s, text, i, code);
  }
}

function lastLineOf(text: string, line: number): number {
  return text.charCodeAt(text.length - 1) === Char.Newline ? line - 1 : line;
}

/**
 * Extents by brace depth, an integer: only a brace that opens a unit, or sits inside a head, keeps
 * a record, so a run of plain braces costs nothing. Each unit is pushed as it opens, which keeps the
 * result in source order with no sort. A unit still open at the end runs to the last line.
 */
export function braceExtents(path: string, text: string, family: Family): readonly CodeUnit[] {
  const s: Scan = {
    path,
    heads: newHeadState(family),
    units: [],
    frames: [],
    depth: 0,
    line: 1,
  };
  walk(s, text, classifyChars(text, family.lexical));
  const last = lastLineOf(text, s.line);
  for (const frame of s.frames) {
    if (frame.unit !== null) frame.unit.lines = last - frame.unit.startLine + 1;
  }
  return s.units;
}
