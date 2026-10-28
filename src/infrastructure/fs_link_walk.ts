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
 * An intermediate segment that does not exist ends the walk: the rest is
 * appended lexically. The kernel refuses to traverse a missing directory, so
 * no write can land on that answer — it only has to be a string to compare.
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
      return join(next, ...segments.slice(i + 1));
    }
  }
  return cur;
}
