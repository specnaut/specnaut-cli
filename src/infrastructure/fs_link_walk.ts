import { basename, dirname, isAbsolute, join, parse } from "@std/path";

/**
 * Where a path or a symlink's text leads, walked the way the kernel walks it
 * (cli#574, cli#686), for `fs_containment.ts`. A module of its own so the
 * containment module stays the one place that answers "inside or not", and
 * this one the place that answers "where does this lead". Only containment
 * imports it: everything else asks containment.
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

/**
 * The deepest ancestor of `p` that exists, resolved, with whatever remainder
 * did not exist appended back on.
 *
 * A destination normally does not exist yet — that is the point of writing it —
 * and neither may two directories above it. `Deno.realPath` throws on any of
 * that, so the walk goes up until something resolves. Appending the remainder
 * is safe because `assertSafeDestination` has already excluded `..` and
 * absolute segments upstream: an unresolved tail cannot re-enter the project
 * from outside it, nor leave it from inside.
 */
export async function resolveDeepestExisting(p: string): Promise<string> {
  const missing: string[] = [];
  let cur = p;
  for (;;) {
    try {
      const real = await Deno.realPath(cur);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    // NotFound for a dangling link too — not absent: what lies under it depends
    // on a target that may be created later (cli#686). Fail closed.
    const seen = await Deno.lstat(cur).then(() => true, (e) => {
      if (e instanceof Deno.errors.NotFound) return false;
      throw e;
    });
    if (seen) throw new UnwalkableLinkError(cur);
    const parent = dirname(cur);
    // `dirname("/") === "/"`: nothing above us resolved, so there is nothing
    // left to resolve against. Returning `p` unchanged makes the comparison
    // lexical, which for a path with no existing ancestor is the only honest
    // answer available.
    if (parent === cur) return p;
    missing.push(basename(cur));
    cur = parent;
  }
}

/**
 * Deno's own limit is around 40; anything past a handful is a cycle in practice.
 */
const MAX_SYMLINK_HOPS = 40;

/** Where the symlink at `abs` points, one hop, walked as the kernel walks it. */
async function followLink(abs: string): Promise<string> {
  const link = await Deno.readLink(abs);
  if (!isAbsolute(link)) return walkLinkText(await resolveDeepestExisting(dirname(abs)), link);
  const root = parse(link).root;
  return walkLinkText(root, link.slice(root.length));
}

/**
 * The path a mutation or read of `abs` would actually land on, with symlinks
 * followed as the kernel would follow them.
 *
 * Three states, distinguished with `lstat` and never by catching one exception:
 *
 *  1. **Absent** — resolve the parent and append the leaf. Nothing to follow.
 *  2. **A symlink** — follow it, one hop at a time, until the leaf is not a
 *     link. A *dangling* link resolves to where it points rather than to
 *     nothing: `Deno.writeTextFile` on a dangling link CREATES the target, so
 *     treating "cannot resolve" as "does not exist" is itself the escape this
 *     function exists to close.
 *  3. **Anything else** — `realPath`.
 *
 * The naive version of this is "try `realPath(abs)`, fall back to the parent on
 * `NotFound`". It is wrong, and quietly: `realPath` raises `NotFound` for a
 * dangling link and for an absent file alike, so the fallback says "inside" for
 * a link pointing anywhere at all.
 *
 * An earlier version of this comment claimed `realPath` does NOT throw on a
 * dangling link. That was false, and it was false because the probe that
 * "measured" it had already written through the link and created the target
 * before asking. The correction is kept here: a measurement taken after the
 * state it measures has changed is not a measurement.
 */
export async function resolveTarget(abs: string): Promise<string> {
  let cur = abs;
  for (let hops = 0; hops <= MAX_SYMLINK_HOPS; hops++) {
    let info: Deno.FileInfo | null;
    try {
      info = await Deno.lstat(cur);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      info = null;
    }

    // Absent: nothing left to follow. Resolve through the ancestors that do
    // exist and keep the rest lexically.
    if (info === null) return await resolveDeepestExisting(cur);

    if (!info.isSymlink) return await Deno.realPath(cur);

    // ITERATES. The first version followed exactly ONE hop and handed the
    // result to `resolveDeepestExisting`, which treats a second hop whose
    // target does not exist as "missing" and re-appends it lexically. Two
    // links were enough:
    //
    //     proj/a -> proj/b
    //     proj/b -> outside/target      (target absent)
    //
    // `resolveTarget` returned `proj/b` — inside — while a write to `proj/a`
    // created `outside/target`. Reproduced. It is the round-1 defect one hop
    // further out, in the same function, surviving the round-1 fix: the reason
    // to loop rather than to special-case is that any fixed depth is the same
    // bug waiting for one more link.
    //
    // The text is walked segment by segment, never `join`ed whole (cli#686):
    // see `walkLinkText` for why, and why the raw string cannot go to the OS.
    cur = await followLink(cur);
  }
  // A cycle never reaches a non-symlink, so the cap is what ends it.
  // `FilesystemLoop` on purpose: `assertInsideProject` already turns that into
  // a refusal that names the path, and a cycle and a 41-deep chain are the same
  // unusable path from a caller's side.
  throw new Deno.errors.FilesystemLoop(
    `more than ${MAX_SYMLINK_HOPS} symlink hops from ${abs}`,
  );
}
