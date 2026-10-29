// `size-ratchet.sh` holds staged files to the project's file limits — the
// deterministic half of #644, for edits that never go through an agent. The
// limits come from `.specnaut/size-limits.yml` (spec 038); the grammar itself
// is pinned by `tests/domain/size_limits_corpus_test.ts`.
//
// Every passing assertion below also requires the script's own success line,
// `size-ratchet: N staged file(s) within the file limits`, which only the path
// that walked the staged files can print. A green run therefore proves the
// check ran, not merely that nothing failed.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import {
  BASH,
  CLEAN,
  EXEMPT,
  FILE,
  isWindows,
  ratchet,
  repo,
  run,
  SCRIPT,
  stage,
} from "./size_ratchet_fixture.ts";

Deno.test("an over-target file that grows is refused, with before → after and the limits", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(380, FILE(300, 400));
  await stage(dir, "big.ts", 390);
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stderr,
    "big.ts: 380 → 390 (target 300, ceiling 400) — over the target and grew",
  );
  assertStringIncludes(r.stderr, "source: config");
});

Deno.test("an over-target file that shrinks passes, and the check says it ran", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(380, FILE(300, 400));
  await stage(dir, "big.ts", 350);
  const r = await ratchet(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `1 ${CLEAN} (target 300, ceiling 400, source: config)`);
});

Deno.test("over the ceiling fails unless it shrinks", { ignore: isWindows }, async () => {
  const grows = await repo(380, FILE(300, 400));
  await stage(grows, "big.ts", 401);
  const g = await ratchet(grows);
  assertEquals(g.code, 1);
  assertStringIncludes(g.stderr, "big.ts: 380 → 401 (target 300, ceiling 400) — over the ceiling");

  const shrinks = await repo(900, FILE(300, 400));
  await stage(shrinks, "big.ts", 700);
  const s = await ratchet(shrinks);
  assertEquals(s.code, 0, s.stdout + s.stderr);
  assertStringIncludes(s.stdout, "over the ceiling, shrinking");
  assertStringIncludes(s.stdout, `1 ${CLEAN}`);
});

Deno.test("a new file crossing the target is a note, not a violation; past the ceiling it is", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(10, FILE(300, 400));
  await stage(dir, "fresh.ts", 320);
  const r = await ratchet(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(
    r.stdout,
    "note: fresh.ts: 0 → 320 (target 300, ceiling 400) — crosses the target",
  );
  await stage(dir, "fresh.ts", 420);
  const c = await ratchet(dir);
  assertEquals(c.code, 1);
  assertStringIncludes(c.stderr, "fresh.ts: 0 → 420");
});

Deno.test("extract, then add: measured from the branch base, the second commit passes", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(380, FILE(300, 400));
  await run("git", ["branch", "-M", "main"], dir);
  await run("git", ["switch", "-q", "-c", "feature"], dir);
  await stage(dir, "big.ts", 322);
  await run("git", ["commit", "-q", "-m", "extract"], dir);
  // The add grows the file from 322, but not past its size at the base (380).
  await stage(dir, "big.ts", 341);
  const ok = await ratchet(dir);
  assertEquals(ok.code, 0, ok.stdout + ok.stderr);
  assertStringIncludes(ok.stdout, `1 ${CLEAN}`);
  // Past the base size it is growth, whatever the previous commit was.
  await stage(dir, "big.ts", 390);
  const grew = await ratchet(dir);
  assertEquals(grew.code, 1);
  assertStringIncludes(
    grew.stderr,
    "big.ts: 380 → 390 (target 300, ceiling 400) — over the target and grew",
  );
});

Deno.test("Specnaut's own files are exempt: .specnaut/** and every installed.lock entry", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(10, FILE(300, 400));
  await Deno.mkdir(join(dir, ".claude/skills/x"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specnaut/installed.lock"),
    "version: 2\nentries:\n  .claude/skills/x/SKILL.md:\n    sha256: abc\ntemplates_version: 1\n",
  );
  await run("git", ["add", ".specnaut/installed.lock"], dir);
  await run("git", ["commit", "-q", "-m", "lock"], dir);
  await stage(dir, ".claude/skills/x/SKILL.md", 900);
  await Deno.mkdir(join(dir, ".specnaut/specs/001-x"), { recursive: true });
  await stage(dir, ".specnaut/specs/001-x/plan.md", 900);
  const r = await ratchet(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `0 ${CLEAN}`);
});

Deno.test("--report prints every checked file, before → after", { ignore: isWindows }, async () => {
  const dir = await repo(100, FILE(300, 400));
  await stage(dir, "big.ts", 120);
  const r = await run(BASH, [SCRIPT, "--report"], dir);
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "  big.ts: 100 → 120\n");
});

