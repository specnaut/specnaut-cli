import { braceExtents } from "./brace_extents.ts";
import { Char } from "./char_codes.ts";
import type { CodeUnit } from "./code_unit.ts";
import { indentExtents } from "./indent_extents.ts";
import type { Family } from "./language_families.ts";
import { classifyPath } from "./language_table.ts";

export type { CodeUnit } from "./code_unit.ts";

/** Both only stop an estimate, so they refuse rather than truncate (FR-006, plan § 12). */
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_LINE_BYTES = 16 * 1024;

/** The not-analysed half of FR-002's second axis. */
export const NOT_ANALYSED_REASONS = [
  "code_not_read",
  "no_units_expected",
  "too_large",
  "line_too_long",
] as const;
export type NotAnalysedReason = typeof NOT_ANALYSED_REASONS[number];

export type UnitEstimate =
  | { readonly status: "analysed"; readonly units: readonly CodeUnit[]; readonly unnamed: number }
  | { readonly status: "not_analysed"; readonly reason: NotAnalysedReason };

function utf8Bytes(code: number): number {
  if (code < 0x80) return 1;
  // Each half of a surrogate pair counts two, so the pair is the four bytes UTF-8 gives it.
  if (code < 0x800 || (code >= 0xD800 && code <= 0xDFFF)) return 2;
  return 3;
}

/**
 * Counted in UTF-8 bytes, as the adapter's read cap is: a valid UTF-8 text it accepts is never
 * refused here for size. An invalid byte was decoded as U+FFFD, three bytes here, so such a text
 * may count more than its file and be refused as too large.
 */
function capExceeded(text: string): NotAnalysedReason | null {
  let total = 0;
  let line = 0;
  let longest = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const bytes = utf8Bytes(code);
    total += bytes;
    line = code === Char.Newline ? 0 : line + bytes;
    if (line > longest) longest = line;
  }
  if (total > MAX_TEXT_BYTES) return "too_large";
  return longest > MAX_LINE_BYTES ? "line_too_long" : null;
}

function extentsOf(path: string, text: string, family: Family): readonly CodeUnit[] {
  return family.extents === "indent"
    ? indentExtents(path, text, family)
    : braceExtents(path, text, family);
}

function countUnnamed(units: readonly CodeUnit[]): number {
  let unnamed = 0;
  for (const unit of units) if (unit.name === null) unnamed++;
  return unnamed;
}

/**
 * The module's one entry: what a repository-relative path and its decoded text hold. Pure, and it
 * never throws on content. The language is decided first, so prose over a cap is still prose.
 */
export function estimateCodeUnits(path: string, text: string): UnitEstimate {
  const classification = classifyPath(path);
  if (classification.kind !== "read") {
    return { status: "not_analysed", reason: classification.kind };
  }
  const refused = capExceeded(text);
  if (refused !== null) return { status: "not_analysed", reason: refused };
  const units = extentsOf(path, text, classification.family);
  return { status: "analysed", units, unnamed: countUnnamed(units) };
}
