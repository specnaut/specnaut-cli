import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import type { Bundle } from "../../src/domain/template.ts";

const sampleBundle: Bundle = {
  ".claude/commands/hello.md": { content: "# Hello\n", executable: false },
  ".specify/scripts/hello.sh": { content: "#!/bin/sh\necho hi\n", executable: true },
  "tasks/backlog.md": { content: "# Backlog\n", executable: false },
};

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-fs-test-" });
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

Deno.test("writeBundle with backupExisting renames existing file to .specnaut.bak", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".claude/commands"), { recursive: true });
    const destRel = ".claude/commands/hello.md";
    await Deno.writeTextFile(join(dir, destRel), "OLD CONTENT");

    const writer = new DenoFsWriter();
    const report = await writer.writeBundle(
      { [destRel]: { content: "NEW CONTENT\n", executable: false } },
      dir,
      { overwrite: true, backupExisting: true },
    );

    const newContent = await Deno.readTextFile(join(dir, destRel));
    const bakContent = await Deno.readTextFile(join(dir, `${destRel}.specnaut.bak`));
    assertEquals(newContent.trim(), "NEW CONTENT");
    assertEquals(bakContent, "OLD CONTENT");

    assertEquals(report.backups.length, 1);
    assertEquals(report.backups[0].dest, destRel);
    assertEquals(report.backups[0].backupPath, `${destRel}.specnaut.bak`);
  });
});

Deno.test("writeBundle with backupExisting overwrites a pre-existing .specnaut.bak", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    const destRel = ".claude/x.md";
    await Deno.writeTextFile(join(dir, destRel), "CURRENT");
    await Deno.writeTextFile(join(dir, `${destRel}.specnaut.bak`), "ANCIENT");

    const writer = new DenoFsWriter();
    await writer.writeBundle(
      { [destRel]: { content: "NEWEST\n", executable: false } },
      dir,
      { overwrite: true, backupExisting: true },
    );

    const bakContent = await Deno.readTextFile(join(dir, `${destRel}.specnaut.bak`));
    assertEquals(bakContent, "CURRENT");
  });
});

Deno.test("writeBundle without backupExisting does not create .bak files", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    const destRel = ".claude/x.md";
    await Deno.writeTextFile(join(dir, destRel), "OLD");

    const writer = new DenoFsWriter();
    const report = await writer.writeBundle(
      { [destRel]: { content: "NEW\n", executable: false } },
      dir,
      { overwrite: true },
    );

    assertEquals(report.backups.length, 0);
    let bakExists = true;
    try {
      await Deno.stat(join(dir, `${destRel}.specnaut.bak`));
    } catch {
      bakExists = false;
    }
    assertEquals(bakExists, false);
  });
});

Deno.test("writeBundle returns empty backups for fresh installs", async () => {
  await withTempDir(async (dir) => {
    const writer = new DenoFsWriter();
    const report = await writer.writeBundle(
      { ".claude/x.md": { content: "fresh", executable: false } },
      dir,
      { backupExisting: true },
    );
    assertEquals(report.backups.length, 0);
  });
});

Deno.test("DenoFsWriter.deletePaths deletes specified files; missing files silently skipped", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-fswriter-delete-" });
  try {
    await Deno.mkdir(join(dir, "sub"), { recursive: true });
    await Deno.writeTextFile(join(dir, "a.md"), "a");
    await Deno.writeTextFile(join(dir, "sub/b.md"), "b");

    const writer = new DenoFsWriter();
    const report = await writer.deletePaths(
      ["a.md", "sub/b.md", "missing.md"],
      dir,
      { backupExisting: false },
    );

    assertEquals(report.backups.length, 0);
    assertEquals(await exists(join(dir, "a.md")), false);
    assertEquals(await exists(join(dir, "sub/b.md")), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DenoFsWriter.deletePaths with backupExisting renames to .specnaut.bak before delete", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-fswriter-delete-bak-" });
  try {
    await Deno.writeTextFile(join(dir, "a.md"), "alpha");

    const writer = new DenoFsWriter();
    const report = await writer.deletePaths(
      ["a.md"],
      dir,
      { backupExisting: true },
    );

    assertEquals(report.backups.length, 1);
    assertEquals(report.backups[0].dest, "a.md");
    assertEquals(report.backups[0].backupPath, "a.md.specnaut.bak");
    assertEquals(await exists(join(dir, "a.md")), false);
    assertEquals(await exists(join(dir, "a.md.specnaut.bak")), true);
    const bakContent = await Deno.readTextFile(join(dir, "a.md.specnaut.bak"));
    assertEquals(bakContent, "alpha");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
