import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { dirname, join } from "@std/path";
import {
  assertBytes,
  entry,
  find,
  HARNESSES,
  plantRetired,
  projectOn71,
  runSpecnaut,
  USER_EDIT,
  withTempDir,
  write,
} from "./task_reorg_fixture.ts";

/** Spec 037 — the renamed docs: each lands at its new address as the bytes the project had. */

for (const ai of HARNESSES) {
  Deno.test(`${ai}: untouched docs move, and customised plan.md and groom.md travel`, async () => {
    await withTempDir(async (dir) => {
      const { moves } = await projectOn71(dir, ai, { customise: ["plan.md", "groom.md"] });

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}\n${up.stdout}`);

      const lock = await Deno.readTextFile(join(dir, ".specnaut/installed.lock"));
      for (const { oldDest, newDest, planted } of moves) {
        // Byte for byte (cli#702): an `includes` passes a file that kept the
        // edit and lost everything around it.
        await assertBytes(dir, newDest, planted, `${newDest}: wrong bytes at the new address`);
        assertEquals(await exists(join(dir, oldDest)), false, `${oldDest} survived the move`);
        assertStringIncludes(lock, `  ${newDest}:`);
        assert(!lock.includes(`  ${oldDest}:`), `the lock still tracks ${oldDest}`);
      }
      // The reason reaches the person, once per customisation that travelled.
      const plan = find(moves, "plan.md");
      assertStringIncludes(
        up.stdout,
        `your edits to ${plan.oldDest} moved to ${plan.newDest} (${plan.row.reason})`,
      );
      assertStringIncludes(up.stdout, `your edits to ${find(moves, "groom.md").oldDest} moved`);
      assert(!up.stdout.includes(`your edits to ${find(moves, "implement.md").oldDest}`));
    });
  });

  Deno.test(`${ai}: a customised doc with CRLF line endings travels with its CRLFs`, async () => {
    await withTempDir(async (dir) => {
      const { moves } = await projectOn71(dir, ai, { customise: ["plan.md"], crlf: true });
      const plan = find(moves, "plan.md");
      assertStringIncludes(plan.planted, "\r\n", "the fixture planted no CRLF");

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}\n${up.stdout}`);

      await assertBytes(dir, plan.newDest, plan.planted, "the move rewrote the line endings");
      assertEquals(await exists(join(dir, plan.oldDest)), false, `${plan.oldDest} survived`);
      assertStringIncludes(up.stdout, `your edits to ${plan.oldDest} moved to ${plan.newDest}`);
    });
  });

  Deno.test(`${ai}: a file Specnaut never wrote at a new address is not overwritten`, async () => {
    await withTempDir(async (dir) => {
      const { moves, dest } = await projectOn71(dir, ai, { customise: ["plan.md"] });
      // `/task` is a common name: a project may already have its own.
      const router = dest(entry("backlog-skill", "task"));
      await write(dir, router, "# Our own task skill\n");
      // And its own file where a renamed doc is about to land.
      const plan = find(moves, "plan.md");
      await write(dir, plan.newDest, "# Our own plan notes\n");

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

      await assertBytes(dir, router, "# Our own task skill\n");
      await assertBytes(dir, plan.newDest, "# Our own plan notes\n");
      assertStringIncludes(
        up.stdout,
        `${plan.oldDest} is not moved to ${plan.newDest}: a file is already there`,
      );
      // The customisation is not lost: it stays at the old address, as it was.
      await assertBytes(dir, plan.oldDest, plan.planted);
    });
  });

  Deno.test(`${ai}: a customised board and sec-audit router warn until --force, then are backed up`, async () => {
    await withTempDir(async (dir) => {
      const { dest } = await projectOn71(dir, ai);
      const board = dest(entry("backlog-skill", "board"));
      const sec = dest(entry("skill", "sec-audit"));
      await plantRetired(dir, board);
      await plantRetired(dir, sec);

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
      for (const rel of [board, sec]) {
        assertStringIncludes(await Deno.readTextFile(join(dir, rel)), USER_EDIT);
        assertStringIncludes(up.stdout, rel, `${rel} kept without a word`);
      }

      const forced = await runSpecnaut(["upgrade", "--force"], dir);
      assertEquals(forced.code, 0, `upgrade --force failed: ${forced.stderr}`);
      for (const rel of [board, sec]) {
        assertEquals(await exists(join(dir, rel)), false, `${rel} survived --force`);
        const backups = [...Deno.readDirSync(dirname(join(dir, rel)))]
          .filter((e) => e.name.startsWith(`${rel.split("/").pop()}.specnaut.bak`));
        assertEquals(backups.length, 1, `${rel} was removed without a backup`);
      }
    });
  });
}
