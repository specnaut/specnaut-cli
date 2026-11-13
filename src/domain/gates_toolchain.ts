/**
 * The folders a sandboxed gate run may read its tools from, as `.specnaut/gates.yml` declares them
 * under `toolchain:`, in the file's narrow list format (`run-gate.sh`'s `parse_list`): a top-level
 * key, then `  - ` items, a matched pair of quotes stripped. An item is an absolute folder, or
 * `~/` and a folder under the home, the home written out for it.
 *
 * `review start` reads this from the base branch's tip and records the folders in the review lock;
 * under the lock, `sandbox exec --toolchain` names those folders and no other, and each still
 * passes the sandbox's layout check, which refuses the home and every credential folder in it.
 * `run-gate.sh --parse-toolchain` reads the same list the same way: a test runs both on one file.
 *
 * Pure: the caller reads the file and names the home.
 */

const KEY = "toolchain:";

/**
 * The folders `text` declares, `~/` expanded against `home`; an item that cannot be one is dropped.
 * An empty `home` is no home, as `run-gate.sh` reads an empty HOME: `~/bin` is dropped, never read
 * as `/bin`, a folder the user did not name.
 */
export function declaredToolchain(text: string, home: string | null): string[] {
  const known = home === "" ? null : home;
  return listItems(text, KEY).flatMap((item) => {
    const folder = item.startsWith("~/")
      ? (known === null ? "" : `${known}${item.slice(1)}`)
      : item;
    return isFolder(folder) ? [folder] : [];
  });
}

/** Absolute, and free of the `:` that separates `--toolchain`'s folders. */
function isFolder(folder: string): boolean {
  return folder.startsWith("/") && !folder.includes(":");
}

/** The items under the top-level `key`, as `parse_list` reads them. */
function listItems(text: string, key: string): string[] {
  const items: string[] = [];
  let inside = false;
  for (const line of text.replaceAll("\r", "").split("\n")) {
    if (/^[^ \t#]/.test(line)) {
      inside = line.startsWith(key);
      continue;
    }
    if (!inside || /^[ \t]*#/.test(line)) continue;
    const item = /^[ \t]*-[ \t]*(.*?)[ \t]*$/.exec(line)?.[1];
    if (item) items.push(unquoted(item));
  }
  return items.filter((item) => item !== "");
}

function unquoted(item: string): string {
  const [first, last] = [item[0], item[item.length - 1]];
  const paired = item.length >= 2 && first === last && (first === '"' || first === "'");
  return paired ? item.slice(1, -1) : item;
}
