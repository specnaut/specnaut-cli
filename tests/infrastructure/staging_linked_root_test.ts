import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { pruneStaging } from "../../src/application/upgrade_staging.ts";
import { CAN_LINK, makeLink } from "../helpers/link_text.ts";

/**
 * A staging root reached through a link is refused, never followed (cli#687).
 * Containment was judged against the project, so `.specnaut/upgrade-staging ->
 * ../src` passed it, and a no-op upgrade deleted every file under src/ as a
 * "stale staged copy" — no backup, no line of output.
 *
 * Both links are made as directory links: Windows types its links, and Deno
 * resolves a relative target against the cwd, not the link's folder, so it
 * cannot infer the type itself. A directory link is what `lstat` must see as a
 * link on every system, so the refusal below is asserted unchanged on Windows.
 */
for (const linked of [".specnaut/upgrade-staging", ".specnaut"]) {
  Deno.test(`prune never deletes through a linked ${linked}`, { ignore: !CAN_LINK }, async () => {
    const dir = await Deno.makeTempDir({ prefix: "specnaut-staging-link-" });
    try {
      await Deno.mkdir(join(dir, "src"));
      await Deno.writeTextFile(join(dir, "src/a.ts"), "export {};\n");
      if (linked === ".specnaut") {
        await Deno.mkdir(join(dir, "elsewhere/upgrade-staging"), { recursive: true });
        await Deno.writeTextFile(join(dir, "elsewhere/upgrade-staging/b.md"), "b\n");
        await makeLink("elsewhere", join(dir, ".specnaut"), "dir");
      } else {
        await Deno.mkdir(join(dir, ".specnaut"));
        await makeLink("../src", join(dir, ".specnaut/upgrade-staging"), "dir");
      }
      const refusals: string[] = [];
      await pruneStaging(new FsStagingStore(), dir, new Set(), refusals).catch((err) =>
        refusals.push(String(err))
      );
      assertEquals(await Deno.readTextFile(join(dir, "src/a.ts")), "export {};\n");
      if (linked === ".specnaut") {
        assert(await Deno.stat(join(dir, "elsewhere/upgrade-staging/b.md")), "b.md was deleted");
      }
      assertStringIncludes(refusals.join("\n"), "reached through a symlink");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
