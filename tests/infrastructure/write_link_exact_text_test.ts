import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import type { Bundle } from "../../src/domain/template.ts";

/**
 * The writer recognises its own context link by the link's exact text
 * (cli#687), not by where a lexical normalisation says the text lands.
 *
 * POSIX only, by nature rather than for want of a link: the case is a `\` that
 * is a literal character in a file name, and on Windows it is a separator.
 */

const DEST = ".claude/CLAUDE.md";
const LINKED: Bundle = {
  [DEST]: { content: "@../AGENTS.md\n", executable: false, symlinkTo: "../AGENTS.md" },
};

Deno.test({
  name: "a link that only normalises to ours is replaced with our link, and backed up",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(dir, "AGENTS.md"), "# AGENTS\n");
      await Deno.mkdir(join(dir, ".claude"));
      // `a\b` is one segment here, so this climbs out of the project.
      const foreign = "a\\b/../../../AGENTS.md";
      await Deno.symlink(foreign, join(dir, DEST));
      const report = await new DenoFsWriter().writeBundle(LINKED, dir, {
        overwrite: true,
        backupExisting: true,
      });
      assertEquals(await Deno.readLink(join(dir, DEST)), "../AGENTS.md");
      assertEquals(report.links, [{ dest: DEST, target: "../AGENTS.md", form: "symlink" }]);
      assertEquals(report.backups.map((b) => [b.dest, b.wasSymlink]), [[DEST, true]]);
      const bak = join(dir, report.backups[0].backupPath);
      assert((await Deno.lstat(bak)).isSymlink, "the foreign link was not moved aside");
      assertEquals(await Deno.readLink(bak), foreign);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
