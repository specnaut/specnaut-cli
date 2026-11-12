import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import { FsExportStore } from "../../src/infrastructure/fs_tree_export.ts";
import { exists } from "../helpers/fs_exists.ts";
import { tempDir } from "../helpers/git_fixture.ts";

const posix = Deno.build.os !== "windows";

async function withStore(fn: (store: FsExportStore, cache: string) => Promise<void>) {
  const base = await tempDir("claim-");
  try {
    await Deno.mkdir(join(base, "project"));
    await fn(new FsExportStore(join(base, "project"), join(base, "cache")), join(base, "cache"));
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

Deno.test("a folder already at the commit's name is refused and left as it is", () =>
  withStore(async (store, cache) => {
    const staged = await store.stage();
    await Deno.mkdir(staged);
    const sha = "c".repeat(40);
    await Deno.mkdir(join(cache, sha, "seats"), { recursive: true });
    await Deno.writeTextFile(join(cache, sha, "seats", "live"), "x");
    await assertRejects(() => store.claim(sha, staged), ExportRefused, "already at");
    assertEquals(
      await exists(join(cache, sha, "seats", "live")),
      true,
      "another export was touched",
    );
    await store.remove();
  }));

Deno.test("claim refuses an id that is not a full commit id, before it names a path", () =>
  withStore(async (store) => {
    const staged = await store.stage();
    await assertRejects(() => store.claim("../x", staged), ExportRefused, "full commit id");
    await store.remove();
  }));

Deno.test({
  name: "remove tries every folder, then reports each one it could not remove",
  ignore: !posix,
  fn: () =>
    withStore(async (store) => {
      const locked: string[] = [];
      for (const staged of [await store.stage(), await store.stage()]) {
        await Deno.mkdir(join(staged, "inner"), { recursive: true });
        await Deno.writeTextFile(join(staged, "inner", "f"), "x");
        await Deno.chmod(join(staged, "inner"), 0o500);
        locked.push(join(staged, "inner"));
      }
      try {
        const err = await assertRejects(() => store.remove(), AggregateError);
        assertEquals(err.errors.length, 2);
      } finally {
        for (const dir of locked) await Deno.chmod(dir, 0o700);
      }
    }),
});
