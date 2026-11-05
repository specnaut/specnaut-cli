import { Char, isSpaceCode } from "./char_codes.ts";
import {
  CharRole,
  compileOpeners,
  endAtNewline,
  type LexicalRules,
  type Machine,
  matchOpener,
  Mode,
  type Opener,
  type StringRule,
} from "./lexical_rules.ts";
import { enterRegex, regexMayStart, stepRegex } from "./lexical_regex.ts";

export { CharRole };

/** Past this, `${` is plain text: the estimate degrades and the state stays bounded. */
const MAX_TEMPLATE_NESTING = 64;
const CHAR_LITERAL: StringRule = { open: "'", close: "'", multiline: false, escapes: true };

function enterString(m: Machine, rule: StringRule, i: number, length: number): void {
  m.mode = Mode.Str;
  m.rule = rule;
  m.mask.fill(CharRole.Text, i, i + length);
  m.prevCode = Char.DoubleQuote;
  m.prevIndex = i;
}

function enterOpener(m: Machine, opener: Opener, i: number): number {
  if (opener.kind === "line") m.mode = Mode.LineComment;
  if (opener.kind === "block") {
    m.mode = Mode.BlockComment;
    m.commentDepth = 1;
  }
  if (opener.kind === "string") enterString(m, opener.rule, i, opener.open.length);
  return i + opener.open.length;
}

/** True when this `}` ended an interpolation, and so belongs to the template's text. */
function closesInterpolation(m: Machine, code: number): boolean {
  const top = m.interpolations.length - 1;
  if (top < 0) return false;
  if (code === Char.OpenBrace) m.interpolations[top]++;
  if (code !== Char.CloseBrace) return false;
  if (m.interpolations[top] > 0) {
    m.interpolations[top]--;
    return false;
  }
  m.interpolations.pop();
  return true;
}

function templateRule(m: Machine): StringRule {
  return m.rules.strings.find((rule) => rule.interpolates) ?? CHAR_LITERAL;
}

function markCode(m: Machine, i: number, code: number): number {
  m.mask[i] = CharRole.Code;
  m.prevCode = code;
  m.prevIndex = i;
  return i + 1;
}

function stepCharLiteral(m: Machine, i: number): number {
  if (m.text.charCodeAt(i + 1) === Char.Backslash) {
    enterString(m, CHAR_LITERAL, i, 1);
    return i + 1;
  }
  if (m.text.charCodeAt(i + 2) !== Char.Apostrophe) return markCode(m, i, Char.Apostrophe);
  m.mask.fill(CharRole.Text, i, i + 3);
  return i + 3;
}

function stepCode(m: Machine, i: number): number {
  const code = m.text.charCodeAt(i);
  if (isSpaceCode(code)) {
    m.mask[i] = CharRole.Code;
    return i + 1;
  }
  if (closesInterpolation(m, code)) {
    enterString(m, templateRule(m), i, 1);
    return i + 1;
  }
  const opener = matchOpener(m.openers, m.text, i);
  if (opener !== null) return enterOpener(m, opener, i);
  if (code === Char.Apostrophe && m.rules.charLiterals) return stepCharLiteral(m, i);
  if (code === Char.Slash && m.rules.regexLiterals && regexMayStart(m)) return enterRegex(m, i);
  return markCode(m, i, code);
}

function stepLineComment(m: Machine, i: number): number {
  return m.text.charCodeAt(i) === Char.Newline ? endAtNewline(m, i) : i + 1;
}

function stepBlockComment(m: Machine, i: number): number {
  const block = m.rules.blockComment!;
  if (block.nests && m.text.startsWith(block.open, i)) {
    m.commentDepth++;
    return i + block.open.length;
  }
  if (!m.text.startsWith(block.close, i)) return i + 1;
  if (--m.commentDepth === 0) m.mode = Mode.Code;
  return i + block.close.length;
}

function skipEscape(m: Machine, i: number): number {
  const crlf = m.text.charCodeAt(i + 1) === Char.Return &&
    m.text.charCodeAt(i + 2) === Char.Newline;
  const end = i + (crlf ? 3 : 2);
  m.mask.fill(CharRole.Text, i, end);
  return end;
}

function enterInterpolation(m: Machine, i: number): number {
  if (m.interpolations.length >= MAX_TEMPLATE_NESTING) return i + 1;
  m.interpolations.push(0);
  m.mask[i + 1] = CharRole.Text;
  m.mode = Mode.Code;
  m.prevCode = Char.OpenBrace;
  m.prevIndex = i + 1;
  return i + 2;
}

function stepString(m: Machine, i: number): number {
  const code = m.text.charCodeAt(i);
  if (code === Char.Newline && !m.rule.multiline) return endAtNewline(m, i);
  if (code === Char.Backslash && m.rule.escapes) return skipEscape(m, i);
  m.mask[i] = CharRole.Text;
  if (m.rule.interpolates && m.text.startsWith("${", i)) return enterInterpolation(m, i);
  if (!m.text.startsWith(m.rule.close, i)) return i + 1;
  m.mask.fill(CharRole.Text, i, i + m.rule.close.length);
  m.mode = Mode.Code;
  return i + m.rule.close.length;
}

const STEPS: readonly ((m: Machine, i: number) => number)[] = [
  stepCode,
  stepLineComment,
  stepBlockComment,
  stepString,
  stepRegex,
];

/**
 * A character state machine: one `CharRole` per UTF-16 unit of `text`, per family. It reads each
 * character once and looks back or ahead by a constant, which is the linear-time guarantee FR-006
 * asks of anything that runs on file content. Wrong on exotic input, never slow.
 */
export function classifyChars(text: string, rules: LexicalRules): Uint8Array {
  const m: Machine = {
    text,
    rules,
    mask: new Uint8Array(text.length),
    openers: compileOpeners(rules),
    interpolations: [],
    mode: Mode.Code,
    rule: CHAR_LITERAL,
    commentDepth: 0,
    regexClass: false,
    prevCode: 0,
    prevIndex: -1,
  };
  for (let i = 0; i < text.length;) i = STEPS[m.mode](m, i);
  return m.mask;
}
