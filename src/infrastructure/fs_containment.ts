import { basename, dirname, isAbsolute, join, parse, relative, SEPARATOR } from "@std/path";
import { isInside } from "../domain/template.ts";
import { resolveDeepestExisting, resolveTarget, walkLinkText } from "./fs_link_walk.ts";
import { leavesRefusal, refuseUnusable } from "./fs_refusals.ts";

export { UnwalkableRefusal } from "./fs_refusals.ts";
export { resolveTarget } from "./fs_link_walk.ts";

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
    refuseUnusable(root, abs, err);
  }
  if (isInside(root, resolved)) return;
  throw leavesRefusal(root, abs, resolved);
}

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
    refuseUnusable(root, abs, err);
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
  let landing: string;
  try {
    landing = isAbsolute(target)
      ? target
      : await walkLinkText(await resolveDeepestExisting(dirname(abs)), target);
  } catch (err) {
    refuseUnusable(root, abs, err);
  }
  if (!isInside(root, landing)) throw leavesRefusal(root, abs, landing);
}
