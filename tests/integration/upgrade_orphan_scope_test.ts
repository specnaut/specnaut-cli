import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";
import { appendLock, lockText, plant, sha256 } from "./_lock_fixture.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * The orphan path end to end, on the real filesystem writer and the real
 * summary: what a committed lock may make `upgrade` delete (cli#665), and what
 * happens to an orphan `upgrade` keeps, customised (cli#666) or declared (cli#668).
 *
 * The use-case tests prove the decisions; this proves they reach the disk, the
 * lock file and the output a user reads.
 */

async function runSpecnaut(args: string[], cwd: string, home: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    env: { HOME: home },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

/**
 * A fresh Claude project, handed to `body` and removed afterwards whatever
 * happens. Every test here starts from an init, so none depends on another.
 */
async function withProject(body: (dir: string, home: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-orphan-" });
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  try {
    const init = await runSpecnaut(
      ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
      dir,
      home,
    );
    assertEquals(init.code, 0, init.out);
    await body(dir, home);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

const KEPT = ".claude/skills/retired-thing/SKILL.md";
const EDITED = "original\nmy own notes\n";

// Each records the sha of exactly what is on disk: a clean orphan, which without
// the scope check goes with no backup.
const FOREIGN: Record<string, string> = {
  "src/app.ts": "export const app = 1;\n",
  ".git/config": "[core]\n\tbare = false\n",
  ".claude/settings.local.json": "{}\n",
  ".specnaut/preserve.yml": "preserve: []\n",
};
const plantForeign = (dir: string) =>
  plant(dir, Object.entries(FOREIGN).map(([rel, body]) => [rel, body, body]));

for (const args of [["upgrade"], ["upgrade", "--force"]]) {
  Deno.test(`\`${args.join(" ")}\` leaves every orphan outside Specnaut's folders`, async () => {
    // One project per flag: the first run drops the entries, which would leave
    // a second run in the same project nothing to refuse.
    await withProject(async (dir, home) => {
      await plantForeign(dir);
      const up = await runSpecnaut(args, dir, home);
      assertEquals(up.code, 0, up.out);
      for (const [rel, body] of Object.entries(FOREIGN)) {
        assertEquals(await Deno.readTextFile(join(dir, rel)), body, `touched ${rel}`);
      }
    });
  });
}

Deno.test("upgrade reports a foreign orphan as untracked and drops it from the lock", async () => {
  await withProject(async (dir, home) => {
    await plantForeign(dir);
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assertStringIncludes(up.out, "no longer tracked — outside Specnaut's folders");
    assertStringIncludes(up.out, `${Object.keys(FOREIGN).length} untracked`);
    const lock = await lockText(dir);
    for (const rel of Object.keys(FOREIGN)) {
      assertStringIncludes(up.out, `⚠ ${rel}`);
      assert(!lock.includes(`  ${rel}:`), `${rel} is still in the lock`);
    }
  });
});

Deno.test("upgrade keeps a customised orphan tracked until --force removes it, backed up", async () => {
  await withProject(async (dir, home) => {
    await plant(dir, [[KEPT, EDITED, "original\n"]]);
    // Kept, reported, and still tracked with the sha it was installed with —
    // on this run and the next.
    for (const run of ["first", "second"]) {
      const up = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(up.code, 0, up.out);
      assert(await exists(join(dir, KEPT)), `${run} upgrade deleted the customised orphan`);
      assertStringIncludes(up.out, `⚠ ${KEPT}`);
      assertStringIncludes(up.out, "1 orphan-preserved");
      assertStringIncludes(
        await lockText(dir),
        `  ${KEPT}:\n    sha256: ${await sha256("original\n")}\n`,
      );
    }
    const forced = await runSpecnaut(["upgrade", "--force"], dir, home);
    assertEquals(forced.code, 0, forced.out);
    assertEquals(await exists(join(dir, KEPT)), false, "--force left the customised orphan");
    assertEquals(await Deno.readTextFile(join(dir, `${KEPT}.specnaut.bak`)), EDITED);
    assertStringIncludes(forced.out, "removed (was customized — backed up to .specnaut.bak)");
    assertStringIncludes(forced.out, "1 orphan-removed");
    assert(
      !(await lockText(dir)).includes(`  ${KEPT}:`),
      "--force removed the file, kept the entry",
    );
  });
});

Deno.test("upgrade keeps reporting a declared orphan until --reset-preserved lifts it (cli#668)", async () => {
  await withProject(async (dir, home) => {
    await plant(dir, [[KEPT, "original\n", "original\n"]]);
    await Deno.writeTextFile(join(dir, ".specnaut/preserve.yml"), `preserved:\n  - ${KEPT}\n`);
    const entry = `  ${KEPT}:\n    sha256: ${await sha256("original\n")}\n`;
    // The first run used to delete it, the "ignored" declaration notwithstanding;
    // the second is the one that went silent once that was fixed. `--force`
    // does not lift a declaration either.
    for (const args of [["upgrade"], ["upgrade"], ["upgrade", "--force"]]) {
      const run = args.join(" ");
      const up = await runSpecnaut(args, dir, home);
      assertEquals(up.code, 0, up.out);
      assert(await exists(join(dir, KEPT)), `\`${run}\` deleted the declared orphan`);
      assert(!up.out.includes("not a managed file"), `\`${run}\` ignored the declaration`);
      assertStringIncludes(up.out, "upstream no longer ships this path", `${run} run`);
      assertStringIncludes(up.out, `⚠ ${KEPT}`);
      assertStringIncludes(await lockText(dir), entry);
    }
    // Lifted, it is an ordinary clean orphan: removed and untracked.
    const reset = await runSpecnaut(["upgrade", "--reset-preserved"], dir, home);
    assertEquals(reset.code, 0, reset.out);
    assertEquals(await exists(join(dir, KEPT)), false, "--reset-preserved kept the orphan");
    assert(!(await lockText(dir)).includes(`  ${KEPT}:`), "--reset-preserved kept the entry");
  });
});

Deno.test("a declared lock entry outside Specnaut's folders is not a managed file", async () => {
  await withProject(async (dir, home) => {
    await plant(dir, [["src/app.ts", FOREIGN["src/app.ts"], FOREIGN["src/app.ts"]]]);
    await Deno.writeTextFile(join(dir, ".specnaut/preserve.yml"), "preserved:\n  - src/app.ts\n");
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assertStringIncludes(up.out, "src/app.ts — declared preserved but not a managed file");
  });
});

/**
 * The measured bypass: committed links under a managed root, and lock entries
 * reaching through them. The text is in scope; the files are not.
 */
async function plantLinks(dir: string) {
  const code = "export const app = 1;\n";
  const head = "ref: refs/heads/main\n";
  await plant(dir, [["src/app.ts", code, code], [".git/HEAD", head, head]]);
  await Deno.symlink("../../src", join(dir, ".claude/skills/s"));
  await Deno.symlink("../../.git", join(dir, ".claude/skills/g"));
  const vias = [".claude/skills/s/app.ts", ".claude/skills/g/HEAD"];
  await appendLock(dir, [[vias[0], code], [vias[1], head]]);
  return { code, head, vias };
}

Deno.test({
  name: "upgrade refuses a lock entry that reaches outside through a committed link",
  // `Deno.symlink` needs Developer Mode or elevation on Windows: IGNORED there,
  // never short-circuited into a pass.
  ignore: Deno.build.os === "windows",
}, async () => {
  await withProject(async (dir, home) => {
    const { code, head, vias } = await plantLinks(dir);

    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assertEquals(await Deno.readTextFile(join(dir, "src/app.ts")), code);
    assertEquals(await Deno.readTextFile(join(dir, ".git/HEAD")), head);
    for (const via of vias) {
      // Reported where it belongs — not under "removed", which the plan expected.
      assertStringIncludes(up.out, `⚠ ${via}`);
      assert(
        (await Deno.lstat(join(dir, via, ".."))).isSymlink,
        `the link above ${via} was pruned`,
      );
      assert(!(await lockText(dir)).includes(`  ${via}:`), `${via} is still in the lock`);
    }
    assert(
      !/✗ \.claude\/skills\/[sg]\//.test(up.out),
      `a refused orphan printed as removed:\n${up.out}`,
    );
  });
});
