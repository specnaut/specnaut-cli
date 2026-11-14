import {
  IMPORT_DEPTH,
  IMPORT_REASON,
  type ImportedFile,
  importsFrom,
  type ImportSides,
  importsIn,
  importTarget,
} from "../domain/claude_imports.ts";
import type { BaseEntry, Untrusted } from "../domain/script_trust.ts";
import type { BaseFile, GitObjectReader } from "./script_trust_ports.ts";

/**
 * The files the judged instruction files import (`claude_imports.ts`), as HEAD and as the base's
 * tip hold them: an import only the tip's copy makes is followed too, so a target the branch
 * deletes with its import is still named. A source that is a link is followed to its end at that
 * commit, and its imports read from the end's folder; an end HEAD cannot read is a reason, never a
 * skip. Each target is read at HEAD, the tip and the merge base, and its own imports followed, up
 * to {@link IMPORT_DEPTH} hops. A target the class judges as a file of its own (`AGENTS.md`, say)
 * is judged here too: `judgeInstructions` keeps one line per path, the walk's first.
 */

export type ImportBase = {
  readonly head: string;
  readonly tip: string;
  readonly mergeBase: string;
};

/** The judged files each commit holds: where the walk starts. */
export type ImportSources = {
  readonly head: readonly BaseEntry[];
  readonly tip: readonly BaseEntry[];
};

/** Each imported file's three sides, and the reasons the walk itself found. */
export type ImportRead = {
  readonly files: Map<string, ImportSides>;
  readonly reasons: Untrusted[];
};

type Source = { readonly path: string; readonly bytes: Uint8Array };
type Walk = ImportRead & { readonly git: GitObjectReader; readonly base: ImportBase };

export async function readImports(
  git: GitObjectReader,
  base: ImportBase,
  sources: ImportSources,
): Promise<ImportRead> {
  const walk: Walk = { git, base, files: new Map(), reasons: [] };
  let wave = [
    ...await startsAt(walk, base.head, sources.head, true),
    ...await startsAt(walk, base.tip, sources.tip, false),
  ];
  const seen = new Set<string>();
  for (let hop = 0; hop < IMPORT_DEPTH && wave.length > 0; hop++) {
    const next: Source[] = [];
    for (const target of targetsOf(wave).filter((t) => !seen.has(t) && seen.add(t))) {
      next.push(...await visit(walk, target));
    }
    wave = next;
  }
  return { files: walk.files, reasons: walk.reasons };
}

/**
 * Each of `entries` that imports, as a source: a file by its bytes, a link by its end's, read at
 * `commit`. An end HEAD cannot read (outside the repository, absent, itself a link) is a reason;
 * the tip's is only nothing to follow, since nothing lands through it.
 */
async function startsAt(walk: Walk, commit: string, entries: readonly BaseEntry[], head: boolean) {
  const out: Source[] = [];
  for (const e of entries) {
    if (!importsFrom(e.path) || e.kind === "submodule") continue;
    if (e.kind === "blob") {
      out.push({ path: e.path, bytes: e.bytes });
      continue;
    }
    const end = importTarget(e.path, e.target ?? "");
    const read = end === null ? null : await walk.git.readFile(commit, end);
    if (end !== null && read?.kind === "blob") out.push({ path: end, bytes: read.bytes });
    else if (head) walk.reasons.push({ path: e.path, reason: IMPORT_REASON.linkEnd });
  }
  return out;
}

/** Reads `target`'s three sides, records them, and returns what to follow from it. */
async function visit(walk: Walk, target: string): Promise<Source[]> {
  const sides = await readSides(walk, target);
  walk.files.set(target, sides);
  const next = [sides.head, sides.tip].flatMap((b) =>
    b instanceof Uint8Array ? [{ path: target, bytes: b }] : []
  );
  return next;
}

/** HEAD's bytes of each imported file it holds: what the digest frames them by. */
export function importedAtHead(files: ReadonlyMap<string, ImportSides>): BaseEntry[] {
  return [...files].flatMap(([path, s]) =>
    s.head instanceof Uint8Array ? [{ kind: "blob" as const, path, bytes: s.head }] : []
  );
}

function targetsOf(wave: readonly Source[]): string[] {
  const decoder = new TextDecoder();
  const targets = wave.flatMap((s) =>
    importsIn(decoder.decode(s.bytes)).flatMap((w) => importTarget(s.path, w) ?? [])
  );
  return [...new Set(targets)];
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
