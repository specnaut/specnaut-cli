import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { pruneStaging } from "../../src/application/upgrade_staging.ts";
import { PathRefusal } from "../../src/application/path_refusal.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { fakeStagingStore } from "./upgrade_fakes.ts";

/**
 * A staged path Specnaut refused to delete because it is a link, or lies behind
 * one, is not "safe to delete by hand" (cli#687, cli#751): deleting by hand what
 * it points at deletes a file Specnaut never wrote.
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
  const refusals = await pruneStaging(store, "/p", new Set());
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
  const refusals = await pruneStaging(store, "/p", new Set());
  assertEquals(refusals.length, 1);
  assertStringIncludes(refusals[0], ".specnaut/upgrade-staging/");
  assertRefusalWording(refusals[0]);
});

Deno.test("a staging tree that cannot be listed is one line, and nothing is deleted", async () => {
  // cli#753: the listing sat outside every `try`, so an unreadable staged folder
  // aborted the whole upgrade before its managed sections and lock write.
  const store = fakeStagingStore(["stale.md"]);
  store.list = () => Promise.reject(new Deno.errors.PermissionDenied("readdir '/p/locked'"));
  store.cleanupIfEmpty = () => Promise.reject(new Error("tidied after a failed listing"));
  const refusals = await pruneStaging(store, "/p", new Set());
  assertEquals(refusals.length, 1, refusals.join("\n"));
  assertStringIncludes(refusals[0], ".specnaut/upgrade-staging/");
  assertStringIncludes(refusals[0], "locked");
  assertEquals(store.deleted, []);
});

Deno.test("a refusal while listing still aborts the prune, the same error", async () => {
  const refusal = new PathRefusal("refusing to use a staging directory reached through a symlink");
  const store = fakeStagingStore();
  store.list = () => Promise.reject(refusal);
  const thrown = await assertRejects(() => pruneStaging(store, "/p", new Set()));
  assertStrictEquals(thrown, refusal);
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
      const refusals = await pruneStaging(new FsStagingStore(), project, new Set());
      assertEquals(await Deno.readTextFile(outside), "not the project's\n");
      assert((await Deno.lstat(join(project, ".specnaut/upgrade-staging/x.md"))).isSymlink);
      assertEquals(refusals.length, 1, refusals.join("\n"));
      // Judged by the entry, a link, not by where it lands (cli#751).
      assertStringIncludes(refusals[0], "refusing to delete a staged path");
      assertRefusalWording(refusals[0]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
