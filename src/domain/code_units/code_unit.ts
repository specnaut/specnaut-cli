import { isDigitCode, isWordCode } from "./char_codes.ts";

/** What the estimator found, one per function or class. Estimated, never measured (FR-006). */
export type CodeUnitKind = "function" | "class";

export interface CodeUnit {
  readonly path: string;
  readonly kind: CodeUnitKind;
  readonly name: string | null;
  readonly startLine: number;
  readonly lines: number;
}

/** A unit whose extent is still being read: `lines` grows until it closes. */
export type OpenUnit = { -readonly [K in keyof CodeUnit]: CodeUnit[K] };

/** A unit at its head line, one line long until its extent is read, its name allowlisted. */
export function openCodeUnit(
  path: string,
  kind: CodeUnitKind,
  name: string | null,
  startLine: number,
): OpenUnit {
  return { path, kind, name: identifierOrNull(name), startLine, lines: 1 };
}

const MAX_NAME_LENGTH = 80;

/** Words longer than any name are never sliced out of the text at all. */
export function wordOrNull(text: string, start: number, end: number): string | null {
  return end - start > MAX_NAME_LENGTH ? null : text.slice(start, end);
}

/**
 * A name reaches a report an agent reads, so it is an allowlist, not an escape (plan S2, FR-014):
 * an ASCII identifier of at most 80 characters, or null. Non-ASCII letters go too: they cannot be
 * told from a homoglyph or a bidi control here, and the unit is still counted.
 *
 * Rebuilt character by character because a slice of a long string can keep the whole file alive
 * through the engine's sliced strings, and a unit carries no other text (plan P5).
 */
export function identifierOrNull(word: string | null): string | null {
  if (word === null || word.length === 0 || word.length > MAX_NAME_LENGTH) return null;
  let copy = "";
  for (let i = 0; i < word.length; i++) {
    const code = word.charCodeAt(i);
    if (code >= 0x80 || !isWordCode(code) || (i === 0 && isDigitCode(code))) return null;
    copy += word[i];
  }
  return copy;
}
