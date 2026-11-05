// The ratchet judges `file` and `constitution` only (spec 063, FR-015). `class`
// and `function` are read, because the one reader takes them, and judge nothing:
// a line count cannot say where a function or a class starts.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { CLEAN, FILE, ratchet, repo, stage, UNIT } from "./size_ratchet_fixture.ts";

Deno.test("a class or function limit set in the config judges no file", async () => {
  const config = UNIT("class", 1, 2) + UNIT("function", 1, 2);
  const dir = await repo(10, config);
  await stage(dir, "big.ts", 150);
  const r = await ratchet(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `1 ${CLEAN} (target 200, ceiling 500, source: default)`);
});

Deno.test("the file limit decides beside a class limit", async () => {
  const dir = await repo(380, FILE(300, 400, UNIT("class", 9000, 9000)));
  await stage(dir, "big.ts", 390);
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "big.ts: 380 → 390 (target 300, ceiling 400)");
});

Deno.test("a bad class value stops the ratchet, as any bad value does", async () => {
  const dir = await repo(10, UNIT("class", "3OO", 500));
  await stage(dir, "big.ts", 20);
  const r = await ratchet(dir);
  assertEquals(r.code, 2, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "'class.target' is '3OO'");
});
