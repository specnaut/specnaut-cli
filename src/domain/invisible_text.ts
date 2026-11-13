/**
 * Instruction text a person approves by reading its diff: a code point that renders as nothing
 * there (a bidi control, a zero-width character, a tag character, a line or paragraph separator)
 * reorders or hides what the session reads, so a yes is never given over one. A byte order mark
 * that opens the file is an encoding mark, not text, and is left alone.
 */

const INVISIBLE = /[\p{Cf}\u{E0000}-\u{E007F}\u{2028}\u{2029}]/gu;

/**
 * The invisible code points in `bytes`, each distinct one named as `U+XXXX` (text a terminal shows
 * as it is), with the line of the first; or `null` when there is none. Bytes that are not UTF-8
 * decode to U+FFFD, which is visible.
 */
export function invisibleIn(bytes: Uint8Array): string | null {
  const whole = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  const text = whole.startsWith("\u{FEFF}") ? ` ${whole.slice(1)}` : whole;
  const found = [...text.matchAll(INVISIBLE)];
  if (found.length === 0) return null;
  const line = text.slice(0, found[0].index).split("\n").length;
  const named = [...new Set(found.map((m) => m[0]))].map(codePoint);
  return `${named.join(", ")} (line ${line})`;
}

const codePoint = (c: string): string =>
  `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
