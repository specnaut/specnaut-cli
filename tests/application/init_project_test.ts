import { assert, assertEquals } from "@std/assert";
import { InitProjectUseCase } from "../../src/application/init_project.ts";
import type { FsWriter, GitAdapter } from "../../src/application/ports.ts";
import type { Bundle } from "../../src/domain/template.ts";

function fakeFsWriter(conflicts: string[] = []): FsWriter & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    detectConflicts: () => Promise.resolve(conflicts),
    writeBundle: (bundle, targetDir) => {
      for (const dest of Object.keys(bundle)) written.push(`${targetDir}:${dest}`);
      return Promise.resolve({ backups: [] });
    },
  };
}

function fakeGit(
  opts: { available?: boolean; initialized?: boolean; initCalled?: { value: boolean } } = {},
): GitAdapter {
  return {
    isAvailable: () => Promise.resolve(opts.available ?? true),
    isInitialized: () => Promise.resolve(opts.initialized ?? false),
    init: () => {
      if (opts.initCalled) opts.initCalled.value = true;
      return Promise.resolve();
    },
  };
}

const bundle: Bundle = {
  "CLAUDE.md": { content: "# hi\n", executable: false },
};

Deno.test("InitProjectUseCase writes the bundle to the target dir (happy path)", async () => {
  const writer = fakeFsWriter();
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    bundle,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: true,
    force: false,
  });
  assertEquals(result.status, "initialized");
  if (result.status === "initialized") {
    assertEquals(result.filesWritten, 1);
  }
  assertEquals(writer.written, ["/tmp/demo:CLAUDE.md"]);
});

Deno.test("InitProjectUseCase fails with 'conflicts' when target already has specflow files", async () => {
  const writer = fakeFsWriter(["CLAUDE.md"]);
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    bundle,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: true,
    force: false,
  });
  assertEquals(result.status, "conflicts");
  if (result.status === "conflicts") assertEquals(result.conflicts, ["CLAUDE.md"]);
});

Deno.test("InitProjectUseCase calls git.init when repo not initialized and initGit=true", async () => {
  const initCalled = { value: false };
  const useCase = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit({ available: true, initialized: false, initCalled }),
    bundle,
    ensureDir: () => Promise.resolve(),
  });
  await useCase.execute({ targetDir: "/tmp/demo", initGit: true, force: false });
  assert(initCalled.value, "git.init should have been called");
});

Deno.test("InitProjectUseCase skips git.init when initGit=false", async () => {
  const initCalled = { value: false };
  const useCase = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit({ available: true, initialized: false, initCalled }),
    bundle,
    ensureDir: () => Promise.resolve(),
  });
  await useCase.execute({ targetDir: "/tmp/demo", initGit: false, force: false });
  assertEquals(initCalled.value, false);
});

Deno.test("InitProjectUseCase skips git.init when git not available", async () => {
  const initCalled = { value: false };
  const useCase = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit({ available: false, initCalled }),
    bundle,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({ targetDir: "/tmp/demo", initGit: true, force: false });
  assertEquals(initCalled.value, false);
  assertEquals(result.status, "initialized");
  // Warning about missing git should be in warnings
  if (result.status === "initialized") {
    assert(result.warnings.some((w) => w.includes("git")));
  }
});

Deno.test("InitProjectUseCase skips git.init when repo already initialized", async () => {
  const initCalled = { value: false };
  const useCase = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit({ available: true, initialized: true, initCalled }),
    bundle,
    ensureDir: () => Promise.resolve(),
  });
  await useCase.execute({ targetDir: "/tmp/demo", initGit: true, force: false });
  assertEquals(initCalled.value, false);
});

Deno.test("InitProjectUseCase with force=true skips conflict detection and requests backup", async () => {
  let passedBackupExisting = false;
  const writer: FsWriter = {
    detectConflicts: () => {
      throw new Error("detectConflicts should NOT be called when force=true");
    },
    writeBundle: (_b, _t, options) => {
      passedBackupExisting = options?.backupExisting === true;
      return Promise.resolve({ backups: [] });
    },
  };
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    bundle,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
  });
  assertEquals(result.status, "initialized");
  assertEquals(passedBackupExisting, true);
});

Deno.test("InitProjectUseCase returns backups array from writer report", async () => {
  const writer: FsWriter = {
    detectConflicts: () => Promise.resolve([]),
    writeBundle: () =>
      Promise.resolve({
        backups: [
          { dest: ".claude/x.md", backupPath: ".claude/x.md.specflow.bak" },
        ],
      }),
  };
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    bundle,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
  });
  if (result.status === "initialized") {
    assertEquals(result.backups, [".claude/x.md"]);
  }
});
