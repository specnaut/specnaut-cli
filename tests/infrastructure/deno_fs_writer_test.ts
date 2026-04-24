import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import type { Bundle } from "../../src/domain/template.ts";

const sampleBundle: Bundle = {
  ".claude/commands/hello.md": { content: "# Hello\n", executable: false },
  ".specify/scripts/hello.sh": { content: "#!/bin/sh\necho hi\n", executable: true },
  "tasks/backlog.md": { content: "# Backlog\n", executable: false },
};

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-fs-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("DenoFsWriter.writeBundle writes every file under the target dir", async () => {
  await withTempDir(async (dir) => {
    const writer = new DenoFsWriter();
    await writer.writeBundle(sampleBundle, dir, {});
    const hello = await Deno.readTextFile(join(dir, ".claude/commands/hello.md"));
    const shell = await Deno.readTextFile(join(dir, ".specify/scripts/hello.sh"));
    const bl = await Deno.readTextFile(join(dir, "tasks/backlog.md"));
    assertEquals(hello, "# Hello\n");
    assertEquals(shell, "#!/bin/sh\necho hi\n");
    assertEquals(bl, "# Backlog\n");
  });
});

Deno.test("DenoFsWriter marks executable files as executable (POSIX only)", async () => {
  if (Deno.build.os === "windows") return;
  await withTempDir(async (dir) => {
    const writer = new DenoFsWriter();
    await writer.writeBundle(sampleBundle, dir, {});
    const stat = await Deno.stat(join(dir, ".specify/scripts/hello.sh"));
    const mode = stat.mode ?? 0;
    assertEquals((mode & 0o111) !== 0, true);
  });
});

Deno.test("DenoFsWriter.detectConflicts returns paths that already exist", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".claude/existing.md"), "hi");
    const writer = new DenoFsWriter();
    const conflicts = await writer.detectConflicts(
      { ".claude/existing.md": { content: "x", executable: false } },
      dir,
    );
    assertEquals(conflicts, [".claude/existing.md"]);
  });
});

Deno.test("DenoFsWriter.writeBundle throws if conflicts exist and overwrite=false", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".claude/commands"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".claude/commands/hello.md"), "existing");
    const writer = new DenoFsWriter();
    await assertRejects(
      () => writer.writeBundle(sampleBundle, dir, { overwrite: false }),
      Error,
      ".claude/commands/hello.md",
    );
  });
});

Deno.test("DenoFsWriter.writeBundle overwrites when overwrite=true", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".claude/commands"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".claude/commands/hello.md"), "old");
    const writer = new DenoFsWriter();
    await writer.writeBundle(sampleBundle, dir, { overwrite: true });
    const content = await Deno.readTextFile(join(dir, ".claude/commands/hello.md"));
    assertStringIncludes(content, "# Hello");
  });
});

Deno.test("DenoFsWriter.writeBundle rejects destinations that escape the target", async () => {
  await withTempDir(async (dir) => {
    const writer = new DenoFsWriter();
    await assertRejects(
      () =>
        writer.writeBundle(
          { "../escape.md": { content: "x", executable: false } },
          dir,
          {},
        ),
      Error,
      "escape",
    );
  });
});
