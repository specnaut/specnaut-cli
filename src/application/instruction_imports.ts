import {
  IMPORT_DEPTH,
  IMPORT_REASON,
  importsFrom,
  type ImportSides,
  importsIn,
  importTarget,
} from "../domain/claude_imports.ts";
import type { BaseEntry } from "../domain/script_trust.ts";
import {
  type ImportBase,
  type ImportRead,
  type Source,
  sourceAt,
  visit,
  type Walk,
} from "./head_targets.ts";

/**
 * The files the judged instruction files import (`claude_imports.ts`), as HEAD and as the base's
 * tip hold them: an import only the tip's copy makes is followed too, so a target the branch
 * deletes with its import is still named. A source that is a link is followed to its end at that
 * commit, and its imports read from the end's folder; an end HEAD cannot read is a reason, never a
 * skip. Each target is read at HEAD, the tip and the merge base, and its own imports followed, up
 * to {@link IMPORT_DEPTH} hops. A target the class judges as a file of its own (`AGENTS.md`, say)
 * is judged here too: `judgeInstructions` keeps one line per path, the walk's first.
 */

export type { ImportBase, ImportRead };

/** The judged files each commit holds: where the walk starts. */
export type ImportSources = {
  readonly head: readonly BaseEntry[];
  readonly tip: readonly BaseEntry[];
};

/** Walks the imports of `sources` into `walk`, which records each target and each reason. */
export async function readImports(walk: Walk, sources: ImportSources): Promise<void> {
  let wave = [
    ...await startsAt(walk, walk.base.head, sources.head, true),
    ...await startsAt(walk, walk.base.tip, sources.tip, false),
  ];
  const seen = new Set<string>();
  for (let hop = 0; hop < IMPORT_DEPTH && wave.length > 0; hop++) {
    const next: Source[] = [];
    for (const target of targetsOf(wave).filter((t) => !seen.has(t) && seen.add(t))) {
      next.push(...sourcesOf(walk, await visit(walk, target)));
    }
    wave = next;
  }
}

/**
 * Each of `entries` that imports, as a source: a file by its bytes, a link by its end's, read at
 * `commit`. An end HEAD cannot read (outside the repository, absent, itself a link) is a reason;
 * the tip's is only nothing to follow, since nothing lands through it.
 */
async function startsAt(walk: Walk, commit: string, entries: readonly BaseEntry[], head: boolean) {
  const out: Source[] = [];
  for (const e of entries.filter((e) => importsFrom(e.path))) {
    const source = await sourceAt(walk, commit, e);
    if (source !== null) out.push(source);
    else if (head && e.kind === "link") {
      walk.reasons.push({ path: e.path, reason: IMPORT_REASON.linkEnd });
    }
  }
  return out;
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

/** The bytes HEAD and the tip hold for each of `paths` the walk recorded: what imports next. */
function sourcesOf(walk: Walk, paths: readonly string[]): Source[] {
  return paths.flatMap((path) => {
    const sides = walk.files.get(path)!;
    return [sides.head, sides.tip].flatMap((b) =>
      b instanceof Uint8Array ? [{ path, bytes: b }] : []
    );
  });
}
