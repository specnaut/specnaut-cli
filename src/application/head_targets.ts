import {
  IMPORT_REASON,
  type ImportedFile,
  type ImportSides,
  nearAtHead,
} from "../domain/claude_imports.ts";
import type { Untrusted } from "../domain/script_trust.ts";
import type { BaseFile, GitObjectReader } from "./script_trust_ports.ts";

/**
 * One target of the instruction class's walk (`instruction_imports.ts`): a path a judged file
 * names, read at HEAD, the base's tip and the merge base, and recorded with its three sides.
 */

export type ImportBase = {
  readonly head: string;
  readonly tip: string;
  readonly mergeBase: string;
};

/** Each imported file's three sides, and the reasons the walk itself found. */
export type ImportRead = {
  readonly files: Map<string, ImportSides>;
  readonly reasons: Untrusted[];
};

export type Source = { readonly path: string; readonly bytes: Uint8Array };
type Paths = { path: string; kind: string }[];
export type Walk = ImportRead & {
  readonly git: GitObjectReader;
  readonly base: ImportBase;
  /** HEAD's whole listing, read once, at the first target HEAD lacks as written. */
  pathsAtHead?: Promise<Paths>;
};

/** Reads `target`'s three sides, records them, and returns what to follow from it. */
export async function visit(walk: Walk, target: string): Promise<Source[]> {
  const sides = await readSides(walk, target);
  walk.files.set(target, sides);
  const next = [sides.head, sides.tip].flatMap((b) =>
    b instanceof Uint8Array ? [{ path: target, bytes: b }] : []
  );
  if (sides.head !== "absent") return next;
  walk.pathsAtHead ??= walk.git.listPaths(walk.base.head);
  const near = nearAtHead(target, await walk.pathsAtHead);
  if (near.link !== undefined) {
    walk.reasons.push({ path: target, reason: `${IMPORT_REASON.linkOnTheWay}: ${near.link}` });
  } else if (near.match !== undefined) {
    walk.reasons.push({ path: target, reason: `${IMPORT_REASON.caseDiffers}: ${near.match}` });
    next.push(...await visit(walk, near.match));
  }
  return next;
}

async function readSides(walk: Walk, path: string): Promise<ImportSides> {
  const { git, base } = walk;
  const head = imported(await git.readFile(base.head, path));
  const tip = imported(await git.readFile(base.tip, path));
  return { head, tip, mergeBase: imported(await git.readFile(base.mergeBase, path)) };
}

function imported(file: BaseFile): ImportedFile {
  return file.kind === "blob" ? file.bytes : file.kind;
}
