import { PathRefusal } from "../domain/path_refusal.ts";
import { UnwalkableLinkError } from "./fs_link_walk.ts";

/**
 * The refusals `fs_containment.ts` throws, each naming the path it refused and
 * the project it was judged against. Their own module so the containment
 * checks read as checks.
 */

/**
 * A path whose resolution threw, refused by name. A symlink cycle cannot be
 * written through — the kernel refuses it too — but it surfaced as a raw
 * `FilesystemLoop` with a `realpath` in the text, which tells the user nothing
 * about their project; a link through a missing directory has no landing at
 * all. Deliberately narrow — every other error still propagates, so a
 * permission problem is not silently reported as a bad layout.
 */
export function refuseUnusable(root: string, abs: string, err: unknown): never {
  if (err instanceof UnwalkableLinkError) throw unwalkableRefusal(root, abs, err.missing);
  if (err instanceof Deno.errors.FilesystemLoop) throw loopRefusal(root, abs);
  throw err;
}

/** A path refused because it loops or leaves the project: a reader may report it instead of aborting. */
export class ContainmentRefusal extends PathRefusal {}

export const loopRefusal = (root: string, abs: string) =>
  new ContainmentRefusal(
    `refusing to touch a path whose symlinks form a cycle:\n` +
      `  path:    ${abs}\n` +
      `  project: ${root}\n` +
      `Follow the links from that path and break the loop.`,
  );

/** The refusal for a link through a missing directory: a reader reports it as absent. */
export class UnwalkableRefusal extends PathRefusal {}

export const unwalkableRefusal = (root: string, abs: string, missing: string) =>
  new UnwalkableRefusal(
    `refusing to touch a path whose symlink passes through a directory that does not exist:\n` +
      `  path:    ${abs}\n` +
      `  missing: ${missing}\n` +
      `  project: ${root}\n` +
      `Where it lands would depend on directories created later, so Specnaut ` +
      `cannot tell whether it stays inside the project. Fix or remove that link.`,
  );

export const leavesRefusal = (root: string, abs: string, resolved: string) =>
  new ContainmentRefusal(
    `refusing to touch a path that leaves the project:\n` +
      `  path:     ${abs}\n` +
      `  resolves: ${resolved}\n` +
      `  project:  ${root}\n` +
      `A symlink in the project points outside it. Specnaut will not write, ` +
      `move, delete or read through it.`,
  );

/**
 * The staging tree reached through a link (cli#687): everything it lists and
 * deletes would be the link's target, real project files, removed as "stale
 * staged copies". Refused, never followed.
 */
export const linkedStagingRefusal = (root: string, abs: string) =>
  new ContainmentRefusal(
    `refusing to use a staging directory reached through a symlink:\n` +
      `  path:    ${abs}\n` +
      `  project: ${root}\n` +
      `Specnaut stages its own copies there and deletes them; through a link, it would ` +
      `delete whatever the link points at.`,
  );
