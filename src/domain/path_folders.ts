import { climb } from "./project_path.ts";
import type { Reading } from "./command_words.ts";
import { MAX_WORD } from "./command_words.ts";
import { pathPieces } from "./command_search_path.ts";
import { foldersOf } from "./command_word_paths.ts";
import { unpinned } from "./env_surfaces.ts";

/**
 * The folders a source's PATH values put on PATH (`command_search_path.ts`), each value read as
 * its harness reads a `$` in it (`env_surfaces.ts`) and as written.
 */

/**
 * The folders the PATH values `read` noted put there. A value longer than {@link MAX_WORD} is not
 * read, as a word is not, and the reading is not whole: its pieces are not paths a check should
 * spend its time on. A value surely setting PATH is read both as a shell expands it and as written
 * (`asWritten`), since a harness may copy it as typed or run a command with no shell (a hook's
 * `args`); one its harness may not expand as a shell would is not read whole (`unpinned`).
 */
export function pathFolders(read: Reading): string[] {
  const folders = new Set<string>();
  for (const { value, sure, semantics } of read.pathValues) {
    if (value.length > MAX_WORD) read.whole = false;
    else {
      if (sure && unpinned(value, semantics)) read.whole = false;
      for (const piece of pathPieces(value)) {
        foldersOf(piece, read, sure).forEach((f) => folders.add(f));
        if (sure) asWritten(piece).forEach((f) => folders.add(f));
      }
    }
  }
  return [...folders];
}

/**
 * The folder a relative PATH piece names as written, when a `$`, a backquote, a `~` or a `%` in it
 * would make it another once expanded: `$PATH` copied as typed is a folder named `$PATH`.
 */
function asWritten(piece: string): string[] {
  if (!/[$`~%]/.test(piece) || /^(?:[A-Za-z]:)?[\\/]/.test(piece)) return [];
  const folder = climb([], piece.replaceAll("\\", "/")).join("/");
  return folder === "" ? [] : [folder];
}
