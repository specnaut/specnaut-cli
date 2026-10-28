import { basename, dirname, isAbsolute, join, parse, relative, SEPARATOR } from "@std/path";
import { isInside } from "../domain/template.ts";
import { walkLinkText } from "./fs_link_walk.ts";

/**
 * The filesystem half of containment (cli#574). The pure half — comparing two
 * resolved strings — is `isInside` in the domain; this module is the part that
 * needs `Deno.realPath`, and it is a module of its own rather than a function
 * inside `DenoFsWriter` for one reason: **seven other adapters have to ask the
 * same question.** `FsLockStore`, `FsUpgradeMarkerStore`, `FsPreserveStore`,
 * `SpecCacheWriter`, the backlog-config stub and the cloud-config writer all
 * build paths under a project directory and none of them has any business
 * importing the bundle writer to find out whether a path is safe.
 *
 * The plan's first decision table put this inside `deno_fs_writer.ts`. That
 * address would have forced every one of those callers into an adapter-to-
 * adapter import or a local copy of the predicate — the exact duplication the
 * table exists to prevent, arriving through the table itself.
 */

/**
 * Resolves the project directory once, so every containment question in one
 * operation is asked against the same root.
 *
 * `realPath`, not `resolve`: on macOS a temp directory sits under the `/var` →
 * `/private/var` symlink, so a lexically-resolved root compared against a
 * `realPath`'d candidate reports every path in the project as outside it.
 *
 * Refuses `/` and the user's home directory. `realPath` can only ever move a
 * root UP a link, never down, so a project reached through a link that resolves
 * to something broad would make everything under that breadth count as inside.
 * Nobody scaffolds into `/` or `$HOME` on purpose, and refusing costs nothing.
 */
