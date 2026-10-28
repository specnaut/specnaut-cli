import { dirname, join } from "@std/path";

/**
 * Reading a symlink's text the way the kernel reads it (cli#686), for
 * `fs_containment.ts`. A module of its own so the containment module stays
 * the one place that answers "inside or not", and this one the place that
 * answers "where does this text lead".
 */

/** A link's text split into segments: `/` everywhere, `\` too on Windows. */
const LINK_SEPARATORS = Deno.build.os === "windows" ? /[\\/]/ : /\//;

/**
 * The path a link's `text` names, walked from `dir` — a REAL directory — the
 * way the kernel walks it: each `..` applies to the real directory reached so
 * far, and each intermediate segment is resolved (links followed) before the
 * next one is read. The last segment is returned unresolved, because the
 * caller's loop must `lstat` it to tell a further link from a file.
 *
 * An intermediate segment that does not exist — missing, or a dangling link —
 * throws `UnwalkableLinkError`. It fails closed rather than guessing. An
 * earlier version appended the rest lexically, on the grounds that the kernel
 * cannot traverse a missing directory. The writer's own `mkdir` makes it
 * traversable: with `D -> .specnaut-new/../..` and `AGENTS.md -> D/victim.txt`,
 * the guard judged `proj/D/victim.txt` inside, the bundle then created
 * `.specnaut-new/`, and the merge wrote outside the project. The answer to
 * "where does this land" depends on directories that do not exist yet, so
 * there is no answer to give.
 */
export async function walkLinkText(dir: string, text: string): Promise<string> {
  const segments = text.split(LINK_SEPARATORS).filter((s) => s !== "" && s !== ".");
  let cur = dir;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "..") {
      cur = dirname(cur);
      continue;
    }
    const next = join(cur, seg);
    if (i === segments.length - 1) return next;
    try {
      cur = await Deno.realPath(next);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      throw new UnwalkableLinkError(next);
    }
  }
  return cur;
}

/** A link's text passes through `missing`, which does not exist (yet). */
export class UnwalkableLinkError extends Error {
  constructor(readonly missing: string) {
    super(`a symlink's text passes through ${missing}, which does not exist`);
    this.name = "UnwalkableLinkError";
  }
}
