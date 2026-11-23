import { backquoteEnd, closing, shellSegments, shellWords } from "./shell_words.ts";

/**
 * The commands a command runs inside itself, each read as a command of its own: the inside of a
 * `$(…)` or of a backquoted command, which a shell runs to build a word, and a word that is itself
 * a command line, which a shell is handed to run (`bash -c 'cd web && ./run.sh'`, `sh -lc "…"`,
 * `eval "…"`): any word a second split reads otherwise than as itself. A sentence in quotes is read
 * as a command too, as every word is read too much rather than too little (`command_targets.ts`):
 * it only names more paths. Read as text, never expanded or run.
 */

/** At most this many levels of commands in commands are read: past it a reading is not whole. */
const MAX_NESTING = 16;

/**
 * The words of each command `texts` hold, one list per command, then those of each command nested
 * in them, level by level. A level's texts are parts of the words of the level before, apart from
 * one another, so reading a level costs no more than reading `texts` once. Past {@link MAX_NESTING}
 * levels what is left is not read, and `read` is not whole.
 */
export function nestedSegments(texts: readonly string[], read: { whole: boolean }): string[][] {
  const segments: string[][] = [];
  let level = texts;
  for (let depth = 0; level.length > 0; depth++) {
    if (depth > MAX_NESTING) {
      read.whole = false;
      break;
    }
    const own = level.flatMap(shellSegments);
    segments.push(...own);
    level = own.flat().flatMap(innerCommands);
  }
  return segments;
}

/**
 * What a backslash escapes inside a backquoted command, as bash reads it: taken off, the command
 * runs `` `echo \`x\`` `` as `` echo `x` ``, whose own backquote the next level reads.
 */
const BACKQUOTED_ESCAPE = /\\([\\`$])/g;

/**
 * Whether `word` is read as a command line of its own: a second split reads it otherwise than as
 * itself (a command line, or a level of quoting left). The one place that says which word is code.
 */
export function isCommandLine(word: string): boolean {
  const again = shellWords(word);
  return again.length !== 1 || again[0] !== word;
}

/**
 * The commands `word` holds: itself, when it is a command line (`isCommandLine`), whose own nested
 * commands the next level finds; else what each `$(…)` and backquote in it runs, `${X:-$(…)}`
 * included. Each is shorter than `word`, so the levels end.
 */
function innerCommands(word: string): string[] {
  if (isCommandLine(word)) return [word];
  const found: string[] = [];
  for (let i = 0; i < word.length; i++) {
    if (word.startsWith("$(", i)) {
      const end = closing(word, i + 1);
      found.push(word.slice(i + 2, word[end] === ")" ? end : end + 1));
      i = end;
    } else if (word[i] === "`") {
      const start = i + 1;
      i = backquoteEnd(word, i);
      found.push(word.slice(start, i).replace(BACKQUOTED_ESCAPE, "$1"));
    }
  }
  return found.filter((command) => command.trim() !== "");
}
