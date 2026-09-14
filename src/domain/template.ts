import { isAbsolute, normalize, relative, SEPARATOR } from "@std/path";

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
   * When set, the file is treated as a *structured JSON merge* rather than a
   * fenced text block. The bundled `content` is parsed as JSON, and a
   * flavor-specific splice rule grafts our keys into any pre-existing file
   * at the destination — preserving every other field the user has set.
   *
   * Currently supported flavors:
   *
   *   - `"claude-settings"` — `.claude/settings.json` (Claude Code).
   *     Splice rule: for each `hooks.<event>` entry in our content, append
   *     it to the user's existing matcher group (or create one). The match
   *     key is the hook's `command:` path — re-running is idempotent.
   *     Other top-level fields (theme, permissions, env, attribution,
   *     plugins, MCP, etc.) are passed through verbatim.
   *
   * JSON-merged files are NEVER raised as conflicts (`detectConflicts`
   * skips them, same as `mergeBlock` and `skipIfExists`).
   */
  mergeJson?: "claude-settings";
  /**
   * Refuse the merge when the host file already contains this pattern OUTSIDE
   * Specnaut's own block.
   *
   * A merge block is non-destructive by construction, but "non-destructive" is
   * not the same as "always safe to add". A TOML file that already declares
   * `[agents]` cannot receive a second `[agents]` header: the result does not
   * parse, so a block appended in good faith would break the user's config to
   * deliver a default. Declarative rather than a callback so it survives
   * bundling, and checked in the application layer, which owns the warnings
   * channel a refusal has to reach.
   *
   * `pattern` is compiled with the `m` flag by its consumers.
   */
  mergeRefuseIf?: { readonly pattern: string; readonly message: string };
  /**
   * When set, the destination file is **user-owned** but carries exactly one
   * Specnaut-managed section, fenced inside the bundled `content` by Markdown
   * comment markers bearing this label.
   *
   * Unlike `mergeBlock`, the bundled `content` here is a whole document, not
   * a block body: on a greenfield destination the entire file is written
   * (fences and all). It is only on a destination that already exists that
   * the fenced section alone is merged in — replaced in place if a block with
   * the same label is there, appended to the end otherwise. Every surrounding
   * line stays byte-identical.
   *
   * This is the `AGENTS.md` case (#466): the file accumulates project-specific
   * working agreements no template can reconstruct, so `upgrade` must never
   * rewrite it — but the chain rules only work from the always-in-context
   * carrier, so the one section Specnaut owns still has to reach a project
   * that upgrades rather than one that inits fresh.
   *
   * Always paired with `skipIfExists`.
   *
   * A destination may declare **more than one** label. It was a single string
   * until #576, which needed a second, separately-revocable block on the same
   * file: one fence, one subject, so a user deleting a block knows what they
   * are revoking. Read it through `managedSectionLabels` rather than branching
   * on the union at each call site — three call sites branching their own way
   * is how the two shapes drift apart.
   */
  managedSection?: string | readonly string[];
  /**
   * When `true`, the file is treated as a placeholder: the bundled `content`
   * is only written when no file already exists at the destination. If a
   * file is already there (e.g. brownfield project with an existing
   * `AGENTS.md`), the binary leaves it untouched, no error, no `--force`
   * needed. The user's existing content is always more useful than the
   * empty placeholder we ship.
   *
   * Skip-if-exists files that pre-existed are NOT recorded in
   * `installed.lock` — they are user-owned, not Specnaut-managed.
   */
  skipIfExists?: true;
};

export type Bundle = Record<string, TemplateFile>;

/**
 * True when `target` is `root` itself or lies beneath it. Pure — no IO, and
 * that is the whole point: this is the half of containment that can be decided
 * from two strings, so it can live here beside the string rule below instead of
 * inside the adapter that happens to need it first.
 *
 * **Both arguments must already be resolved the same way.** Comparing a
 * `realPath`'d root against a lexical candidate returns a `../..` chain for
 * every path on macOS, where a temp directory sits under the `/var` →
 * `/private/var` link — so the caller either resolves both sides or neither.
 * Reproduced in both directions before this function existed.
 *
 * `relative()`, never a string prefix. A prefix test hardcodes the POSIX
 * separator, so it silently never fires on Windows — `pruneEmptyParents` below
 * shipped exactly that bug once — and it is wrong on POSIX too: `/a/bc` starts
 * with `/a/b` while being nowhere inside it.
 *
 * Equality counts as inside: `relative(root, root)` is `""`, and a root is not
 * outside itself.
 */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel);
}

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

/**
 * The declared managed-section labels of a template file, as a list.
 *
 * The single home for normalising `string | readonly string[] | undefined`.
 * `bundle-templates.ts` imports it rather than keeping its own copy: the
 * validator and the runtime must agree on what "declared" means, and two
 * spellings of that answer is exactly the defect a build-time fence check
 * exists to catch.
 */
export function managedSectionLabels(
  declared: string | readonly string[] | undefined,
): readonly string[] {
  if (declared === undefined) return [];
  return typeof declared === "string" ? [declared] : declared;
}
