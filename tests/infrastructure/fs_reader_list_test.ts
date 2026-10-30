import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { WINDOWS } from "../helpers/link_text.ts";

/** `listFiles` lists the files under a folder; a link only when it lands on a file inside the project. */

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

Deno.test(
  "listFiles: a link to a file inside the project is listed; no other link, and no linked folder is entered",
  {
    ignore: WINDOWS,
  },
  async () => {
    await withProject(async (dir) => {
      const outside = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(join(outside, "y.md"), "y\n");
        await Deno.mkdir(join(dir, "elsewhere"));
        await Deno.writeTextFile(join(dir, "elsewhere/x.md"), "x\n");
        await Deno.mkdir(join(dir, ".claude/agents"), { recursive: true });
        await Deno.writeTextFile(join(dir, ".claude/agents/mine.md"), "m\n");
        await Deno.symlink("../../elsewhere/x.md", join(dir, ".claude/agents/linked.md"));
        await Deno.symlink(join(outside, "y.md"), join(dir, ".claude/agents/out.md"));
        await Deno.symlink("../../elsewhere", join(dir, ".claude/agents/dir"));
        assertEquals(await new DenoFsReader().listFiles(dir, ".claude/agents"), [
          ".claude/agents/linked.md",
          ".claude/agents/mine.md",
        ]);
      } finally {
        await Deno.remove(outside, { recursive: true });
      }
    });
  },
);
