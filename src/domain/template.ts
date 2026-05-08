import { isAbsolute, normalize, SEPARATOR } from "@std/path";

export type TemplateFile = {
  content: string;
  executable: boolean;
  /**
   * When set, the file is written as an *append-block* into any pre-existing
   * file at the destination. The string is the human-readable label used in
   * the fence markers. `content` carries the body of the block only (no
   * markers — those are injected by the adapter).
   *
   * Idempotent across re-runs: if a block with the same label already exists
   * on disk, it is replaced; otherwise it is appended to the end.
   */
  mergeBlock?: string;
  /**
   * When `true`, the file is treated as a placeholder: the bundled `content`
   * is only written when no file already exists at the destination. If a
   * file is already there (e.g. brownfield project with an existing
   * `AGENTS.md`), the binary leaves it untouched, no error, no `--force`
   * needed. The user's existing content is always more useful than the
   * empty placeholder we ship.
   *
   * Skip-if-exists files that pre-existed are NOT recorded in
   * `installed.lock` — they are user-owned, not Specflow-managed.
   */
  skipIfExists?: true;
};

export type Bundle = Record<string, TemplateFile>;

/**
 * Throws if the destination path is unsafe: absolute, or attempts to escape
 * the target directory via "..". Pure — no IO.
 */
export function assertSafeDestination(dest: string): void {
  const normalized = normalize(dest);
  if (isAbsolute(normalized)) {
    throw new Error(`Unsafe destination (absolute path): ${dest}`);
  }
  if (
    normalized === ".." ||
    normalized.startsWith(`..${SEPARATOR}`) ||
    normalized.includes(`${SEPARATOR}..${SEPARATOR}`) ||
    normalized.endsWith(`${SEPARATOR}..`)
  ) {
    throw new Error(`Unsafe destination (escape attempt): ${dest}`);
  }
}
