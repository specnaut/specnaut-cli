/**
 * How a path is written relative to the project's folder, which may sit below the repository's
 * top: `..` climbs above it (`../AGENTS.md`), up to the top and never past it. Every reader of the
 * instruction class writes paths this way, so one file is one path whichever way it was named.
 */

/**
 * `written`, read from the folder `from` (its parts): `..` pops a folder, or is kept when there is
 * none left to pop, so a path that climbs above `from`'s first folder starts with `..`.
 */
export function climb(from: readonly string[], written: string): string[] {
  const parts = [...from];
  for (const part of written.split("/")) {
    if (part === "..") {
      if (parts.length === 0 || parts.at(-1) === "..") parts.push("..");
      else parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts;
}

/**
 * `path`, relative to the project's folder `prefix` (`""`, or `sub/dir/`) and possibly climbing
 * above it, as a path from the repository's top; `null` when it climbs above the top or is the top
 * itself. git takes pathspecs literally, so `..` is resolved before it is asked.
 */
export function fromTop(prefix: string, path: string): string | null {
  const parts = climb([], `${prefix}${path}`);
  return parts.length === 0 || parts[0] === ".." ? null : parts.join("/");
}

/**
 * `top`, a path from the repository's top, relative to the project's folder `prefix`: below it as
 * is, elsewhere through `..` (`../shared.md`); the project's own folder is `.`, each folder above
 * it `..`, `../..`.
 */
export function toProject(prefix: string, top: string): string {
  const project = prefix.split("/").filter(Boolean);
  const parts = top.split("/").filter(Boolean);
  let common = 0;
  while (common < project.length && project[common] === parts[common]) common++;
  const up = Array<string>(project.length - common).fill("..");
  return [...up, ...parts.slice(common)].join("/") || ".";
}

/**
 * The one way `path` (relative to the project's folder `prefix`) is written: `../app/x.md` from the
 * project `app/` is `x.md`. `null` when it climbs above the repository's top.
 */
export function canonical(prefix: string, path: string): string | null {
  const top = fromTop(prefix, path);
  return top === null ? null : toProject(prefix, top);
}

/**
 * A path as written and, when it ends in punctuation, without it: prose ends a sentence on a
 * path. Both are tried; a reading that names no file at any commit asks nothing.
 */
export function readings(written: string): string[] {
  let end = written.length;
  while (end > 0 && TRAILING.has(written[end - 1])) end--;
  const bare = written.slice(0, end);
  return bare === written || bare === "" ? [written] : [written, bare];
}

/** The punctuation a sentence ends a path on. Trimmed one character at a time: linear in the path. */
const TRAILING = new Set([...".,;:!?)]}>'\""]);
