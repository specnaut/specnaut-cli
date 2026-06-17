/**
 * Append-block helpers for `mergeable-project-root` files (e.g. `.gitignore`).
 *
 * A merge block is a labeled section in an otherwise user-owned file that
 * Specflow can write, replace, or read back without touching surrounding
 * lines. The fence markers are stable so future runs (init re-run, upgrade)
 * can find and replace the block in place.
 *
 * Pure — no IO, no Deno globals. Safe to import from domain or application.
 */

const FENCE_PREFIX = "# --- Specnaut: ";
const FENCE_SUFFIX = " ---";
const END_PREFIX = "# --- End Specnaut: ";
const END_SUFFIX = " ---";

// Back-compat: blocks written by pre-rebrand (Specflow) versions are still
// recognised so an upgrade REPLACES the legacy block in place — migrating its
// fence to the Specnaut label — rather than appending a duplicate.
const LEGACY_FENCE_PREFIX = "# --- Specflow: ";
const LEGACY_END_PREFIX = "# --- End Specflow: ";

/**
 * Locate a previously-written block for `label`, matching the current
 * (Specnaut) fence first and the legacy (Specflow) fence second. Returns the
 * fence offsets, or `null` if no complete block is present.
 */
function locateBlock(
  content: string,
  label: string,
): { startIdx: number; afterStart: number; endIdx: number; afterEnd: number } | null {
  for (
    const [sp, ep] of [
      [FENCE_PREFIX, END_PREFIX],
      [LEGACY_FENCE_PREFIX, LEGACY_END_PREFIX],
    ] as const
  ) {
    const start = `${sp}${label}${FENCE_SUFFIX}`;
    const end = `${ep}${label}${END_SUFFIX}`;
    const startIdx = content.indexOf(start);
    if (startIdx === -1) continue;
    const afterStart = startIdx + start.length;
    const endIdx = content.indexOf(end, afterStart);
    if (endIdx === -1) continue;
    return { startIdx, afterStart, endIdx, afterEnd: endIdx + end.length };
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

export function startFence(label: string): string {
  return `${FENCE_PREFIX}${label}${FENCE_SUFFIX}`;
}

export function endFence(label: string): string {
  return `${END_PREFIX}${label}${END_SUFFIX}`;
}

/** Wraps `body` in fence markers so the result is a self-delimited block. */
export function wrapInBlock(body: string, label: string): string {
  const trimmed = body.replace(/\n+$/, "");
  return `${startFence(label)}\n${trimmed}\n${endFence(label)}`;
}

/**
 * Extracts the body of a previously-written block, or `null` if no block
 * with the given label is present in `content`. The body is returned without
 * the fence markers and without trailing newlines.
 */
export function extractBlock(content: string, label: string): string | null {
  const loc = locateBlock(content, label);
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
): string {
  const block = wrapInBlock(body, label);
  if (existing === null || existing.length === 0) return `${block}\n`;

  // Replace an existing block in place (current OR legacy fence) — the
  // rewritten block always carries the current Specnaut fence.
  const loc = locateBlock(existing, label);
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
