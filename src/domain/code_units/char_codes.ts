/** Plain character checks: the estimator runs no regular expression on file content (FR-006). */
export const Char = {
  Tab: 9,
  Newline: 10,
  Return: 13,
  Space: 32,
  DoubleQuote: 34,
  Ampersand: 38,
  Apostrophe: 39,
  OpenParen: 40,
  CloseParen: 41,
  Comma: 44,
  Minus: 45,
  Dot: 46,
  Slash: 47,
  Colon: 58,
  Semicolon: 59,
  Less: 60,
  Equals: 61,
  Greater: 62,
  OpenBracket: 91,
  Backslash: 92,
  CloseBracket: 93,
  OpenBrace: 123,
  Pipe: 124,
  CloseBrace: 125,
} as const;

export function isSpaceCode(code: number): boolean {
  return code === Char.Space || code === Char.Tab || code === Char.Newline || code === Char.Return;
}

/**
 * A word for the scanners: ASCII identifier characters and anything non-ASCII, so `naïve(` is one
 * word that fails the name allowlist rather than two that pass it.
 */
export function isWordCode(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || isDigitCode(code) ||
    code === 95 || code === 36 || code >= 0x80;
}

export function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** The index just past the run of word characters starting at `start`. */
export function wordEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && isWordCode(text.charCodeAt(end))) end++;
  return end;
}
