import { basename, dirname, isAbsolute, join, parse, relative, SEPARATOR } from "@std/path";
import { isInside } from "../domain/template.ts";
import {
  resolveDeepestExisting,
  resolveTarget,
  UnwalkableLinkError,
  walkLinkText,
} from "./fs_link_walk.ts";
import { refusalFor } from "./fs_refusals.ts";

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
 * Containment's one answer about a path (cli#692): where it lands, and whether
 * that is inside the project.
 *
 *  - `inside` / `leaves` carry where it resolved, so a caller that reports a
 *    link's landing need not resolve it a second time;
 *  - `unwalkable` carries the directory that does not exist (`walkLinkText`);
 *  - `loop` is a cycle, or a chain past the hop cap.
 *
 * A tag rather than two error vocabularies, because "this path is unusable"
 * was decided three times when callers had to catch `FilesystemLoop` and
 * `UnwalkableLinkError` themselves — in a fail-closed guard, three copies of
 * one decision is where the next hole goes unnoticed. Every other error (a
 * permission, an I/O fault, a link through a regular file) is not a verdict
 * and still throws.
 */
export type Containment =
  | { readonly kind: "inside"; readonly resolved: string }
  | { readonly kind: "leaves"; readonly resolved: string }
  | { readonly kind: "unwalkable"; readonly missing: string }
  | { readonly kind: "loop" };

/**
 * What is judged at `abs`:
 *
 *  - `"target"` — what a write or a read lands on: every link followed, the
 *    leaf included (`resolveTarget`);
 *  - `"entry"` — what a removal or a rename acts on: the ancestors resolved,
 *    the leaf kept as is, because removing a link removes the link;
 *  - `{ linkText }` — where a link written at `abs` with that text would land,
 *    walked from its resolved folder as the kernel walks it (cli#680, cli#681).
 */
export type Judged = "target" | "entry" | { readonly linkText: string };

/** Tags where `abs` lands, judged as `judged`, against `root` from `resolveProjectRoot`. */
export async function locate(root: string, abs: string, judged: Judged): Promise<Containment> {
  let resolved: string;
  try {
    resolved = await landingOf(abs, judged);
  } catch (err) {
    if (err instanceof UnwalkableLinkError) return { kind: "unwalkable", missing: err.missing };
    if (err instanceof Deno.errors.FilesystemLoop) return { kind: "loop" };
    throw err;
  }
  return isInside(root, resolved) ? { kind: "inside", resolved } : { kind: "leaves", resolved };
}

async function landingOf(abs: string, judged: Judged): Promise<string> {
  if (judged === "target") return await resolveTarget(abs);
  if (judged === "entry") return join(await resolveDeepestExisting(dirname(abs)), basename(abs));
  const text = judged.linkText;
  if (isAbsolute(text)) return text;
  return await walkLinkText(await resolveDeepestExisting(dirname(abs)), text);
}

/**
 * Throws the refusal for every verdict but `inside` (`refusalFor`), so the
 * `assert*` functions below and a reader that reports some verdicts as absent
 * share one translation.
 */
export function admit(
  root: string,
  abs: string,
  verdict: Containment,
): asserts verdict is Extract<Containment, { kind: "inside" }> {
  if (verdict.kind !== "inside") throw refusalFor(root, abs, verdict);
}

/**
 * `admit` for a removal or a rename: also refuses the project directory itself
 * (cli#669), which is inside the project and still never to be removed.
 */
export function admitRemoval(root: string, abs: string, verdict: Containment): void {
  admit(root, abs, verdict);
  if (relative(root, verdict.resolved) === "") {
    throw new Error(
      `refusing to remove the project directory itself:\n  path:    ${abs}\n  project: ${root}`,
    );
  }
}

/**
 * Throws unless `abs` resolves inside `root`. `root` must come from
 * `resolveProjectRoot` — both sides resolved the same way, or the comparison is
 * meaningless.
 *
 * THROWS rather than returning a boolean, and that is the decision: a predicate
 * handing back `true`/`false` hands the verdict to every caller, and the
 * codepath this lands in already has a working "skip this dest and continue"
 * idiom one line from the natural insertion point. One refusal, one shape. A
 * caller that needs the verdict itself asks `locate`.
 *
 * The message names the destination, where it resolved to, AND the root — the
 * last one because a root that resolved wider than the user expected is
 * otherwise invisible.
 */
export async function assertInsideProject(root: string, abs: string): Promise<void> {
  admit(root, abs, await locate(root, abs, "target"));
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
  admitRemoval(root, abs, await locate(root, abs, "entry"));
}

/**
 * The project-relative path a removal of `abs` would actually unlink, with `/`
 * separators (the `"entry"` landing). A path that resolves outside `root` comes
 * back starting with `..`.
 *
 * For callers that bound WHERE inside the project a mutation may land (cli#665):
 * `assertRemovableInProject` only answers whether it stays in the project at all.
 */
export async function resolvedRelative(root: string, abs: string): Promise<string> {
  return relative(root, await landingOf(abs, "entry")).split(SEPARATOR).join("/");
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
  admit(root, abs, await locate(root, abs, { linkText: target }));
}
