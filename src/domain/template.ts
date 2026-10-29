import { isAbsolute, normalize, relative, SEPARATOR } from "@std/path";
import { canonicalBlockBody } from "./merge_block.ts";
import { linkIdentity } from "./context_link.ts";

/** The structured JSON merges a template file may ask for — see `TemplateFile.mergeJson`. */
export type MergeJsonFlavor = "claude-settings" | "codex-hooks";

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
   *   - `"claude-settings"` — `.claude/settings.json` (Claude Code): the
   *     hook splice, plus `permissions.ask` and the plugin declarations.
   *   - `"codex-hooks"` — `.codex/hooks.json` (Codex): the hook splice only.
   *
   *   The splice (`hook_settings_merge.ts`) replaces Specnaut's own entries in
   *   place and never touches the user's. Other top-level fields (theme, env,
   *   attribution, MCP, etc.) are passed through verbatim.
   *
   * JSON-merged files are NEVER raised as conflicts (`detectConflicts`
   * skips them, same as `mergeBlock` and `skipIfExists`).
   */
  mergeJson?: MergeJsonFlavor;
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
  /**
   * When `true`, the file is the **project's**, not a placeholder Specnaut may
   * refresh: once it exists, nothing rewrites it — not `upgrade --force`, not
   * `init --force` (spec 038, FR-004). Always paired with `skipIfExists`, which
   * `ownershipFields` derives from it; the writer's `keepsProjectFile` reads it.
   */
  projectOwned?: true;
  /**
   * When set, the destination is written as a **relative symlink** with this
   * text — relative to the destination's own directory, `/` separators
   * (cli#680, cli#681). `content` is then the fallback: the one-line file
   * written where the system refuses links. Keeping the fallback in `content`
   * means every consumer that reads content — reach tests, size guards, diff —
   * reads an honest string rather than an empty one.
   *
   * The lock records `linkIdentity(symlinkTo)` whichever form was written
   * (`lockShaInput`), and `upgrade` classifies the destination by what `lstat`
   * sees there (`context_link.ts`), never by reading through it.
   */
  symlinkTo?: string;
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
 * Throws if the destination path is unsafe: absolute, an attempt to escape the
 * target directory via "..", the target directory itself, or a name the
 * filesystem may read as something else. Pure — no IO.
 *
 * The last two because a destination names a file (cli#669). `.` (or `a/..`,
 * `""`, `./`) names the project: `deletePaths` with `backupExisting` renamed
 * the whole project folder aside on one. A trailing separator makes the kernel
 * follow a leaf link the containment check took as is, and Windows drops a
 * segment's trailing dots and spaces, so `...` names the project there too.
 */
export function assertSafeDestination(dest: string): void {
  const normalized = normalize(dest);
  if (isAbsolute(normalized)) {
    throw new Error(`Unsafe destination (absolute path): ${dest}`);
  }
  if (normalized.replace(/[\\/]+$/, "") === ".") {
    throw new Error(`Unsafe destination (the target directory itself): ${dest}`);
  }
  if (
    normalized === ".." ||
    normalized.startsWith(`..${SEPARATOR}`) ||
    normalized.includes(`${SEPARATOR}..${SEPARATOR}`) ||
    normalized.endsWith(`${SEPARATOR}..`)
  ) {
    throw new Error(`Unsafe destination (escape attempt): ${dest}`);
  }
  if (/[\\/]$/.test(normalized) || normalized.split(/[\\/]/).some((s) => /[. ]$/.test(s))) {
    throw new Error(`Unsafe destination (a name the filesystem may read differently): ${dest}`);
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

/**
 * The string whose sha256 `installed.lock` records for a bundle entry — the one
 * statement of it.
 *
 * Init, the upgrade plan and the upgrade's lock rebuild each spelled this out
 * on their own, and the comment beside the third copy said why that was a
 * hazard: a divergence between them is what caused #163's false "customized"
 * reports on `.gitignore`. A context link is hashed on its link identity, so
 * the link and its fallback record the same sha; a merge block on its
 * canonical body only, because that is all the comparison on disk can extract
 * from a user-owned file; everything else on its content.
 */
export function lockShaInput(file: TemplateFile): string {
  if (file.symlinkTo !== undefined) return linkIdentity(file.symlinkTo);
  return file.mergeBlock !== undefined ? canonicalBlockBody(file.content) : file.content;
}
