import { dirname, join, normalize } from "@std/path/posix";

/**
 * Context links (cli#680, cli#681): a harness context file — `.claude/CLAUDE.md`,
 * `.codex/AGENTS.md` — that Specnaut writes as a relative symlink to the
 * project's root `AGENTS.md`, so one file is the always-on instruction set on
 * every harness. Where a link cannot be made, the destination gets a one-line
 * fallback file pointing at the same target.
 *
 * This module decides what is on disk at such a destination. It is pure: the
 * reader hands it what `lstat` and `readLink` saw, never content read THROUGH
 * the link — reading through `.claude/CLAUDE.md` reads `AGENTS.md`, and a sha
 * of that says nothing about the link.
 */

/** What is at a path, judged with `lstat`: the link itself, never its target. */
export type DiskEntry =
  | {
    readonly kind: "symlink";
    /** The link's text, as `readLink` returns it. */
    readonly target: string;
    /**
     * Where the link finally lands, project-relative with `/` separators;
     * starts with `..` when it leaves the project, `null` when it cannot be
     * followed (a cycle).
     */
    readonly resolved: string | null;
    /**
     * Set when the link was read on Windows, where `\` separates path segments
     * and is what Windows itself writes into a link. Elsewhere a `\` is a
     * literal character in a file name.
     */
    readonly windows?: true;
  }
  | {
    readonly kind: "file";
    readonly content: string;
    /**
     * Set when `content` is not the file's bytes — they are not valid UTF-8, so
     * decoding replaced some of them. Writing `content` back would not
     * reproduce the file, so nothing that MOVES a file may move this one.
     */
    readonly lossy?: true;
  };

/**
 * What `upgrade` found at a context-link destination.
 *
 *   - `absent`         nothing there.
 *   - `ours-link`      a link to the target Specnaut writes.
 *   - `ours-fallback`  the one-line fallback file, as written.
 *   - `materialised`   a plain file holding the link's own text: a clone with
 *                      `core.symlinks=false` checks a link out this way, and
 *                      the harness reads it as one line of memory, no import.
 *   - `generated`      a file the lock says Specnaut wrote, untouched since.
 *   - `customized`     any other file: the user's own content.
 *   - `foreign-link`   a link somewhere else.
 *   - `inverted`       the target itself links back to this destination — the
 *                      project consolidated the other way round. Relinking
 *                      would make a cycle and leave the user's only copy in a
 *                      `.specnaut.bak`.
 */
export type LinkState =
  | "absent"
  | "ours-link"
  | "ours-fallback"
  | "materialised"
  | "generated"
  | "customized"
  | "foreign-link"
  | "inverted";

/**
 * Whose a context link's disk state is — the one ownership rule `diff` and
 * `upgrade` both answer by. An exhaustive `switch`, so a new `LinkState` fails
 * to compile here rather than falling into a default somewhere else.
 *
 *  - `ours`: what Specnaut writes, as written. Nothing to do.
 *  - `rewritable`: Specnaut's own, but not in its current form (absent, a
 *    generated file, a link git checked out as text). Rewritten without asking.
 *  - `theirs`: the user's — an edited file, a foreign link, or `AGENTS.md`
 *    linked the other way round. Never rewritten without a backup.
 */
export function linkOwnership(state: LinkState): "ours" | "rewritable" | "theirs" {
  switch (state) {
    case "ours-link":
    case "ours-fallback":
      return "ours";
    case "absent":
    case "materialised":
    case "generated":
      return "rewritable";
    case "customized":
    case "foreign-link":
    case "inverted":
      return "theirs";
  }
}

/**
 * The string `installed.lock` hashes for a context link — whichever form was
 * written. Recording the written form instead would make a committed lock
 * change between a contributor whose system makes links and one whose does not.
 */
export function linkIdentity(target: string): string {
  return `specnaut-symlink:${target}`;
}

/**
 * The project-relative path the bundle's own link text, `target`, points at
 * from `dest`: `../AGENTS.md` from `.claude/CLAUDE.md` is `AGENTS.md`. Lexical,
 * `/` separators — for text Specnaut wrote, never for text read off disk, which
 * `isOurLinkText` judges as text.
 */
export function linkTargetPath(dest: string, target: string): string {
  return normalize(join(dirname(dest), target));
}

/**
 * Whether a link's text, read off disk, is the one Specnaut writes: exactly
 * `symlinkTo`, or on Windows its `\` spelling, which Windows itself writes.
 *
 * Compared as text, never as a normalised path (cli#687). Normalising read
 * `\` as a separator everywhere, so on POSIX `a\b/../../../AGENTS.md` — where
 * `a\b` is one segment and the link climbs out of the project — was classed as
 * ours and left in place. Any other spelling, even one landing on `AGENTS.md`,
 * is not ours: being ours is what lets a link be kept without a backup.
 */
export function isOurLinkText(text: string, symlinkTo: string, windows: boolean): boolean {
  return text === symlinkTo || (windows && text === symlinkTo.replaceAll("/", "\\"));
}

/** What the classifier is told about one destination. */
export type LinkEvidence = {
  readonly disk: DiskEntry | null;
  /** sha256 of `disk.content` when it is a file. */
  readonly diskSha?: string;
  readonly lockSha?: string;
  /** What is at the link's target (the root `AGENTS.md`). */
  readonly targetEntry: DiskEntry | null;
};

/** Trailing newlines are noise here: an editor or `core.autocrlf` adds them. */
const trimEnd = (s: string) => s.replace(/(\r?\n)+$/, "");

/**
 * Classify what is at a context-link destination. The order is the rule:
 * an inverted consolidation wins over everything, because every other answer
 * leads to a write at `dest` — and there, `dest` is the user's only copy.
 */
export function classifyLinkDisk(
  dest: string,
  link: { readonly symlinkTo: string; readonly content: string },
  ev: LinkEvidence,
): LinkState {
  if (ev.targetEntry?.kind === "symlink" && ev.targetEntry.resolved === dest) return "inverted";
  const disk = ev.disk;
  if (disk === null) return "absent";
  if (disk.kind === "symlink") {
    return isOurLinkText(disk.target, link.symlinkTo, disk.windows === true)
      ? "ours-link"
      : "foreign-link";
  }
  const text = trimEnd(disk.content);
  if (text === trimEnd(link.content)) return "ours-fallback";
  // Git stores a link's text with `/` on every system, Windows included, so a
  // link checked out as a file holds exactly `symlinkTo` when it is ours.
  if (text === link.symlinkTo) return "materialised";
  if (ev.diskSha !== undefined && ev.diskSha === ev.lockSha) return "generated";
  return "customized";
}
