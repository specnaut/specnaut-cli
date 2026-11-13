import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { readSameEntry, sameEntry } from "../../src/infrastructure/fs_staged_read.ts";
import { ContainmentRefusal } from "../../src/infrastructure/fs_refusals.ts";

/**
 * A staged copy is read through the one handle that was checked to be the entry `lstat` saw
 * (cli#776, cli#785): replaced between the check and the read, it is refused, never read.
 */

async function withStagedFile(fn: (dir: string, full: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "staged-read-785-" });
  try {
    const full = join(dir, "dev.md");
    await Deno.writeTextFile(full, "STAGED\n");
    await fn(dir, full);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a staged file read as it was checked gives its text", async () => {
  await withStagedFile(async (dir, full) => {
    assertEquals(await readSameEntry(dir, full, await Deno.lstat(full)), "STAGED\n");
  });
});

Deno.test("a staged file replaced between the check and the read is refused, not read", async () => {
  await withStagedFile(async (dir, full) => {
    const seen = await Deno.lstat(full);
    // Same size, same text length: only the entry's identity tells the two apart.
    const other = join(dir, "other.md");
    await Deno.writeTextFile(other, "OTHER!\n");
    await Deno.rename(other, full);
    await assertRejects(
      () => readSameEntry(dir, full, seen),
      ContainmentRefusal,
      "changed between its check and its read",
    );
  });
});

/** Where a platform reports no inode: `lstat`'s view and the handle's, both with `ino: null`. */
async function noInode(change: Partial<Deno.FileInfo> = {}) {
  let infos: [Deno.FileInfo, Deno.FileInfo] | undefined;
  await withStagedFile(async (_dir, full) => {
    const info = await Deno.lstat(full);
    infos = [{ ...info, ino: null }, { ...info, ino: null, ...change }];
  });
  return infos!;
}

Deno.test("with no inode, a replacement that changes the size or the mtime is caught", async () => {
  assertEquals(sameEntry(...await noInode({ size: 99 })), false);
  assertEquals(sameEntry(...await noInode({ mtime: new Date(0) })), false);
  assertEquals(sameEntry(...await noInode({ ino: 7 })), false);
});

Deno.test("with no inode, the stated limit: a replacement keeping size and mtime passes", async () => {
  // Pinned on purpose (cli#785): the limit is documented, not detected. A change here is a
  // decision to detect it, and the refusal's documentation must say so.
  assertEquals(sameEntry(...await noInode()), true);
  assertEquals(sameEntry(...await noInode({ isFile: false })), false);
});
