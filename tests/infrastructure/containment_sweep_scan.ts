import { fromFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";

/**
 * The containment sweep's scanner (cli#574): which modules under `src/` mutate
 * the filesystem, which function each mutating call sits in, and the exclusion
 * list's parser. Its own module so `containment_sweep_test.ts` holds the
 * assertions only (cli#767).
 */

const SRC = fromFileUrl(new URL("../../src", import.meta.url));

/** Deno APIs that create, move, delete or re-permission something on disk. */
const MUTATORS =
  /Deno\.(writeTextFile|writeFile|mkdir|remove|rename|chmod|create|truncate|symlink|link)\(/;

/** The generated bundle is 27k lines of template literals, not code that runs. */
const NOT_CODE = /src\/templates_bundle\.ts$/;

/** Block openers that are not functions. Without this filter an `if` inside a
 * guarded method reads as its own unguarded "function". */
const NOT_A_FUNCTION = new Set(["if", "while", "for", "switch", "catch", "do", "try"]);

/**
 * The guard that may stand in front of a sink. A removal or a rename acts on the
 * entry itself, so the entry check `assertRemovableInProject` covers it as well
 * as `assertInsideProject` (cli#751); a write lands through the path, so only
 * `assertInsideProject` does.
 */
function guardFor(sink: string): RegExp {
  return /^Deno\.(remove|rename)\(/.test(sink)
    ? /assertInsideProject|assertRemovableInProject/
    : /assertInsideProject/;
}

/**
 * Attributes each mutating call to the method it sits in, lexically.
 *
 * No brace parsing and no AST: for every mutating call, walk BACKWARDS to the
 * nearest preceding signature and ask whether its guard appears between the two:
 * `assertInsideProject`, or for a removal or a rename, which act on the entry,
 * `assertRemovableInProject` too (cli#751). That answers the only question asked —
 * "did anybody put a guard in front of this sink" — failing toward a false ALARM
 * (a name that turns out fine) rather than a false clean. A FLOOR, not a proof:
 * whether the guard checks the right path is `sink_containment_test.ts`'s job.
 */
export function unguardedSinks(src: string): string[] {
  const sig =
    /(?:^|\n)[ \t]*(?:export )?(?:(?:private|protected|public|static) )*(?:async )?(?:function )?([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{;=]*\{/g;
  const sigs: Array<{ at: number; name: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = sig.exec(src)) !== null) {
    if (!NOT_A_FUNCTION.has(m[1])) sigs.push({ at: m.index, name: m[1] });
  }

  const out = new Set<string>();
  const mut = new RegExp(MUTATORS.source, "g");
  while ((m = mut.exec(src)) !== null) {
    const call = m.index;
    let owner = { at: 0, name: "<module>" };
    for (const s2 of sigs) {
      if (s2.at < call) owner = s2;
      else break;
    }
    if (!guardFor(m[0]).test(src.slice(owner.at, call))) out.add(owner.name);
  }
  return [...out];
}

export type Exclusion = { path: string; reason: string };

/** An entry is either `<path>` or `<path>::<method>`; both name the same file. */
export function fileOf(entry: string): string {
  const i = entry.indexOf("::");
  return i === -1 ? entry : entry.slice(0, i);
}

export function readExclusions(text: string): Exclusion[] {
  const out: Exclusion[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const path = t.split(/\s+/)[0];
    const reason = t.slice(path.length).trim();
    out.push({ path, reason });
  }
  return out;
}

export async function mutatingModules(): Promise<string[]> {
  const found: string[] = [];
  for await (const e of walk(SRC, { exts: [".ts"], includeDirs: false, followSymlinks: false })) {
    const rel = "src" + e.path.slice(SRC.length).replaceAll("\\", "/");
    if (NOT_CODE.test(rel)) continue;
    if (MUTATORS.test(await Deno.readTextFile(e.path))) found.push(rel);
  }
  return found.sort();
}
