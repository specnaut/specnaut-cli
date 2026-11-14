import { sameBytes } from "./bytes.ts";
import { INSTRUCTION_NAMES } from "./checkout_scope.ts";
import { invisibleReason } from "./instruction_head.ts";
import { REASON, type Untrusted } from "./script_trust.ts";
import { refinedReason } from "./trust_reason.ts";

/**
 * A `CLAUDE.md` (or `CLAUDE.local.md`) pulls other files into the session with `@path` imports,
 * read relative to the importing file, recursively up to {@link IMPORT_DEPTH} hops; `@~/…` reads
 * the user's home, outside the repository.
 * The files a judged one imports are part of the instruction class (`instruction_trust.ts`): each
 * in-repository target is judged as HEAD commits it against the base's tip.
 */

/** Claude Code follows imports this many hops from the file that started them. */
export const IMPORT_DEPTH = 5;

/** The reasons the import walk adds to `REASON`. */
export const IMPORT_REASON = {
  linkEnd: "a link whose end cannot be read for its imports",
  caseDiffers: "imported in another letter case than HEAD's file",
  linkOnTheWay: "a link on the way at HEAD",
} as const;

/**
 * Whether the file at `path` is one whose imports are followed: any instruction file the class
 * judges by name (a `CLAUDE.md` may link to or import an `AGENTS.md`, which then imports for it),
 * or a Markdown rule under `.claude/rules/`, which Claude Code loads as project instructions.
 */
export function importsFrom(path: string): boolean {
  const folded = path.toLowerCase();
  const name = folded.slice(folded.lastIndexOf("/") + 1);
  if (folded.startsWith(".claude/rules/") && name.endsWith(".md")) return true;
  return INSTRUCTION_NAMES.some((n) => n.toLowerCase() === name);
}

/** What HEAD holds where an import names a path it lacks as written. */
export type NearAtHead = { readonly link?: string; readonly match?: string };

/**
 * Where an import `target` HEAD lacks as written leads in HEAD's `paths` (each with its kind): a
 * link on a folder along its way, or a file under the same name in another letter case.
 */
export function nearAtHead(
  target: string,
  paths: readonly { path: string; kind: string }[],
): NearAtHead {
  const folded = target.toLowerCase();
  const link = paths.find((p) =>
    p.kind === "link" && folded.startsWith(`${p.path.toLowerCase()}/`)
  );
  if (link !== undefined) return { link: link.path };
  const match = paths.find((p) => p.kind === "blob" && p.path.toLowerCase() === folded);
  return match === undefined ? {} : { match: match.path };
}

/**
 * The `@path` imports `text` holds, as written, on every line: an `@` at a line's start or after a
 * space, a quote, a backtick or an opening bracket. Claude Code skips fenced blocks and code spans;
 * this reads them too, on purpose: reading too much only names a file the branch changed.
 */
export function importsIn(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s`'"([{<])@([^\s`]+)/gm)].flatMap((m) => readings(m[1]));
}

/**
 * An import as written and, when it ends in punctuation, without it: prose ends a sentence on a
 * path. Both are followed; a reading that names no file at any commit asks nothing.
 */
function readings(written: string): string[] {
  const bare = written.replace(/[.,;:!?)\]}>'"]+$/, "");
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
