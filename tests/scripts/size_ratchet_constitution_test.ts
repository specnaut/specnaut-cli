// The constitution is loaded into every session. #663 holds it to its own
// `constitution` unit — 60 / 100 by default since spec 038, set in
// `.specnaut/size-limits.yml` — measured whenever `docs/constitution.md` is
// staged, lock-listed or exempt-globbed or not, with the same rules as a file.
//
// A passing case requires the script's success line, which only the path that
// walked the staged files prints; a refusal requires the unit and its source in
// the violation line, which only the constitution branch writes.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";
import {
  CLEAN,
  EXEMPT,
  FILE,
  isWindows,
  lines,
  ratchet,
  repo,
  run,
  stage,
  UNIT,
} from "./size_ratchet_fixture.ts";

const PATH = CONSTITUTION_PATH;

/** A constitution of exactly `n` lines. */
const constitution = (n: number) => "# Constitution\n" + lines(n - 1);

async function restage(dir: string, content: string): Promise<void> {
  await Deno.writeTextFile(join(dir, PATH), content);
  await run("git", ["add", PATH], dir);
}

Deno.test(
  "a staged constitution past 100 lines is refused, with the unit, source and what to move",
  {
    ignore: isWindows,
  },
  async () => {
    const dir = await repo(10, undefined, constitution(90));
    await restage(dir, constitution(101));
    const r = await ratchet(dir);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(
      r.stderr,
      `${PATH}: 90 → 101 (target 60, ceiling 100) (unit constitution, source: default) — over the ceiling`,
    );
    assertStringIncludes(r.stderr, "every Sync Impact Report but the");
  },
);

Deno.test("an over-target constitution that grows is refused; one that shrinks passes", {
  ignore: isWindows,
}, async () => {
  const grows = await repo(10, undefined, constitution(70));
  await restage(grows, constitution(80));
  const g = await ratchet(grows);
  assertEquals(g.code, 1, g.stdout + g.stderr);
  assertStringIncludes(g.stderr, `${PATH}: 70 → 80 (target 60, ceiling 100)`);
  assertStringIncludes(g.stderr, "over the target and grew");

  const shrinks = await repo(10, undefined, constitution(300));
  await restage(shrinks, constitution(150));
  const s = await ratchet(shrinks);
  assertEquals(s.code, 0, s.stdout + s.stderr);
  assertStringIncludes(s.stdout, "over the ceiling, shrinking");
  assertStringIncludes(s.stdout, `1 ${CLEAN}`);
});

Deno.test("the config's constitution unit overrides the default", {
  ignore: isWindows,
}, async () => {
  const config = FILE(300, 500, UNIT("constitution", 50, 80));
  const dir = await repo(10, config, constitution(40));
  await restage(dir, constitution(90));
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stderr,
    `${PATH}: 40 → 90 (target 50, ceiling 80) (unit constitution, source: config)`,
  );

  const off = FILE(300, 500, UNIT("constitution", "none", "none"));
  const free = await repo(10, off, constitution(40));
  await restage(free, constitution(900));
  const f = await ratchet(free);
  assertEquals(f.code, 0, f.stdout + f.stderr);
  assertStringIncludes(f.stdout, `1 ${CLEAN}`);
});

Deno.test("lock-listed or matched by an exempt glob, the constitution is still measured", {
  ignore: isWindows,
}, async () => {
  const config = FILE(300, 500, EXEMPT("docs/**", ".specnaut/**"));
  const dir = await repo(10, config, constitution(100));
  await Deno.writeTextFile(
    join(dir, ".specnaut/installed.lock"),
    `version: 2\nentries:\n  ${PATH}:\n    sha256: abc\ntemplates_version: 1\n`,
  );
  await run("git", ["add", ".specnaut/installed.lock"], dir);
  await run("git", ["commit", "-q", "-m", "lock"], dir);
  await restage(dir, constitution(110));
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `${PATH}: 100 → 110`);
  // Every other `.specnaut/**` file stays exempt.
  await Deno.mkdir(join(dir, ".specnaut/specs/001-x"), { recursive: true });
  await restage(dir, constitution(100));
  await stage(dir, ".specnaut/specs/001-x/plan.md", 900);
  const other = await ratchet(dir);
  assertEquals(other.code, 0, other.stdout + other.stderr);
  assertStringIncludes(other.stdout, `0 ${CLEAN}`);
});

Deno.test("a size-limits table left in the constitution is not read — the config is", {
  ignore: isWindows,
}, async () => {
  const table = "# C\n\n## Size" + " limits\n\n| Unit | Target | Ceiling |\n" +
    "| :--- | ---: | ---: |\n| constitution | none | none |\n";
  const dir = await repo(10, undefined, table + lines(80));
  await restage(dir, table + lines(120));
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "(target 60, ceiling 100) (unit constitution, source: default)");
});

Deno.test("a malformed constitution unit stops it with exit 2, never a pass", {
  ignore: isWindows,
}, async () => {
  for (
    const unit of [
      UNIT("constitution", "3OO", 500),
      "constitution:\n  target: 300\n",
      "Constitution:\n  target: 300\n  ceiling: 500\n",
      "constitutions:\n  target: 300\n  ceiling: 500\n",
      UNIT("constitution", 300, 500) + UNIT("constitution", 200, 400),
    ]
  ) {
    const dir = await repo(10, FILE(300, 500, unit));
    await stage(dir, "big.ts", 20);
    const r = await ratchet(dir);
    assertEquals(r.code, 2, unit + r.stdout + r.stderr);
    assert(!r.stdout.includes(CLEAN), "an unreadable unit never prints the clean line");
  }
});
