import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { WINDOWS } from "../helpers/link_text.ts";

/** `listFiles` lists the regular files under a folder, and nothing it would have to follow. */

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("listFiles: an absent folder, or a file, lists nothing", async () => {
  await withProject(async (dir) => {
    const r = new DenoFsReader();
    assertEquals(await r.listFiles(dir, ".specnaut/addenda"), []);
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# A\n");
    assertEquals(await r.listFiles(dir, "AGENTS.md"), []);
  });
});

Deno.test("listFiles: every depth, sorted, project-relative with forward slashes", async () => {
  await withProject(async (dir) => {
    await Deno.mkdir(join(dir, ".specnaut/addenda/task"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut/addenda/task/review.md"), "r\n");
    await Deno.writeTextFile(join(dir, ".specnaut/addenda/task/plan.md"), "p\n");
    await Deno.writeTextFile(join(dir, ".specnaut/addenda/a.md"), "a\n");
    assertEquals(await new DenoFsReader().listFiles(dir, ".specnaut/addenda"), [
      ".specnaut/addenda/a.md",
      ".specnaut/addenda/task/plan.md",
      ".specnaut/addenda/task/review.md",
    ]);
  });
});

Deno.test("listFiles: a link is neither listed nor descended into", {
  ignore: WINDOWS,
}, async () => {
  await withProject(async (dir) => {
    await Deno.mkdir(join(dir, "elsewhere"));
    await Deno.writeTextFile(join(dir, "elsewhere/x.md"), "x\n");
    await Deno.mkdir(join(dir, ".claude/agents"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".claude/agents/mine.md"), "m\n");
    await Deno.symlink("../../elsewhere/x.md", join(dir, ".claude/agents/linked.md"));
    await Deno.symlink("../../elsewhere", join(dir, ".claude/agents/dir"));
    assertEquals(await new DenoFsReader().listFiles(dir, ".claude/agents"), [
      ".claude/agents/mine.md",
    ]);
  });
});
