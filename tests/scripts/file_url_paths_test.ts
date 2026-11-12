import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * A file path is built with `fromFileUrl`, never a URL's `pathname`: on Windows
 * that is `/D:/…`, which no API opens, and it keeps `%20` for a space on every
 * OS. Swept here once, so the next test copied from an old one cannot bring it
 * back. A request URL's path reads it by destructuring, which this does not see.
 */
/** Spelled in two halves so this file does not match itself. */
const NEEDLE = "." + "pathname";

Deno.test("no script test builds a file path from a URL's pathname", async () => {
  const dir = fromFileUrl(new URL("./", import.meta.url));
  const found: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".ts")) continue;
    const lines = (await Deno.readTextFile(`${dir}/${e.name}`)).split("\n");
    lines.forEach((line, i) => {
      if (line.includes(NEEDLE)) found.push(`${e.name}:${i + 1}`);
    });
  }
  assertEquals(found, [], "build the path with fromFileUrl(new URL(..., import.meta.url))");
});
