import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { closeExport } from "../../src/application/untrusted_review_close.ts";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import { keptExport } from "../../src/infrastructure/fs_kept_export.ts";
import { GitTreeObjects } from "../../src/infrastructure/git_tree_objects.ts";
import { exportHead, withWorld, type World } from "../helpers/export_world.ts";
import { exists } from "../helpers/fs_exists.ts";
import { blob, commit, tree } from "../helpers/git_fixture.ts";

const posix = Deno.build.os !== "windows";
const SHA = "c".repeat(40);

/** A kept export of a commit holding `a` and `d/b`, as `review start` leaves it. */
async function kept(w: World) {
  const [a, b] = [await blob(w.repo, "alpha\n"), await blob(w.repo, "beta\n")];
  const d = await tree(w.repo, [["100644", "b", b]]);
  const head = await commit(w.repo, await tree(w.repo, [["100644", "a", a], ["40000", "d", d]]));
  const exported = await exportHead(w, head);
  exported.keep();
  return exported;
}

const closeDeps = (w: World) => ({
  kept: (sha: string) => keptExport(w.cache, sha),
  objects: (gitDir: string) => new GitTreeObjects(gitDir),
  windows: !posix,
});

const modeOf = async (path: string) => (await Deno.lstat(path)).mode! & 0o777;

Deno.test({
  name: "the reviewers' copy is read-only once checked: files 0444, folders 0555",
  ignore: !posix,
  fn: () =>
    withWorld(async (w) => {
      const e = await kept(w);
      const modes = await Promise.all(
        [join(e.seats, "a"), join(e.seats, "d", "b"), join(e.seats, "d"), e.seats].map(modeOf),
      );
      assertEquals(modes, [0o444, 0o444, 0o555, 0o555]);
      assertEquals(await closeExport(closeDeps(w), e.sha), { kind: "removed" });
    }),
});

Deno.test("closing an unchanged export re-checks it and removes it, read-only folders included", () =>
  withWorld(async (w) => {
    const e = await kept(w);
    assertEquals(await closeExport(closeDeps(w), e.sha), { kind: "removed" });
    assertEquals(await exists(e.root), false);
    assertEquals(await closeExport(closeDeps(w), e.sha), { kind: "none" });
  }));

Deno.test("closing an export whose seat file was edited refuses, and still removes it", () =>
  withWorld(async (w) => {
    const e = await kept(w);
    const file = join(e.seats, "d", "b");
    if (posix) await Deno.chmod(file, 0o644);
    await Deno.writeTextFile(file, "edited\n");
    const outcome = await closeExport(closeDeps(w), e.sha);
    assertEquals(outcome.kind, "changed");
    assertEquals(
      outcome.kind === "changed" && outcome.why.includes("differs from the commit"),
      true,
    );
    assertEquals(await exists(e.root), false);
  }));

Deno.test({
  name: "closing an export whose seat file was opened to writes refuses",
  ignore: !posix,
  fn: () =>
    withWorld(async (w) => {
      const e = await kept(w);
      await Deno.chmod(join(e.seats, "a"), 0o644);
      const outcome = await closeExport(closeDeps(w), e.sha);
      assertEquals(outcome.kind === "changed" && outcome.why.includes("not mode 0444"), true);
    }),
});

Deno.test({
  name: "a link at the kept export's name is refused, never followed",
  ignore: !posix,
  fn: () =>
    withWorld(async (w) => {
      await Deno.mkdir(w.cache, { recursive: true });
      await Deno.mkdir(join(w.cache, "elsewhere"));
      await Deno.symlink(join(w.cache, "elsewhere"), join(w.cache, SHA));
      await assertRejects(() => keptExport(w.cache, SHA), ExportRefused, "a link is not followed");
      assertEquals(await exists(join(w.cache, "elsewhere")), true);
    }),
});
