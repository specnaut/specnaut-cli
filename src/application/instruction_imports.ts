import {
  IMPORT_DEPTH,
  type ImportedFile,
  importsFrom,
  type ImportSides,
  importsIn,
  importTarget,
} from "../domain/claude_imports.ts";
import type { BaseEntry } from "../domain/script_trust.ts";
import type { BaseFile, GitObjectReader } from "./script_trust_ports.ts";

/**
 * The files the judged `CLAUDE.md` files import (`claude_imports.ts`), as HEAD and as the base's
 * tip hold them: an import only the tip's copy makes is followed too, so a target the branch
 * deletes with its import is still named. Each target is read at HEAD, the tip and the merge base,
 * and its own imports are followed, up to {@link IMPORT_DEPTH} hops. A target the class judges
 * as a file of its own (`AGENTS.md`, say) is judged here too: `judgeInstructions` keeps one line
 * per path, the walk's first.
 */

export type ImportBase = {
  readonly head: string;
  readonly tip: string;
  readonly mergeBase: string;
};

type Source = { readonly path: string; readonly bytes: Uint8Array };

export async function readImports(
  git: GitObjectReader,
  base: ImportBase,
  sources: readonly BaseEntry[],
): Promise<Map<string, ImportSides>> {
  const files = new Map<string, ImportSides>();
  const seen = new Set<string>();
  let wave: Source[] = sources.flatMap((e) =>
    e.kind === "blob" && importsFrom(e.path) ? [{ path: e.path, bytes: e.bytes }] : []
  );
  for (let hop = 0; hop < IMPORT_DEPTH && wave.length > 0; hop++) {
    const next: Source[] = [];
    for (const target of targetsOf(wave)) {
      if (seen.has(target)) continue;
      seen.add(target);
      const sides = await readSides(git, base, target);
      files.set(target, sides);
      for (const b of [sides.head, sides.tip]) {
        if (b instanceof Uint8Array) next.push({ path: target, bytes: b });
      }
    }
    wave = next;
  }
  return files;
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

async function readSides(git: GitObjectReader, base: ImportBase, path: string) {
  const head = imported(await git.readFile(base.head, path));
  const tip = imported(await git.readFile(base.tip, path));
  return { head, tip, mergeBase: imported(await git.readFile(base.mergeBase, path)) };
}

function imported(file: BaseFile): ImportedFile {
  return file.kind === "blob" ? file.bytes : file.kind;
}
