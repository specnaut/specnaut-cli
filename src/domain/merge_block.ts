/**
 * Append-block helpers for files Specnaut writes into without owning them.
 *
 * A merge block is a labeled section in an otherwise user-owned file that
 * Specnaut can write, replace, or read back without touching surrounding
 * lines. The fence markers are stable so future runs (init re-run, upgrade)
 * can find and replace the block in place.
 *
 * Two fence styles, because the comment syntax has to be invisible in the
 * host file:
 *
 *   - `"hash"` (default) — `# --- Specnaut: <label> ---`, for `.gitignore`
 *     and anything else where `#` starts a comment.
 *   - `"html"` — `<!-- --- Specnaut: <label> --- -->`, for Markdown. A `#`
 *     fence there is not a comment, it is an H1: it would render as a stray
 *     heading in the middle of the user's document (#466).
 *
 * Known limitation, deliberately not handled: a file where exactly one of the
 * two markers was deleted is not a block any more, so the next merge appends a
 * complete one and leaves the orphan marker in place. Both repair strategies
 * (delete to end-of-file, or strip the marker) can destroy or duplicate content
 * the user wrote, so neither is a safe guess. Deleting the whole section, or
 * neither marker, both behave correctly.
 *
 * What that paragraph did NOT say, and what made it read as considered when it
 * was not: an orphan START is only harmless while it is ALONE. An orphan START
 * sitting ABOVE a complete block used to make `locateBlock` open its span at the
 * orphan and close it at the real end fence — so `mergeIntoFile` replaced every
 * line the user had written between them. Not to end-of-file; the tail after the
 * real end fence survived, which is why it read as a well-behaved replace. The
 * trigger is an HTML comment, invisible in a rendered diff, on a file written
 * with `backupExisting: false`. `locateBlock` now resolves the end
 * fence first and walks BACK to the nearest start, which steps over the orphan
 * and replaces the real block. Appending instead would have been non-destructive
 * but not idempotent: every upgrade would add one more block.
 *
 * Pure — no IO, no Deno globals. Safe to import from domain or application.
 */

export type FenceStyle = "hash" | "html";

type FenceSpec = {
  readonly start: (label: string) => string;
  readonly end: (label: string) => string;
  /**
   * Fences written by older versions that must still be *found* (so an
   * upgrade replaces the block in place instead of appending a duplicate).
   * Never written — a rewritten block always carries the current fence.
   */
  readonly legacy: ReadonlyArray<{
    readonly start: (label: string) => string;
    readonly end: (label: string) => string;
  }>;
};

const FENCES: Record<FenceStyle, FenceSpec> = {
  hash: {
    start: (l) => `# --- Specnaut: ${l} ---`,
    end: (l) => `# --- End Specnaut: ${l} ---`,
    // Pre-rebrand (Specflow) blocks.
    legacy: [{
      start: (l) => `# --- Specflow: ${l} ---`,
      end: (l) => `# --- End Specflow: ${l} ---`,
    }],
  },
  html: {
    start: (l) => `<!-- --- Specnaut: ${l} --- -->`,
    end: (l) => `<!-- --- End Specnaut: ${l} --- -->`,
    // Introduced after the rebrand — no legacy spelling exists.
    legacy: [],
  },
};

/**
 * Locate a previously-written block for `label`, matching the current fence
 * first and any legacy fence second. Returns the fence offsets, or `null` if
 * no complete block is present.
 */
function locateBlock(
  content: string,
  label: string,
  style: FenceStyle,
): { startIdx: number; afterStart: number; endIdx: number; afterEnd: number } | null {
  const spec = FENCES[style];
  for (const pair of [{ start: spec.start, end: spec.end }, ...spec.legacy]) {
    const start = pair.start(label);
    const end = pair.end(label);
    const startIdx = content.indexOf(start);
    if (startIdx === -1) continue;
    // Resolve the END first, then the start NEAREST it. Taking the first start
    // instead opens the span at an orphan marker and closes it at the real end
    // fence, so the replace deletes every line the user wrote between them.
    // Walking back from the end picks the real block and steps over the orphan,
    // which leaves the user's content untouched AND stays idempotent — appending
    // instead would add another block on every upgrade, forever.
    const endIdx = content.indexOf(end, startIdx + start.length);
    if (endIdx === -1) continue;
    const realStart = content.lastIndexOf(start, endIdx);
    if (realStart === -1) continue;
    const afterStart = realStart + start.length;
    if (afterStart > endIdx) continue;
    return { startIdx: realStart, afterStart, endIdx, afterEnd: endIdx + end.length };
  }
  return null;
}

