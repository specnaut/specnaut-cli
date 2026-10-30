import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { dirname, join, relative } from "@std/path";
import {
  ADDENDUM,
  addendum,
  find,
  HARNESSES,
  projectOn71,
  runSpecnaut,
  SECRET,
  withTempDir,
  write,
} from "./task_reorg_fixture.ts";

/**
 * Spec 037 — an old address whose bytes cannot be carried exactly stays where
 * it is, for the renamed docs and the addenda alike: a link is never copied
 * through, and a file that is not UTF-8 is never rewritten as its decode.
 */

for (const ai of HARNESSES) {
  Deno.test({
    name: `${ai}: a link at an old address is never copied through`,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await withTempDir(async (dir) => {
        const { moves } = await projectOn71(dir, ai);
        await write(dir, ".env.local", `${SECRET}\n`);
        await write(dir, ".gitignore", ".env.local\n");
        // An addendum and a renamed doc, each a link to the ignored secret.
        const link = addendum("specnaut", "plan");
        await Deno.mkdir(dirname(join(dir, link)), { recursive: true });
        await Deno.symlink(
          relative(dirname(join(dir, link)), join(dir, ".env.local")),
          join(dir, link),
        );
        const doc = find(moves, "implement.md");
        await Deno.remove(join(dir, doc.oldDest));
        await Deno.symlink(
          relative(dirname(join(dir, doc.oldDest)), join(dir, ".env.local")),
          join(dir, doc.oldDest),
        );

        const up = await runSpecnaut(["upgrade"], dir);
        assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

        assertEquals(await exists(join(dir, addendum("task", "plan"))), false);
        assert((await Deno.lstat(join(dir, link))).isSymlink, "the addendum link was moved");
        assertStringIncludes(up.stdout, `addendum ${link} is a link`);
        assert(
          !(await Deno.readTextFile(join(dir, doc.newDest))).includes(SECRET),
          "the renamed doc was copied through its link — the secret is now a tracked file",
        );
        assertStringIncludes(up.stdout, `${doc.oldDest} is a link`);
      });
    },
  });

  Deno.test(`${ai}: a file whose bytes are not UTF-8 stays put; a BOM travels intact`, async () => {
    await withTempDir(async (dir) => {
      const { moves } = await projectOn71(dir, ai);
      // Read as text these decode lossily; written back they would not be the
      // file. A BOM decodes losslessly and must still survive the move.
      const bytes = new Uint8Array([...new TextEncoder().encode("step\n"), 0xff, 0xfe, 0x0a]);
      const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(ADDENDUM)]);
      const doc = find(moves, "implement.md");
      await Deno.mkdir(dirname(join(dir, addendum("specnaut", "plan"))), { recursive: true });
      for (const rel of [addendum("specnaut", "plan"), doc.oldDest]) {
        await Deno.writeFile(join(dir, rel), bytes);
      }
      await Deno.writeFile(join(dir, addendum("specnaut", "review")), bom);

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

      assertEquals(await Deno.readFile(join(dir, addendum("specnaut", "plan"))), bytes);
      assertEquals(await exists(join(dir, addendum("task", "plan"))), false);
      assertStringIncludes(up.stdout, `addendum ${addendum("specnaut", "plan")} is not moved`);
      assertEquals(await Deno.readFile(join(dir, doc.oldDest)), bytes);
      assertStringIncludes(up.stdout, `${doc.oldDest} is not moved to ${doc.newDest}`);
      assertEquals(await Deno.readFile(join(dir, addendum("task", "review"))), bom);
    });
  });
}
