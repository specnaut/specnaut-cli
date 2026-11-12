import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import { FsExportStore } from "../../src/infrastructure/fs_tree_export.ts";
import { looseAncestor, privateFolderFault } from "../../src/infrastructure/private_folder.ts";
import { tempDir } from "../helpers/git_fixture.ts";

const folder = { isDirectory: true, uid: 501, mode: 0o40700 };
const posix = Deno.build.os !== "windows";

Deno.test("the cache folder must be a folder owned by this user", () => {
  assertEquals(privateFolderFault(folder, 501), null);
  assertEquals(privateFolderFault({ ...folder, mode: 0o40777 }, 501), null, "a mode is tightened");
  assertEquals(privateFolderFault({ ...folder, uid: 502 }, 501), "is not owned by this user");
  assertEquals(privateFolderFault({ ...folder, uid: null }, 501), "is not owned by this user");
  assertEquals(privateFolderFault({ ...folder, isDirectory: false }, 501), "is not a folder");
});

Deno.test("a folder above is loose when group or others may write it without a sticky bit", () => {
  assertEquals(looseAncestor({ ...folder, mode: 0o40755 }), false);
  assertEquals(looseAncestor({ ...folder, mode: 0o40775 }), true);
  assertEquals(looseAncestor({ ...folder, mode: 0o40757 }), true);
  assertEquals(looseAncestor({ ...folder, mode: 0o41777 }), false, "the sticky /tmp shape");
});

/** A store whose cache folder sits in `parent`, made with `mode`. */
async function storeUnder(base: string, parentMode: number): Promise<FsExportStore> {
  for (const d of ["project", "parent"]) await Deno.mkdir(join(base, d));
  await Deno.chmod(join(base, "parent"), parentMode);
  return new FsExportStore(join(base, "project"), join(base, "parent", "cache"));
}

Deno.test({
  name: "stage tightens a loose cache folder of the user's to 0700",
  ignore: !posix,
  fn: async () => {
    const base = await tempDir("private-");
    try {
      const store = await storeUnder(base, 0o755);
      await Deno.mkdir(join(base, "parent", "cache"), { mode: 0o755 });
      await Deno.chmod(join(base, "parent", "cache"), 0o755);
      await store.stage();
      assertEquals((await Deno.lstat(join(base, "parent", "cache"))).mode! & 0o777, 0o700);
      await store.remove();
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "stage refuses a parent others may write, and accepts it with the sticky bit",
  ignore: !posix,
  fn: async () => {
    const base = await tempDir("private-");
    try {
      const loose = await storeUnder(base, 0o777);
      await assertRejects(() => loose.stage(), ExportRefused, "has no sticky bit");
      await Deno.chmod(join(base, "parent"), 0o1777);
      await loose.stage();
      await loose.remove();
    } finally {
      await Deno.chmod(join(base, "parent"), 0o755);
      await Deno.remove(base, { recursive: true });
    }
  },
});
