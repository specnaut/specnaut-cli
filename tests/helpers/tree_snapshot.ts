import { join } from "@std/path";

/**
 * Every entry below `root`, `/`-separated whatever the OS: a file with its text, a folder as
 * `folder`, a link as `link <target>`. A command that must leave a tree alone is checked by
 * comparing two of these: folders count, since one that only creates an empty folder has still
 * changed the tree.
 */
export async function snapshot(root: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  const walk = async (dir: string, prefix: string) => {
    for await (const e of Deno.readDir(dir)) {
      const path = `${prefix}${e.name}`;
      const full = join(dir, e.name);
      if (e.isSymlink) seen.set(path, `link ${await Deno.readLink(full)}`);
      else if (e.isDirectory) (seen.set(path, "folder"), await walk(full, `${path}/`));
      else seen.set(path, await Deno.readTextFile(full));
    }
  };
  await walk(root, "");
  return seen;
}
