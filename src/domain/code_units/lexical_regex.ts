import { Char, isWordCode } from "./char_codes.ts";
import { CharRole, endAtNewline, type Machine, Mode } from "./lexical_rules.ts";

const RETURN_WORD = "return";
/** What may come before a regular expression; after anything else a slash is a division. */
const REGEX_AFTER: ReadonlySet<number> = new Set(
  Array.from("(,=:[!&|?{;", (c) => c.charCodeAt(0)),
);

export function regexMayStart(m: Machine): boolean {
  const prev = m.prevCode;
  if (prev === 0 || REGEX_AFTER.has(prev)) return true;
  if (prev === Char.Greater) return m.text.charCodeAt(m.prevIndex - 1) === Char.Equals; // `=>`
  const start = m.prevIndex - RETURN_WORD.length + 1;
  if (start < 0 || !m.text.startsWith(RETURN_WORD, start)) return false;
  return start === 0 || !isWordCode(m.text.charCodeAt(start - 1));
}

export function enterRegex(m: Machine, i: number): number {
  m.mode = Mode.Regex;
  m.regexClass = false;
  m.mask[i] = CharRole.Text;
  m.prevCode = Char.Slash;
  m.prevIndex = i;
  return i + 1;
}

/** Ends at its line like an unterminated string, so a misread slash costs one line at most. */
export function stepRegex(m: Machine, i: number): number {
  const code = m.text.charCodeAt(i);
  if (code === Char.Newline) return endAtNewline(m, i);
  m.mask[i] = CharRole.Text;
  if (code === Char.Backslash && m.text.charCodeAt(i + 1) !== Char.Newline) {
    m.mask[i + 1] = CharRole.Text;
    return i + 2;
  }
  if (code === Char.OpenBracket) m.regexClass = true;
  if (code === Char.CloseBracket) m.regexClass = false;
  if (code === Char.Slash && !m.regexClass) m.mode = Mode.Code;
  return i + 1;
}
