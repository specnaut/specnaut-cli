import {
  IMPORT_DEPTH,
  IMPORT_REASON,
  importsFrom,
  type ImportSides,
  importsIn,
  importTarget,
} from "../domain/claude_imports.ts";
import type { BaseEntry } from "../domain/script_trust.ts";
import { type ImportBase, type ImportRead, type Source, visit, type Walk } from "./head_targets.ts";
import type { GitObjectReader } from "./script_trust_ports.ts";

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
