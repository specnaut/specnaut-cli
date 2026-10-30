/**
 * What every `mergeJson` flavor shares, whatever the file: how the user's side
 * is parsed, how a malformed one is reported, and how the result is written
 * and compared with the disk. The hook splice (`hook_settings_merge.ts`), the
 * Claude settings merge and the hook-trust check all read a user's JSON
 * through here, so one malformed file reads the same way to every one of them.
 *
 * Pure — no IO, no Deno globals.
 */

/** What every `mergeJson` flavor returns: the file to write, and whether it differs from disk. */
export type JsonMergeResult = { readonly content: string; readonly changed: boolean };

/**
 * Error thrown when the on-disk file of a JSON merge is not valid JSON.
 * Surfaces a clear actionable hint at the CLI level rather than a raw
 * `SyntaxError` from `JSON.parse`.
 */
export class JsonMergeParseError extends Error {
  constructor(public readonly destPath: string, override readonly cause: Error) {
    super(
      `${destPath} is not valid JSON: ${cause.message}\n` +
        `Fix the file (or back it up and re-run with --force) before re-running specnaut.`,
    );
    this.name = "JsonMergeParseError";
  }
}

/**
 * Parse the user's side of a merge. `null` means greenfield (absent or blank
 * file), where the bundled content is written verbatim.
 */
// deno-lint-ignore no-explicit-any
export function parseUserJson(existing: string | null, destPath: string): any | null {
  if (existing === null || existing.trim().length === 0) return null;
  try {
    return JSON.parse(existing);
  } catch (err) {
    throw new JsonMergeParseError(destPath, err instanceof Error ? err : new Error(String(err)));
  }
}

/** Serialise a merge (2-space indent, trailing newline) and compare it with what is on disk. */
export function jsonMergeResult(value: unknown, existing: string | null): JsonMergeResult {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  return { content, changed: content !== existing };
}
