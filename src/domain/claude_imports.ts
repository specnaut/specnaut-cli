import { sameBytes } from "./bytes.ts";
import { invisibleReason } from "./instruction_head.ts";
import { REASON, type Untrusted } from "./script_trust.ts";
import { refinedReason } from "./trust_reason.ts";

/**
 * A `CLAUDE.md` (or `CLAUDE.local.md`) pulls other files into the session with `@path` imports,
 * read relative to the importing file, recursively up to {@link IMPORT_DEPTH} hops; an import in a
 * code span or a fenced block is text, and `@~/…` reads the user's home, outside the repository.
 * The files a judged one imports are part of the instruction class (`instruction_trust.ts`): each
 * in-repository target is judged as HEAD commits it against the base's tip.
 */

/** Claude Code follows imports this many hops from the file that started them. */
export const IMPORT_DEPTH = 5;

/** Whether the file at `path` is one whose imports Claude Code follows. */
export function importsFrom(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return name === "claude.md" || name === "claude.local.md";
}

/** The `@path` imports `text` holds, as written, outside fenced blocks and code spans. */
export function importsIn(text: string): string[] {
  const found: string[] = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const prose = line.replace(/`[^`]*`/g, " ");
    for (const m of prose.matchAll(/(?:^|\s)@(\S+)/g)) found.push(...readings(m[1]));
  }
  return found;
}

/**
 * An import as written and, when it ends in punctuation, without it: prose ends a sentence on a
 * path. Both are followed; a reading that names no file at any commit asks nothing.
 */
function readings(written: string): string[] {
  const bare = written.replace(/[.,;:!?)\]]+$/, "");
  return bare === written || bare === "" ? [written] : [written, bare];
}

/**
 * Where an import written in the file at `from` leads, relative to the project's folder (`../`
 * when it climbs above it), or `null` when it reads outside the repository's checkout: the home
 * (`~/`), an absolute path. Whether it climbs above the repository's top is the reader's to say.
 */
export function importTarget(from: string, written: string): string | null {
  if (written.startsWith("~") || written.startsWith("/") || /^[A-Za-z]:/.test(written)) return null;
  const parts = from.split("/").slice(0, -1);
  for (const part of written.split("/")) {
    if (part === "..") {
      if (parts.length === 0 || parts.at(-1) === "..") parts.push("..");
      else parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.length === 0 ? null : parts.join("/");
}

/** One imported file at HEAD, the base's tip and the merge base: its bytes, or why there are none. */
export type ImportedFile = Uint8Array | "absent" | "not_regular";

export type ImportSides = {
  readonly head: ImportedFile;
  readonly tip: ImportedFile;
  readonly mergeBase: ImportedFile;
};

/** One reason per imported path HEAD does not hold as the tip does, in path order. */
export function importReasons(files: ReadonlyMap<string, ImportSides>): Untrusted[] {
  const out: Untrusted[] = [];
  for (const [path, sides] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const reason = importReason(sides);
    if (reason !== null) out.push({ path, reason });
  }
  return out;
}

function importReason({ head, tip, mergeBase }: ImportSides): string | null {
  if (head === "not_regular") return REASON.notRegular;
  if (head === "absent") {
    if (tip === "absent") return null;
    return mergeBase === "absent" ? REASON.behind : REASON.missing;
  }
  if (tip === "not_regular") return REASON.baseNotRegular;
  const tipBytes = tip === "absent" ? undefined : tip;
  const old = mergeBase instanceof Uint8Array ? mergeBase : undefined;
  if (sameBytes(head, tipBytes)) return null;
  const otherwise = tipBytes === undefined ? REASON.notOnBase : REASON.differs;
  return invisibleReason(head) ??
    refinedReason(head, { copies: [tipBytes], mergeBase: old }, otherwise);
}