export async function resolveProjectRoot(projectDir: string): Promise<string> {
  const root = await Deno.realPath(projectDir);
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  // `parse().root` rather than a literal: on Windows a filesystem root is
  // `C:\\` or `\\\\server\\share\\`, never the single separator the first
  // version compared against — so that branch was dead on the one platform it
  // was written for.
  if (root === parse(root).root) {
    throw new Error(`refusing to operate with the filesystem root as the project: ${root}`);
  }
  if (home !== undefined && home !== "" && root === await Deno.realPath(home).catch(() => home)) {
    throw new Error(`refusing to operate with the home directory as the project: ${root}`);
  }
  return root;
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
async function resolveDeepestExisting(p: string): Promise<string> {
  const missing: string[] = [];
  let cur = p;
  for (;;) {
    try {
      const real = await Deno.realPath(cur);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
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
    // The link text is walked one segment at a time from a real directory
    // (cli#686), never `join`ed whole. `join` collapses `..` lexically, and the
    // kernel only applies a `..` after following the component before it: with
    // `s -> outside/deep`, the text `s/../evil` is `outside/evil` to the kernel
    // and `<dir>/evil` to `join`. Nor can the raw string be handed to the OS to
    // walk: under a scoped `--allow-read`, Deno normalises a path before the
    // syscall, so `lstat("s/../evil")` answers for `<dir>/evil` — the same
    // lexical misreading, one layer down.
    const link = await Deno.readLink(cur);
    cur = isAbsolute(link)
      ? await walkLinkText(parse(link).root, link.slice(parse(link).root.length))
      : await walkLinkText(await resolveDeepestExisting(dirname(cur)), link);
  }
  // A cycle never reaches a non-symlink, so the cap is what ends it.
  // `FilesystemLoop` on purpose: `assertInsideProject` already turns that into
  // a refusal that names the path, and a cycle and a 41-deep chain are the same
  // unusable path from a caller's side.
  throw new Deno.errors.FilesystemLoop(
    `more than ${MAX_SYMLINK_HOPS} symlink hops from ${abs}`,
  );
}

/**
 * Throws unless `abs` resolves inside `root`. `root` must come from
 * `resolveProjectRoot` — both sides resolved the same way, or the comparison is
 * meaningless.
 *
 * THROWS rather than returning a boolean, and that is the decision: a predicate
 * handing back `true`/`false` hands the verdict to every caller, and the
 * codepath this lands in already has a working "skip this dest and continue"
 * idiom one line from the natural insertion point. One refusal, one shape.
 *
 * The message names the destination, where it resolved to, AND the root — the
 * last one because a root that resolved wider than the user expected is
 * otherwise invisible.
 */
export async function assertInsideProject(root: string, abs: string): Promise<void> {
  let resolved: string;
  try {
    resolved = await resolveTarget(abs);
  } catch (err) {
    // A symlink cycle cannot be written through — the kernel refuses it too —
    // but it surfaced as a raw `FilesystemLoop` with a `realpath` in the text,
    // which tells the user nothing about their project. Refuse it the same way
    // as an escape: the path is unusable either way, and the message should say
    // which path. Deliberately narrow — every other error still propagates, so
    // a permission problem is not silently reported as a bad layout.
    if (!(err instanceof Deno.errors.FilesystemLoop)) throw err;
    throw loopRefusal(root, abs);
  }
  if (isInside(root, resolved)) return;
  throw leavesRefusal(root, abs, resolved);
}

const loopRefusal = (root: string, abs: string) =>
  new Error(
    `refusing to touch a path whose symlinks form a cycle:\n` +
      `  path:    ${abs}\n` +
      `  project: ${root}\n` +
      `Follow the links from that path and break the loop.`,
  );

const leavesRefusal = (root: string, abs: string, resolved: string) =>
  new Error(
    `refusing to touch a path that leaves the project:\n` +
      `  path:     ${abs}\n` +
      `  resolves: ${resolved}\n` +
      `  project:  ${root}\n` +
      `A symlink in the project points outside it. Specnaut will not write, ` +
      `move, delete or read through it.`,
  );

/**
 * What a removal or a rename of `abs` acts on: the parent resolved
 * through every symlink, the leaf kept as is — removing a link removes the
 * link, not its target.
 */
async function removalTarget(abs: string): Promise<string> {
  return join(await resolveDeepestExisting(dirname(abs)), basename(abs));
}

/**
 * `assertInsideProject` for a removal or a rename: throws unless what they act
 * on is inside `root`, and is not `root` itself (cli#669).
 *
 * Not `assertInsideProject`, which follows a leaf link to its target: the check
 * judged one file and the action touched another. A link inside the project
 * pointing out was refused although removing it touches nothing outside, and a
 * link pointing at the project was judged by its target, not by itself. The
 * check and the action must name the same file.
 */
export async function assertRemovableInProject(root: string, abs: string): Promise<void> {
  let target: string;
  try {
    target = await removalTarget(abs);
  } catch (err) {
    if (!(err instanceof Deno.errors.FilesystemLoop)) throw err;
    throw loopRefusal(root, abs);
  }
  if (!isInside(root, target)) throw leavesRefusal(root, abs, target);
  if (relative(root, target) === "") {
    throw new Error(
      `refusing to remove the project directory itself:\n  path:    ${abs}\n  project: ${root}`,
    );
  }
}

/**
 * The project-relative path a removal of `abs` would actually unlink, with `/`
 * separators (see `removalTarget`). A path that resolves outside `root` comes
 * back starting with `..`.
 *
 * For callers that bound WHERE inside the project a mutation may land (cli#665):
 * `assertRemovableInProject` only answers whether it stays in the project at all.
 */
export async function resolvedRelative(root: string, abs: string): Promise<string> {
  return relative(root, await removalTarget(abs)).split(SEPARATOR).join("/");
}

/**
 * Throws unless a symlink at `abs` with text `target` would land inside
 * `root` (cli#680, cli#681).
 *
 * The link's parent is resolved through every symlink, and the text walked from
 * it segment by segment (`walkLinkText`) — how the kernel applies a relative
 * link from where it sits. A context link Specnaut writes must never become a
 * door out of the project, whatever the destination's ancestors turn out to be.
 */
export async function assertLinkTargetInProject(
  root: string,
  abs: string,
  target: string,
): Promise<void> {
  const parent = await resolveDeepestExisting(dirname(abs));
  const landing = isAbsolute(target) ? target : await walkLinkText(parent, target);
  if (!isInside(root, landing)) throw leavesRefusal(root, abs, landing);
}