Deno.test(
  "no config, or no file unit: the defaults apply and say so",
  { ignore: isWindows },
  async () => {
    const none = await repo(310);
    await stage(none, "big.ts", 320);
    const a = await ratchet(none);
    assertEquals(a.code, 1);
    assertStringIncludes(a.stderr, "(target 300, ceiling 500) — over the target and grew");
    assertStringIncludes(a.stderr, "source: default");

    const noRow = await repo(310, "function:\n  target: 30\n  ceiling: 50\n");
    await stage(noRow, "big.ts", 305);
    const b = await ratchet(noRow);
    assertEquals(b.code, 0, b.stdout + b.stderr);
    assertStringIncludes(b.stdout, `1 ${CLEAN} (target 300, ceiling 500, source: default)`);
  },
);

Deno.test("none switches a rule off", { ignore: isWindows }, async () => {
  const dir = await repo(380, FILE("none", 400));
  await stage(dir, "big.ts", 399);
  const r = await ratchet(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `1 ${CLEAN} (target none, ceiling 400, source: config)`);
});

Deno.test(
  "an exempt glob is skipped, at the root and below it",
  { ignore: isWindows },
  async () => {
    const dir = await repo(
      10,
      FILE(300, 400, EXEMPT("*.lock", "**/generated/**")),
    );
    await stage(dir, "deno.lock", 900);
    await Deno.mkdir(join(dir, "src/generated"), { recursive: true });
    await stage(dir, "src/generated/api.ts", 900);
    const r = await ratchet(dir);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, `0 ${CLEAN}`);
  },
);

Deno.test(
  "a config it cannot read stops it with exit 2, never a pass — and runs nothing in it",
  { ignore: isWindows },
  async () => {
    for (
      const config of [
        FILE("3OO", 400),
        "file:\n  target: 300\n",
        "file: {target: 300, ceiling: 400}\n",
        FILE(300, 400) + FILE(200, 300),
        "files:\n  target: 300\n  ceiling: 400\n",
        "file:\n\ttarget: 300\n\tceiling: 400\n",
        FILE("$(touch pwned)", 400),
      ]
    ) {
      const dir = await repo(10, config);
      await stage(dir, "big.ts", 20);
      const r = await ratchet(dir);
      assertEquals(r.code, 2, config + r.stdout + r.stderr);
      assertStringIncludes(r.stderr, "size-ratchet: .specnaut/size-limits.yml: line ");
      assert(!r.stdout.includes(CLEAN), "an unreadable config never prints the clean line");
      assertEquals(await exists(join(dir, "pwned")), false, "a value is never evaluated");
    }
  },
);

Deno.test("a link at the config path is unreadable, never the defaults", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(10);
  await Deno.writeTextFile(join(dir, "elsewhere.yml"), FILE("none", "none"));
  await Deno.symlink(join(dir, "elsewhere.yml"), join(dir, ".specnaut/size-limits.yml"));
  await stage(dir, "big.ts", 20);
  const r = await ratchet(dir);
  assertEquals(r.code, 2, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "is a link");
});

Deno.test("a missing _config.sh beside the script is exit 3, never a pass", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(10);
  const lone = join(await Deno.makeTempDir(), "size-ratchet.sh");
  await Deno.copyFile(SCRIPT, lone);
  assertEquals((await run(BASH, [lone], dir)).code, 3);
});

Deno.test("outside a git work tree it exits 3", { ignore: isWindows }, async () => {
  const dir = await Deno.makeTempDir();
  assertEquals((await ratchet(dir)).code, 3);
});

Deno.test("--since holds committed changes from a ref to HEAD", { ignore: isWindows }, async () => {
  const dir = await repo(380, FILE(300, 400));
  const base = (await run("git", ["rev-parse", "HEAD"], dir)).stdout.trim();
  await stage(dir, "big.ts", 395);
  await run("git", ["commit", "-q", "-m", "grow"], dir);
  const r = await run(BASH, [SCRIPT, "--since", base], dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `1 changed since ${base} file(s) break`);
  assertStringIncludes(r.stderr, "big.ts: 380 → 395");
  // Nothing is staged, so the pre-commit form has nothing to say — and says so.
  const staged = await ratchet(dir);
  assertEquals(staged.code, 0);
  assertStringIncludes(staged.stdout, `0 staged file(s) within the file limits`);
  assertEquals((await run(BASH, [SCRIPT, "--since", "no-such-ref"], dir)).code, 3);
});
