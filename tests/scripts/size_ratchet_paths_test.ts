// cli#705: the ratchet measures a file under the name git stores, byte for
// byte. Read without `-z`, `git diff --name-status` C-quotes a name holding a
// non-ASCII byte, a `"`, a `\`, a tab or a newline, and the quoted string then
// names no blob: the file came out `0 → 0` and passed at any size.
//
// Every case grows a committed file past its limits and requires the refusal
// line naming the file with its real sizes — a line only the path that read
// both blobs can print. A pass, or a `0 → 0`, fails the case.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { FILE, lines, ratchet, repo, run, stage } from "./size_ratchet_fixture.ts";

/** Commits `name` at `start` lines in a fresh repo held to target 300, ceiling 400. */
async function committed(name: string, start: number): Promise<string> {
  const dir = await repo(10, FILE(300, 400));
  await stage(dir, name, start);
  await run("git", ["commit", "-q", "-m", "add"], dir);
  return dir;
}

async function assertGrowthRefused(name: string): Promise<void> {
  const dir = await committed(name, 380);
  await stage(dir, name, 390);
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stderr,
    `${name}: 380 → 390 (target 300, ceiling 400) — over the target and grew`,
  );
}

Deno.test("a file with a non-ASCII name is measured, and refused when it grows", async () => {
  await assertGrowthRefused("naïve.ts");
});

// git does not quote a name that only holds spaces: this case does not
// reproduce cli#705, it pins the NUL-delimited read against field splitting.
Deno.test("a file with a space in its name is measured, and refused when it grows", async () => {
  await assertGrowthRefused("my file.ts");
});

// A `"` is not a legal file name character on Windows.
Deno.test({
  name: 'a file with a " in its name is measured, and refused when it grows',
  ignore: Deno.build.os === "windows",
  fn: () => assertGrowthRefused('say"hi".ts'),
});

Deno.test("a renamed file with a non-ASCII name is measured against its old size", async () => {
  const dir = await committed("naïve.ts", 380);
  await run("git", ["mv", "naïve.ts", "café.ts"], dir);
  await Deno.writeTextFile(join(dir, "café.ts"), lines(390));
  await run("git", ["add", "café.ts"], dir);
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stderr,
    "café.ts: 380 → 390 (target 300, ceiling 400) — over the target and grew",
  );
});

// A name is a pathspec to `git diff`: `*.ts` also matches the binary `!bin.ts`,
// which sorts first, so the per-file binary check skipped the text file.
Deno.test({
  name: "a name that reads as a glob is measured as itself",
  ignore: Deno.build.os === "windows", // `*` is not a legal file name character on Windows
  fn: async () => {
    const dir = await committed("*.ts", 380);
    await Deno.writeTextFile(join(dir, "!bin.ts"), "\0binary\0");
    await stage(dir, "*.ts", 390);
    await run("git", ["add", "!bin.ts"], dir);
    const r = await ratchet(dir);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(r.stderr, "*.ts: 380 → 390");
  },
});

// `:1:x.ts` names stage 1 of `x.ts`, not the index entry of `1:x.ts`.
Deno.test({
  name: "a name that reads as an index stage is measured as itself",
  ignore: Deno.build.os === "windows", // `:` is not a legal file name character on Windows
  fn: () => assertGrowthRefused("1:x.ts"),
});
