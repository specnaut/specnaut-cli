import { assert, assertEquals } from "@std/assert";
import { basename, join } from "@std/path";
import { pruneEmptyParents } from "../../src/infrastructure/fs_prune.ts";
import { makeLink, symlinkTest } from "../helpers/link_text.ts";

/**
 * cli#751: the empty-folder walk judged containment by path text, so a folder
 * reached through a link under `stopAt` counted as inside it and was removed
 * where it really lies, outside. The bound is the real path of each folder
 * against the real `stopAt`, for every caller of the walk.
 */

symlinkTest("the walk never removes a folder whose real path is outside stopAt", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "prune-real-bound-" });
  try {
    const staging = join(tmp, "proj/.specnaut/upgrade-staging");
    await Deno.mkdir(staging, { recursive: true });
    await Deno.mkdir(join(tmp, "outside/b"), { recursive: true });
    await makeLink(join(tmp, "outside"), join(staging, "a"), "dir");
    const notes: string[] = [];
    await pruneEmptyParents(join(staging, "a/b"), staging, notes);
    assert((await Deno.stat(join(tmp, "outside/b"))).isDirectory, "the outside folder was removed");
    assert((await Deno.lstat(join(staging, "a"))).isSymlink, "the staging link was removed");
    assertEquals(notes, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

symlinkTest("the walk never removes stopAt reached through a link to its parent", async () => {
  // stopAt's own spelling differs from the folder's, so the loop's text check
  // does not stop it; only the real-path comparison against stopAt does. An
  // empty stopAt is the case where nothing else would.
  const tmp = await Deno.makeTempDir({ prefix: "prune-real-bound-" });
  try {
    const staging = join(tmp, "proj/.specnaut/upgrade-staging");
    await Deno.mkdir(staging, { recursive: true });
    await makeLink(join(tmp, "proj/.specnaut"), join(tmp, "elsewhere"), "dir");
    const notes: string[] = [];
    await pruneEmptyParents(join(tmp, "elsewhere", basename(staging)), staging, notes);
    assert((await Deno.stat(staging)).isDirectory, "stopAt was removed through the link");
    assertEquals(notes, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
