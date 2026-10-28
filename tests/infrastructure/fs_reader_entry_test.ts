import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";

/** `readEntry` reports what is at a path itself — a link as a link (cli#680). */

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("readEntry: absent is null, a file is its content", async () => {
  await withProject(async (dir) => {
    const r = new DenoFsReader();
    assertEquals(await r.readEntry(dir, "AGENTS.md"), null);
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# A\n");
    assertEquals(await r.readEntry(dir, "AGENTS.md"), { kind: "file", content: "# A\n" });
  });
});

Deno.test("readEntry: a link is reported with its text and landing, not read through", async () => {
  await withProject(async (dir) => {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# A\n");
    await Deno.mkdir(join(dir, ".claude"));
    await Deno.symlink("../AGENTS.md", join(dir, ".claude/CLAUDE.md"));
    assertEquals(await new DenoFsReader().readEntry(dir, ".claude/CLAUDE.md"), {
      kind: "symlink",
      target: "../AGENTS.md",
      resolved: "AGENTS.md",
    });
  });
});

Deno.test("readEntry: a link out of the project is reported, never refused or read", async () => {
  // `readText` refuses this path; `upgrade` still has to know what is there to
  // decide to replace it.
  await withProject(async (dir) => {
    const outside = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(outside, "secret.md"), "secret\n");
      await Deno.mkdir(join(dir, ".claude"));
      await Deno.symlink(join(outside, "secret.md"), join(dir, ".claude/CLAUDE.md"));
      const entry = await new DenoFsReader().readEntry(dir, ".claude/CLAUDE.md");
      assertEquals(entry?.kind, "symlink");
      assertEquals(entry?.kind === "symlink" && entry.resolved?.startsWith(".."), true);
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("readEntry: a link cycle resolves to null instead of throwing", async () => {
  await withProject(async (dir) => {
    await Deno.symlink("b.md", join(dir, "a.md"));
    await Deno.symlink("a.md", join(dir, "b.md"));
    assertEquals(await new DenoFsReader().readEntry(dir, "a.md"), {
      kind: "symlink",
      target: "b.md",
      resolved: null,
    });
  });
});
