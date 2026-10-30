import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { dirname, join } from "@std/path";
import {
  ADDENDUM,
  addendum,
  assertBytes,
  find,
  HARNESSES,
  projectOn71,
  runSpecnaut,
  snapshot,
  withTempDir,
  write,
} from "./task_reorg_fixture.ts";

/** Spec 037 — an addendum follows its phase to the address the router now reads. */

for (const ai of HARNESSES) {
  Deno.test(`${ai}: addenda follow their phase; both-present and unmoved phases stay`, async () => {
    await withTempDir(async (dir) => {
      await projectOn71(dir, ai);
      await write(dir, addendum("specnaut", "plan"), ADDENDUM);
      await write(dir, addendum("specnaut", "upgrade"), ADDENDUM);
      await write(dir, addendum("specnaut", "tag-version"), ADDENDUM);
      await write(dir, addendum("specnaut", "review"), "old review step\n");
      await write(dir, addendum("task", "review"), "new review step\n");

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

      // Byte-identical at the address `/task plan` reads, gone from the old.
      await assertBytes(dir, addendum("task", "plan"), ADDENDUM);
      assertEquals(await exists(join(dir, addendum("specnaut", "plan"))), false);
      assertStringIncludes(up.stdout, `moved to ${addendum("task", "plan")}`);
      // The spec 033 rename's addendum moves now too.
      await assertBytes(dir, addendum("ship", "tag"), ADDENDUM);
      assertEquals(await exists(join(dir, addendum("specnaut", "tag-version"))), false);
      // `upgrade` did not move, so neither does its addendum.
      await assertBytes(dir, addendum("specnaut", "upgrade"), ADDENDUM);
      // Both present: neither moves, and it is said.
      await assertBytes(dir, addendum("specnaut", "review"), "old review step\n");
      await assertBytes(dir, addendum("task", "review"), "new review step\n");
      assertStringIncludes(
        up.stdout,
        `addendum ${addendum("specnaut", "review")} is not moved to ${
          addendum("task", "review")
        }: a file is already there`,
      );
    });
  });

  Deno.test(`${ai}: --dry-run reports the moves and changes nothing`, async () => {
    await withTempDir(async (dir) => {
      const { moves } = await projectOn71(dir, ai, { customise: ["plan.md"] });
      await write(dir, addendum("specnaut", "plan"), ADDENDUM);
      const before = await snapshot(dir);

      const up = await runSpecnaut(["upgrade", "--dry-run"], dir);
      assertEquals(up.code, 0, `upgrade --dry-run failed: ${up.stderr}`);

      assertEquals(await snapshot(dir), before, "a dry run changed the tree");
      assertStringIncludes(up.stdout, `would move to ${addendum("task", "plan")}`);
      assertStringIncludes(up.stdout, `your edits to ${find(moves, "plan.md").oldDest} would move`);
    });
  });

  Deno.test({
    name: `${ai}: an old addendum that cannot be deleted is reported as copied, not as not moved`,
    // POSIX permission bits. Root ignores them, but asking the uid needs
    // --allow-sys, which `deno task test` does not grant; no CI runner is root.
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await withTempDir(async (dir) => {
        await projectOn71(dir, ai);
        const from = addendum("specnaut", "plan");
        const to = addendum("task", "plan");
        await write(dir, from, ADDENDUM);
        // The write lands under `task/`; the delete under `specnaut/` is refused.
        const held = dirname(join(dir, from));
        await Deno.chmod(held, 0o555);
        try {
          const up = await runSpecnaut(["upgrade"], dir);
          assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

          await assertBytes(dir, to, ADDENDUM, "the copy did not land");
          await assertBytes(
            dir,
            from,
            ADDENDUM,
            "the old copy is gone — the delete was not refused",
          );
          assertStringIncludes(
            up.stdout,
            `addendum ${from} copied to ${to}, old copy left at ${from}, delete it by hand`,
          );
          assert(
            !up.stdout.includes(`${from} is not moved`),
            "a landed copy reported as not moved",
          );
        } finally {
          await Deno.chmod(held, 0o755);
        }
      });
    },
  });
}
