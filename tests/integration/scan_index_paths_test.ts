import { assertEquals } from "@std/assert";
import { basename } from "@std/path";
import { git, lines, POSIX, repo, scanJson, write, writeRawIndex } from "./scan_fixture.ts";

/**
 * An index entry that names somewhere other than a file under the root (plan S3): git writes no
 * such entry, but lists one a repository planted, and joined to the root it would leave it. The
 * scan refuses it before any `lstat`, and counts it skipped as `outside_root`.
 */

/** Each shape that leaves the root, or names no file in it, on some platform. */
const OUTSIDE = ["../x.ts", "./a.ts", "/abs.ts", "a//b.ts", "a/./b.ts", "a/../x.ts", "a/.."];

Deno.test("git lists an index entry it would never write, so the scan must refuse it", async () => {
  const dir = await repo({ "ok.ts": lines(1) });
  const blob = (await git(dir, "hash-object", "-w", "ok.ts")).trim();
  await writeRawIndex(dir, blob, ["ok.ts", ...OUTSIDE]);
  const listed = (await git(dir, "ls-files", "-z")).split("\0").filter((p) => p !== "");
  assertEquals(listed.sort(), ["ok.ts", ...OUTSIDE].sort());
});

Deno.test("an entry with a dot, dot-dot or empty segment, or a leading /, is never opened", async () => {
  const dir = await repo({ "ok.ts": lines(1) });
  const outside = await Deno.realPath(await Deno.makeTempDir({ prefix: "scan-outside-" }));
  await write(outside, { "x.ts": lines(7000) });
  const escape = `../${basename(outside)}/x.ts`;
  const blob = (await git(dir, "hash-object", "-w", "ok.ts")).trim();
  await writeRawIndex(dir, blob, ["ok.ts", escape, ...OUTSIDE]);
  const { result, json } = await scanJson(dir);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(json.totals.skipped_by.outside_root, OUTSIDE.length + 1);
  assertEquals([json.totals.measured, json.totals.lines], [1, 1], "a line was read outside");
});

Deno.test({
  name: "a backslash or a drive letter is refused too: on Windows it leaves the root",
  ignore: !POSIX, // a name holding `\` or `:` cannot be written there
  fn: async () => {
    const dir = await repo({ "ok.ts": lines(1), "a\\b.ts": lines(2), "C:x.ts": lines(3) });
    const { json } = await scanJson(dir);
    assertEquals([json.totals.skipped_by.outside_root, json.totals.lines], [2, 1]);
  },
});
