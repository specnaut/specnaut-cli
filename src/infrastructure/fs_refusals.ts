import { PathRefusal } from "../application/path_refusal.ts";
import { terminalText } from "../domain/terminal_text.ts";
import type { Containment } from "./fs_containment.ts";

/**
 * The refusals the containment checks throw (`fs_containment.ts`, and the
 * staging store's own bounds), each naming the path it refused and the project
 * it was judged against. Their own module so the checks read as checks.
 *
 * Every path a refusal names goes through `terminalText` (cli#776): it comes
 * from the repository — a lock key, a link's target — and the refusal reaches
 * the user's terminal, where a raw escape sequence would be the repository
 * writing to it.
 */

/** A path refused because it loops or leaves the project: a reader may report it instead of aborting. */
export class ContainmentRefusal extends PathRefusal {
  constructor(message: string) {
    super(message);
    this.name = "ContainmentRefusal";
  }
}

/**
 * A path whose symlinks form a cycle. A `ContainmentRefusal` like the others, so
 * every caller that reports one keeps doing so; a class of its own so a caller
 * that must tell a cycle apart reads the type, not the message.
 */
export class LoopRefusal extends ContainmentRefusal {
  constructor(message: string) {
    super(message);
    this.name = "LoopRefusal";
  }
}

/** The refusal for a link through a missing directory: a reader reports it as absent. */
export class UnwalkableRefusal extends PathRefusal {
  constructor(message: string) {
    super(message);
    this.name = "UnwalkableRefusal";
  }
}

/**
 * The one translation of a containment verdict into a refusal (cli#692). A
 * symlink cycle cannot be written through — the kernel refuses it too — but
 * it surfaced as a raw `FilesystemLoop` with a `realpath` in the text, which
 * tells the user nothing about their project; a link through a missing
 * directory has no landing at all; a path that resolves outside the project is
 * the escape itself. Every other error never becomes a verdict, so a
 * permission problem is not silently reported as a bad layout.
 */
export function refusalFor(
  root: string,
  abs: string,
  verdict: Exclude<Containment, { kind: "inside" }>,
): PathRefusal {
  switch (verdict.kind) {
    case "leaves":
      return leavesRefusal(root, abs, verdict.resolved);
    case "unwalkable":
      return unwalkableRefusal(root, abs, verdict.missing);
    case "loop":
      return loopRefusal(root, abs);
  }
}

const loopRefusal = (root: string, abs: string) =>
  new LoopRefusal(
    `refusing to touch a path whose symlinks form a cycle:\n` +
      `  path:    ${terminalText(abs)}\n` +
      `  project: ${terminalText(root)}\n` +
      `Follow the links from that path and break the loop.`,
  );

const unwalkableRefusal = (root: string, abs: string, missing: string) =>
  new UnwalkableRefusal(
    `refusing to touch a path whose symlink passes through a directory that does not exist:\n` +
      `  path:    ${terminalText(abs)}\n` +
      `  missing: ${terminalText(missing)}\n` +
      `  project: ${terminalText(root)}\n` +
      `Where it lands would depend on directories created later, so Specnaut ` +
      `cannot tell whether it stays inside the project. Fix or remove that link.`,
  );

const leavesRefusal = (root: string, abs: string, resolved: string) =>
  new ContainmentRefusal(
    `refusing to touch a path that leaves the project:\n` +
      `  path:     ${terminalText(abs)}\n` +
      `  resolves: ${terminalText(resolved)}\n` +
      `  project:  ${terminalText(root)}\n` +
      `A symlink in the project points outside it. Specnaut will not write, ` +
      `move, delete or read through it.`,
  );

/**
 * A path that lands on the project directory itself (cli#669), which is inside the
 * project and still never to be removed. `admitRemoval` throws it for a removal, a
 * rename and `readEntry`, which judges a read as a removal, so the words fit each.
 * A plain `PathRefusal`: a `ContainmentRefusal` is one a reader may report instead
 * of aborting, and this one is not. `checkAddenda`'s catch cannot reach it, because
 * `listProjectFiles` judges with `admit`, not `admitRemoval`.
 */
export const projectDirectoryRefusal = (root: string, abs: string) =>
  new PathRefusal(
    `refusing to treat the project directory itself as a file in it:\n` +
      `  path:    ${terminalText(abs)}\n  project: ${terminalText(root)}`,
  );

/**
 * The staging tree reached through a link (cli#687): everything it lists and
 * deletes would be the link's target, real project files, removed as "stale
 * staged copies". Refused, never followed.
 */
export const linkedStagingRefusal = (root: string, abs: string) =>
  new ContainmentRefusal(
    `refusing to use a staging directory reached through a symlink:\n` +
      `  path:    ${terminalText(abs)}\n` +
      `  project: ${terminalText(root)}\n` +
      `Specnaut stages its own copies there and deletes them; through a link, it would ` +
      `delete whatever the link points at.`,
  );

/**
 * A staged path that is not a plain staged copy (cli#751): a link itself, or
 * behind one whose entry lands outside the staging folder, inside the project.
 * Which refusal a staging read or delete throws (cli#765): a path that leaves
 * the project gets `leavesRefusal`'s words, judged first; this one covers the
 * rest. Being a `PathRefusal`, `pruneStaging` reports it in `leftAlone`'s words,
 * which say to remove the link itself, never what it points at.
 */
export const stagedEntryRefusal = (
  root: string,
  abs: string,
  resolved: string,
  action: "read" | "delete",
) =>
  new ContainmentRefusal(
    `refusing to ${action} a staged path that is a link or lies behind one:\n` +
      `  path:     ${terminalText(abs)}\n` +
      `  resolves: ${terminalText(resolved)}\n` +
      `  project:  ${terminalText(root)}\n` +
      `Specnaut reads and deletes only the plain copies it staged inside the staging folder.`,
  );
