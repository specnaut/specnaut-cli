// `size-ratchet.sh` holds staged files to the constitution's file limits — the
// deterministic half of #644, for edits that never go through an agent.
//
// Every passing assertion below also requires the script's own success line,
// `size-ratchet: N staged file(s) within the file limits`, which only the path
// that walked the staged files can print. A green run therefore proves the
// check ran, not merely that nothing failed.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const SCRIPT = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/size-ratchet.sh", import.meta.url),
);

type Result = { code: number; stdout: string; stderr: string };

async function run(bin: string, args: string[], cwd: string): Promise<Result> {
  const { code, stdout, stderr } = await new Deno.Command(bin, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: {
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).output();
  const d = new TextDecoder();
  return { code, stdout: d.decode(stdout), stderr: d.decode(stderr) };
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

const TABLE = (file: string, exempt = "") =>
  `# Constitution\n\n## Size limits\n\n| Unit | Target | Ceiling |\n| :--- | ---: | ---: |\n${file}\n| function | 30 | 50 |\n${exempt}\n## Next\n`;

/** A repo with `big.ts` committed at `start` lines and the constitution given. */
async function repo(start: number, constitution?: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "size-ratchet-" });
  await run("git", ["init", "-q"], dir);
  await Deno.writeTextFile(join(dir, "big.ts"), lines(start));
  if (constitution !== undefined) {
    await Deno.mkdir(join(dir, ".specnaut/memory"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut/memory/constitution.md"), constitution);
  }
  await run("git", ["add", "-A"], dir);
  await run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}

async function stage(dir: string, path: string, n: number): Promise<void> {
  await Deno.writeTextFile(join(dir, path), lines(n));
  await run("git", ["add", path], dir);
}

const BASH = "bash";
const ratchet = (dir: string) => run(BASH, [SCRIPT], dir);
const CLEAN = "staged file(s) within the file limits";
const isWindows = Deno.build.os === "windows";

Deno.test("an over-target file that grows is refused, with before → after and the limits", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(380, TABLE("| file | 300 | 400 |"));
  await stage(dir, "big.ts", 390);
  const r = await ratchet(dir);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stderr,
    "big.ts: 380 → 390 (target 300, ceiling 400) — over the target and grew",
  );
  assertStringIncludes(r.stderr, "source: constitution");
});

Deno.test("an over-target file that shrinks passes, and the check says it ran", {
  ignore: isWindows,
}, async () => {
  const dir = await repo(380, TABLE("| file | 300 | 400 |"));
  await stage(dir, "big.ts", 350);
  const r = await ratchet(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `1 ${CLEAN} (target 300, ceiling 400, source: constitution)`);
});

Deno.test("over the ceiling fails unless it shrinks", { ignore: isWindows }, async () => {
  const grows = await repo(380, TABLE("| file | 300 | 400 |"));
  await stage(grows, "big.ts", 401);
  const g = await ratchet(grows);
  assertEquals(g.code, 1);
  assertStringIncludes(g.stderr, "big.ts: 380 → 401 (target 300, ceiling 400) — over the ceiling");

  const shrinks = await repo(900, TABLE("| file | 300 | 400 |"));
  await stage(shrinks, "big.ts", 700);
  const s = await ratchet(shrinks);
  assertEquals(s.code, 0, s.stdout + s.stderr);
  assertStringIncludes(s.stdout, "over the ceiling, shrinking");
  assertStringIncludes(s.stdout, `1 ${CLEAN}`);
});

Deno.test("a new file is measured from zero", { ignore: isWindows }, async () => {
  const dir = await repo(10, TABLE("| file | 300 | 400 |"));
  await stage(dir, "fresh.ts", 320);
  const r = await ratchet(dir);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "fresh.ts: 0 → 320");
});

Deno.test(
  "no constitution, or no file row: the defaults apply and say so",
  { ignore: isWindows },
  async () => {
    const none = await repo(310);
    await stage(none, "big.ts", 320);
    const a = await ratchet(none);
    assertEquals(a.code, 1);
    assertStringIncludes(a.stderr, "(target 300, ceiling 500) — over the target and grew");
    assertStringIncludes(a.stderr, "source: default");

    const noRow = await repo(
      310,
      "# C\n\n## Size limits\n\n| Unit | Target | Ceiling |\n| :--- | ---: | ---: |\n| function | 30 | 50 |\n",
    );
    await stage(noRow, "big.ts", 305);
    const b = await ratchet(noRow);
    assertEquals(b.code, 0, b.stdout + b.stderr);
    assertStringIncludes(b.stdout, `1 ${CLEAN} (target 300, ceiling 500, source: default)`);
  },
);

Deno.test("none switches a rule off", { ignore: isWindows }, async () => {
  const dir = await repo(380, TABLE("| file | none | 400 |"));
  await stage(dir, "big.ts", 399);
  const r = await ratchet(dir);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, `1 ${CLEAN} (target none, ceiling 400, source: constitution)`);
});

Deno.test(
  "an exempt glob is skipped, at the root and below it",
  { ignore: isWindows },
  async () => {
    const dir = await repo(
      10,
      TABLE("| file | 300 | 400 |", "Exempt: `*.lock`, `**/generated/**`\n"),
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
  "a table it cannot read stops it with exit 2, never a pass",
  { ignore: isWindows },
  async () => {
    for (
      const constitution of [
        TABLE("| file | 3OO | 400 |"),
        TABLE("| file | 300 |"),
        "# C\n\n## Size limits\n\nfiles stay small\n",
        TABLE("| file | 300 | 400 |\n| file | 200 | 300 |"),
      ]
    ) {
      const dir = await repo(10, constitution);
      await stage(dir, "big.ts", 20);
      const r = await ratchet(dir);
      assertEquals(r.code, 2, constitution + r.stdout + r.stderr);
      assert(!r.stdout.includes(CLEAN), "an unreadable table never prints the clean line");
    }
  },
);

Deno.test("outside a git work tree it exits 3", { ignore: isWindows }, async () => {
  const dir = await Deno.makeTempDir();
  assertEquals((await ratchet(dir)).code, 3);
});

Deno.test("--since holds committed changes from a ref to HEAD", { ignore: isWindows }, async () => {
  const dir = await repo(380, TABLE("| file | 300 | 400 |"));
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
