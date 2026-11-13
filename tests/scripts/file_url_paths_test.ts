import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

/**
 * A file path is built with `fromFileUrl`, never a URL's `pathname`: on Windows
 * that is `/D:/…`, which no API opens, and it keeps `%20` for a space on every
 * OS. Swept here once, over the script tests and the scripts themselves, so the
 * next file copied from an old one cannot bring it back. A request URL's path
 * reads it by destructuring, which this does not see.
 */
/** Spelled in two halves so this file does not match itself. */
const NEEDLE = "." + "pathname";

/** Each `<file>:<line>` of a `.ts` file under `dir`, at any depth, that names the needle. */
async function uses(dir: URL): Promise<string[]> {
  const root = fromFileUrl(dir);
  const found: string[] = [];
  for await (const e of walk(root, { exts: [".ts"], includeDirs: false })) {
    const lines = (await Deno.readTextFile(e.path)).split("\n");
    lines.forEach((line, i) => {
      if (line.includes(NEEDLE)) found.push(`${relative(root, e.path)}:${i + 1}`);
    });
  }
  return found;
}

const FIX = "build the path with fromFileUrl(new URL(..., import.meta.url))";

Deno.test("no script test builds a file path from a URL's pathname", async () => {
  assertEquals(await uses(new URL("./", import.meta.url)), [], FIX);
});

Deno.test("no script builds a file path from a URL's pathname", async () => {
  assertEquals(await uses(new URL("../../scripts/", import.meta.url)), [], FIX);
});
