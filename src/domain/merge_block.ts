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

const FENCE_PREFIX = "# --- Specflow: ";
const FENCE_SUFFIX = " ---";
const END_PREFIX = "# --- End Specflow: ";
const END_SUFFIX = " ---";

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
  const start = startFence(label);
  const end = endFence(label);
  const startIdx = content.indexOf(start);
  if (startIdx === -1) return null;
  const afterStart = startIdx + start.length;
  const endIdx = content.indexOf(end, afterStart);
  if (endIdx === -1) return null;
  const between = content.slice(afterStart, endIdx);
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

  const start = startFence(label);
  const end = endFence(label);
  const startIdx = existing.indexOf(start);
  if (startIdx !== -1) {
    const endIdx = existing.indexOf(end, startIdx + start.length);
    if (endIdx !== -1) {
      const before = existing.slice(0, startIdx).replace(/\n+$/, "");
      const afterBlockEnd = endIdx + end.length;
      // Skip the newline that follows the end fence, if any.
      const restStart = existing[afterBlockEnd] === "\n" ? afterBlockEnd + 1 : afterBlockEnd;
      const after = existing.slice(restStart);
      const middle = before.length > 0 ? `${before}\n\n${block}` : block;
      const trailingNewline = after.length === 0 || after.endsWith("\n") ? "" : "\n";
      const tail = after.length > 0 ? `\n${after.replace(/^\n+/, "")}${trailingNewline}` : "\n";
      return `${middle}${tail}`;
    }
  }

  // No existing block: append to the end.
  const trimmedExisting = existing.replace(/\n+$/, "");
  return `${trimmedExisting}\n\n${block}\n`;
}
