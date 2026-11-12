import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { BranchExport } from "../../src/application/untrusted_review.ts";
import { exists } from "../helpers/fs_exists.ts";
import { blob, tree } from "../helpers/git_fixture.ts";
import { exportOf, withWorld, type World } from "../helpers/export_world.ts";

/** What lands in each copy of an export, and what is only listed. */

const mode = async (p: string) => (await Deno.lstat(p)).mode! & 0o777;
const posix = Deno.build.os !== "windows";

/** Any commit-shaped id: a submodule entry names a commit the tree does not hold. */
const SUBMODULE = "0123456789abcdef0123456789abcdef01234567";

type Ids = { text: string; script: string; note: string; head: string };

/** Exports plain files, a script, instruction files, a link and a submodule. */
async function mixed(w: World): Promise<{ out: BranchExport; ids: Ids }> {
  const [text, script, note] = await Promise.all(
    ["text\n", "#!/bin/sh\necho hi\n", "agent rules\n"].map((c) => blob(w.repo, c)),
  );
  const claudeDir = await tree(w.repo, [["100644", "settings.json", note]]);
  const src = await tree(w.repo, [["100644", "a.ts", text], ["100644", "AGENTS.md", note]]);
  const { head, run } = await exportOf(w, [
    ["100644", "README.md", text],
    ["100755", "run.sh", script],
    ["40000", "src", src],
    ["100644", "CLAUDE.md", note],
    ["40000", ".claude", claudeDir],
    ["120000", "link", text],
    ["160000", "vendor", SUBMODULE],
  ]);
  return { out: await run(), ids: { text, script, note, head } };
}

Deno.test("plain files are written to both copies, under the commit's folder", () =>
  withWorld(async (w) => {
    const { out, ids } = await mixed(w);
    assertEquals([out.sha, out.root], [ids.head, join(await Deno.realPath(w.cache), ids.head)]);
    for (const copy of [out.seats, out.scratch]) {
      assertEquals(await Deno.readTextFile(join(copy, "src", "a.ts")), "text\n");
      assertEquals(await Deno.readTextFile(join(copy, "run.sh")), "#!/bin/sh\necho hi\n");
    }
    await out.remove();
  }));

Deno.test({
  name: "the reviewers' copy runs nothing; the scratch copy keeps the executable bit",
  ignore: !posix,
  fn: () =>
    withWorld(async (w) => {
      const { out } = await mixed(w);
      assertEquals(await mode(join(out.seats, "run.sh")), 0o644);
      assertEquals(await mode(join(out.seats, "README.md")), 0o644);
      assertEquals(await mode(join(out.scratch, "run.sh")), 0o755);
      await out.remove();
    }),
});

Deno.test("instruction files, links and submodules are listed with their id, never written", () =>
  withWorld(async (w) => {
    const { out, ids } = await mixed(w);
    for (const copy of [out.seats, out.scratch]) {
      for (const absent of ["CLAUDE.md", ".claude", "link", "vendor", "src/AGENTS.md"]) {
        assertEquals(await exists(join(copy, absent)), false, `${absent} was materialised`);
      }
    }
    assertEquals(out.listed.map((l) => [l.path, l.kind, l.sha]), [
      ["CLAUDE.md", "instruction", ids.note],
      ["link", "link", ids.text],
      ["vendor", "submodule", SUBMODULE],
      ["src/AGENTS.md", "instruction", ids.note],
      [".claude/settings.json", "instruction", ids.note],
    ]);
    await out.remove();
  }));

Deno.test("remove deletes the whole export", () =>
  withWorld(async (w) => {
    const { out } = await mixed(w);
    await out.remove();
    assertEquals(await exists(out.root), false);
  }));