/**
 * Normalize a block body to its canonical form (no leading or trailing
 * newlines). Used so the lock SHA stored at init time matches the SHA of
 * the body extracted from disk on subsequent reads — the extraction also
 * trims, so both sides operate on the same canonical bytes.
 */
export function canonicalBlockBody(body: string): string {
  return body.replace(/^\n+/, "").replace(/\n+$/, "");
}

export function startFence(label: string, style: FenceStyle = "hash"): string {
  return FENCES[style].start(label);
}

export function endFence(label: string, style: FenceStyle = "hash"): string {
  return FENCES[style].end(label);
}

/** Wraps `body` in fence markers so the result is a self-delimited block. */
export function wrapInBlock(body: string, label: string, style: FenceStyle = "hash"): string {
  const trimmed = body.replace(/\n+$/, "");
  return `${startFence(label, style)}\n${trimmed}\n${endFence(label, style)}`;
}

/**
 * Extracts the body of a previously-written block, or `null` if no block
 * with the given label is present in `content`. The body is returned without
 * the fence markers and without trailing newlines.
 */
export function extractBlock(
  content: string,
  label: string,
  style: FenceStyle = "hash",
): string | null {
  const loc = locateBlock(content, label, style);
  if (!loc) return null;
  const between = content.slice(loc.afterStart, loc.endIdx);
  return between.replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * Returns `existing` with the merge block for `label` replaced (if present)
 * or appended (if absent). Idempotent: calling this twice with the same
 * `body` produces the same result.
 *
 * Greenfield (no `existing` content): returns just the wrapped block.
 */
export function mergeIntoFile(
  existing: string | null,
  body: string,
  label: string,
  style: FenceStyle = "hash",
): string {
  const block = wrapInBlock(body, label, style);
  if (existing === null || existing.length === 0) return `${block}\n`;

  // Replace an existing block in place (current OR legacy fence) — the
  // rewritten block always carries the current Specnaut fence.
  const loc = locateBlock(existing, label, style);
  if (loc) {
    const before = existing.slice(0, loc.startIdx).replace(/\n+$/, "");
    const afterBlockEnd = loc.afterEnd;
    // Skip the newline that follows the end fence, if any.
    const restStart = existing[afterBlockEnd] === "\n" ? afterBlockEnd + 1 : afterBlockEnd;
    const after = existing.slice(restStart);
    const middle = before.length > 0 ? `${before}\n\n${block}` : block;
    const trailingNewline = after.length === 0 || after.endsWith("\n") ? "" : "\n";
    const tail = after.length > 0 ? `\n${after.replace(/^\n+/, "")}${trailingNewline}` : "\n";
    return `${middle}${tail}`;
  }

  // No existing block: append to the end.
  const trimmedExisting = existing.replace(/\n+$/, "");
  return `${trimmedExisting}\n\n${block}\n`;
}

/**
 * The host file with Specnaut's own block removed.
 *
 * Needed by any check that asks "what does the USER's file contain" — our own
 * block is not the user's content, and a guard that reads it would fire on the
 * very text we wrote last run, turning an idempotent merge into a permanent
 * refusal on the second upgrade.
 */
export function withoutBlock(
  content: string,
  label: string,
  style: FenceStyle = "hash",
): string {
  const span = locateBlock(content, label, style);
  if (span === null) return content;
  return content.slice(0, span.startIdx) + content.slice(span.afterEnd);
}

/**
 * Why a merge must not happen, or `null` when it may.
 *
 * A merge block is non-destructive, but that is not the same as always safe to
 * add: appending a second `[agents]` header to a TOML file makes it
 * unparseable, so the block would break the user's config in order to deliver a
 * default. The guard is declared on the file (`mergeRefuseIf`) and evaluated
 * here so both `init` and `upgrade` reach the same verdict.
 *
 * Fails CLOSED on a bad pattern: an un-compilable regex refuses the merge
 * rather than allowing it. A guard that cannot run is not evidence that there
 * is nothing to guard against.
 */
export function mergeRefusal(
  existing: string | null,
  file: {
    readonly mergeBlock?: string;
    readonly mergeRefuseIf?: { readonly pattern: string; readonly message: string };
  },
  style: FenceStyle = "hash",
): string | null {
  const guard = file.mergeRefuseIf;
  if (guard === undefined || existing === null || existing === "") return null;
  const userContent = file.mergeBlock === undefined
    ? existing
    : withoutBlock(existing, file.mergeBlock, style);
  let re: RegExp;
  try {
    re = new RegExp(guard.pattern, "m");
  } catch {
    return guard.message;
  }
  return re.test(userContent) ? guard.message : null;
}
