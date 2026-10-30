import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { pruneStaging } from "../../src/application/upgrade_staging.ts";
import { CAN_LINK } from "../helpers/link_text.ts";

/**
 * A staging root reached through a link is refused, never followed (cli#687).
 * Containment was judged against the project, so `.specnaut/upgrade-staging ->
 * ../src` passed it, and a no-op upgrade deleted every file under src/ as a
 * "stale staged copy" — no backup, no line of output.
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
        await Deno.symlink("elsewhere", join(dir, ".specnaut"));
      } else {
        await Deno.mkdir(join(dir, ".specnaut"));
        await Deno.symlink("../src", join(dir, ".specnaut/upgrade-staging"));
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
