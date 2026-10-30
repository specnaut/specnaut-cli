import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { pruneStaging } from "../../src/application/upgrade_staging.ts";
import { PathRefusal } from "../../src/domain/path_refusal.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { fakeStagingStore } from "./upgrade_fakes.ts";

/**
 * A staged copy Specnaut refused to delete because its path leaves the project
 * is not "safe to delete by hand" (cli#687): it is a link, and deleting by hand
 * what it points at deletes a file outside the project.
 */

const assertRefusalWording = (refusal: string) => {
  assert(!refusal.includes("safe to delete by hand"), `told to delete by hand: ${refusal}`);
  assertStringIncludes(refusal, "never what it points at");
};

Deno.test("a containment refusal while pruning gets its own message", async () => {
  const store = fakeStagingStore(["a.md", "b.md"]);
  store.delete = (_d, rel) =>
    rel === "a.md"
      ? Promise.reject(new PathRefusal("refusing to touch a path that leaves the project"))
      : Promise.reject(new Error("EBUSY: resource busy"));
  const refusals: string[] = [];
  await pruneStaging(store, "/p", new Set(), refusals);
  assertEquals(refusals.length, 2);
  assertStringIncludes(refusals[0], ".specnaut/upgrade-staging/a.md");
  assertStringIncludes(refusals[0], "refusing to touch a path that leaves the project");
  assertRefusalWording(refusals[0]);
  // Any other failure keeps the old advice: the copy is ours and inside.
  assertStringIncludes(refusals[1], "it is safe to delete by hand");
});

Deno.test("a staging directory that is refused gets the containment message too", async () => {
  const store = fakeStagingStore();
  store.cleanupIfEmpty = () => Promise.reject(new PathRefusal("refusing to touch a path"));
  const refusals: string[] = [];
  await pruneStaging(store, "/p", new Set(), refusals);
  assertEquals(refusals.length, 1);
  assertStringIncludes(refusals[0], ".specnaut/upgrade-staging/");
  assertRefusalWording(refusals[0]);
});

Deno.test({
  name: "a staged link leaving the project is left alone, its target untouched, and said",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const root = await Deno.makeTempDir();
    try {
      const project = join(root, "project");
      const outside = join(root, "outside.md");
      await Deno.writeTextFile(outside, "not the project's\n");
      await Deno.mkdir(join(project, ".specnaut/upgrade-staging"), { recursive: true });
      await Deno.symlink(outside, join(project, ".specnaut/upgrade-staging/x.md"));
      const refusals: string[] = [];
      await pruneStaging(new FsStagingStore(), project, new Set(), refusals);
      assertEquals(await Deno.readTextFile(outside), "not the project's\n");
      assert((await Deno.lstat(join(project, ".specnaut/upgrade-staging/x.md"))).isSymlink);
      assertEquals(refusals.length, 1, refusals.join("\n"));
      assertStringIncludes(refusals[0], "leaves the project");
      assertRefusalWording(refusals[0]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
