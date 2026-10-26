// The constitution is loaded into every session, yet `.specnaut/**` is exempt
// from the file limits. #663 holds it to its own `constitution` unit: measured
// whenever it is staged, lock-listed or not, with the same two rules as a file.
//
// A passing case requires the script's success line, which only the path that
// walked the staged files prints; a refusal requires the unit and its source in
// the violation line, which only the constitution branch writes.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  CLEAN,
  isWindows,
  lines,
  ratchet,
  repo,
  run,
  stage,
  TABLE,
} from "./size_ratchet_fixture.ts";

const PATH = ".specnaut/memory/constitution.md";

/** A constitution of exactly `n` lines, starting with `head` (a table, or nothing). */
function constitution(n: number, head = "# Constitution\n") {
  const have = head.split("\n").length - 1;
  return head + lines(n - have);
}

async function restage(dir: string, content: string): Promise<void> {
  await Deno.writeTextFile(join(dir, PATH), content);
  await run("git", ["add", PATH], dir);
}

Deno.test(
  "a staged constitution past its ceiling is refused, with the unit, source and what to move",
  {
    ignore: isWindows,
  },
  async () => {
    const dir = await repo(10, constitution(100));
    await restage(dir, constitution(520));
    const r = await ratchet(dir);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(
      r.stderr,
      `${PATH}: 100 → 520 (target 300, ceiling 500) (unit constitution, source: default) — over the ceiling`,
    );
    assertStringIncludes(r.stderr, "every Sync Impact Report but the");
  },
);

Deno.test("an over-target constitution that grows is refused; one that shrinks passes", {
  ignore: isWindows,
}, async () => {
  const grows = await repo(10, constitution(320));
  await restage(grows, constitution(330));
  const g = await ratchet(grows);
  assertEquals(g.code, 1, g.stdout + g.stderr);
  assertStringIncludes(g.stderr, `${PATH}: 320 → 330 (target 300, ceiling 500)`);
  assertStringIncludes(g.stderr, "over the target and grew");

  const shrinks = await repo(10, constitution(600));
  await restage(shrinks, constitution(550));
  const s = await ratchet(shrinks);
  assertEquals(s.code, 0, s.stdout + s.stderr);
  assertStringIncludes(s.stdout, "over the ceiling, shrinking");
  assertStringIncludes(s.stdout, `1 ${CLEAN}`);
});

Deno.test("a project's constitution row overrides the default", { ignore: isWindows }, async () => {
  const head = TABLE("| file | 300 | 500 |\n| constitution | 50 | 80 |");
  const dir = await repo(10, constitution(40, head));
  await restage(dir, constitution(90, head));
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stderr,
    `${PATH}: 40 → 90 (target 50, ceiling 80) (unit constitution, source: constitution)`,
  );

  const off = TABLE("| file | 300 | 500 |\n| constitution | none | none |");
  const free = await repo(10, constitution(40, off));
  await restage(free, constitution(900, off));
  const f = await ratchet(free);
  assertEquals(f.code, 0, f.stdout + f.stderr);
  assertStringIncludes(f.stdout, `1 ${CLEAN}`);
});

Deno.test("lock-listed or matched by an Exempt glob, the constitution is still measured", {
  ignore: isWindows,
}, async () => {
  const head = TABLE("| file | 300 | 500 |", "Exempt: `.specnaut/**`\n");
  const dir = await repo(10, constitution(100, head));
  await Deno.writeTextFile(
    join(dir, ".specnaut/installed.lock"),
    `version: 2\nentries:\n  ${PATH}:\n    sha256: abc\ntemplates_version: 1\n`,
  );
  await run("git", ["add", ".specnaut/installed.lock"], dir);
  await run("git", ["commit", "-q", "-m", "lock"], dir);
  await restage(dir, constitution(510, head));
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `${PATH}: 100 → 510`);
  // Every other `.specnaut/**` file stays exempt.
  await Deno.mkdir(join(dir, ".specnaut/specs/001-x"), { recursive: true });
  await restage(dir, constitution(100, head));
  await stage(dir, ".specnaut/specs/001-x/plan.md", 900);
  const other = await ratchet(dir);
  assertEquals(other.code, 0, other.stdout + other.stderr);
  assertStringIncludes(other.stdout, `0 ${CLEAN}`);
});

Deno.test("a malformed constitution row stops it with exit 2, never a pass", {
  ignore: isWindows,
}, async () => {
  for (
    const row of [
      "| constitution | 3OO | 500 |",
      "| constitution | 300 |",
      "| Constitution | 300 | 500 |",
      "| constitutions | 300 | 500 |",
      "| constitution | 300 | 500 |\n| constitution | 200 | 400 |",
    ]
  ) {
    const dir = await repo(10, TABLE(`| file | 300 | 500 |\n${row}`));
    await stage(dir, "big.ts", 20);
    const r = await ratchet(dir);
    assertEquals(r.code, 2, row + r.stdout + r.stderr);
    assert(!r.stdout.includes(CLEAN), "an unreadable row never prints the clean line");
  }
});
