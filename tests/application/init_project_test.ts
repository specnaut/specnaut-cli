import { assert, assertEquals } from "@std/assert";
import { InitProjectUseCase } from "../../src/application/init_project.ts";
import type { FsWriter, GitAdapter, Harness, LockStore } from "../../src/application/ports.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import type { CoreBundle } from "../../src/domain/core_bundle.ts";

function fakeLockStore(
  opts: { existing?: InstalledLock | null } = {},
): LockStore & { lastWritten: InstalledLock | null } {
  const state: { lastWritten: InstalledLock | null } = { lastWritten: null };
  return {
    get lastWritten() {
      return state.lastWritten;
    },
    read: () => Promise.resolve(opts.existing ?? null),
    write: (_d, lock) => {
      state.lastWritten = lock;
      return Promise.resolve();
    },
    lockPath: (d) => `${d}/.specflow/installed.lock`,
  };
}

function fakeFsWriter(conflicts: string[] = []): FsWriter & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    detectConflicts: () => Promise.resolve(conflicts),
    writeBundle: (bundle, targetDir) => {
      for (const dest of Object.keys(bundle)) written.push(`${targetDir}:${dest}`);
      return Promise.resolve({ backups: [], skippedSkipIfExists: [] });
    },
    deletePaths: () => Promise.resolve({ backups: [], skippedSkipIfExists: [] }),
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
    getRemoteUrl: () => Promise.resolve(null),
  };
}

function fakeClaudeHarness(): Harness {
  return {
    key: "claude",
    displayName: "Claude Code (fake)",
    mapBundle: (core) => {
      const out: Record<string, { content: string; executable: boolean }> = {};
      for (const e of core) {
        if (e.category === "project-root" && e.suffix) {
          out[e.suffix] = { content: e.content, executable: e.executable };
        }
      }
      return out;
    },
  };
}

// A core bundle whose mapped dests mix agentic (.claude/skills|agents|commands)
// and non-agentic (.specflow, AGENTS.md, .claude/settings.json) paths.
const MIXED_CORE: CoreBundle = [
  ".specflow/memory/constitution.md",
  "AGENTS.md",
  ".claude/settings.json",
  ".claude/skills/specnaut/SKILL.md",
  ".claude/agents/developer.md",
  ".claude/commands/specnaut.md",
].map((dest) => ({
  category: "project-root" as const,
  name: "root",
  suffix: dest,
  content: `# ${dest}\n`,
  executable: false,
})) as CoreBundle;

const SAMPLE_CORE: CoreBundle = [
  {
    category: "project-root",
    name: "root",
    suffix: "CLAUDE.md",
    content: "# hi\n",
    executable: false,
  },
];

Deno.test("InitProjectUseCase writes the bundle to the target dir (happy path)", async () => {
  const writer = fakeFsWriter();
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: true,
    force: false,
    dryRun: false,
  });
  assertEquals(result.status, "initialized");
  if (result.status === "initialized") {
    assertEquals(result.filesWritten, 1);
  }
  assertEquals(writer.written, ["/tmp/demo:CLAUDE.md"]);
});

Deno.test("InitProjectUseCase fails with 'conflicts' when target already has specnaut files", async () => {
  const writer = fakeFsWriter(["CLAUDE.md"]);
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: true,
    force: false,
    dryRun: false,
  });
  assertEquals(result.status, "conflicts");
  if (result.status === "conflicts") {
    assertEquals(result.conflicts, ["CLAUDE.md"]);
    assertEquals(result.lockExists, false);
  }
});

Deno.test("InitProjectUseCase reports lockExists=true when conflicts hit a previously-initialised project", async () => {
  const writer = fakeFsWriter(["CLAUDE.md"]);
  const existingLock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    templatesVersion: "0.0.0",
    entries: new Map(),
  };
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore({ existing: existingLock }),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: true,
    force: false,
    dryRun: false,
  });
  assertEquals(result.status, "conflicts");
  if (result.status === "conflicts") {
    assertEquals(result.lockExists, true);
  }
});

Deno.test("InitProjectUseCase calls git.init when repo not initialized and initGit=true", async () => {
  const initCalled = { value: false };
  const useCase = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit({ available: true, initialized: false, initCalled }),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await useCase.execute({ targetDir: "/tmp/demo", initGit: true, force: false, dryRun: false });
  assert(initCalled.value, "git.init should have been called");
});

Deno.test("InitProjectUseCase skips git.init when initGit=false", async () => {
  const initCalled = { value: false };
  const useCase = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit({ available: true, initialized: false, initCalled }),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await useCase.execute({ targetDir: "/tmp/demo", initGit: false, force: false, dryRun: false });
  assertEquals(initCalled.value, false);
});

Deno.test("InitProjectUseCase skips git.init when git not available", async () => {
  const initCalled = { value: false };
  const useCase = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit({ available: false, initCalled }),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: true,
    force: false,
    dryRun: false,
  });
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
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await useCase.execute({ targetDir: "/tmp/demo", initGit: true, force: false, dryRun: false });
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
      return Promise.resolve({ backups: [], skippedSkipIfExists: [] });
    },
    deletePaths: () => Promise.resolve({ backups: [], skippedSkipIfExists: [] }),
  };
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: false,
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
        skippedSkipIfExists: [],
      }),
    deletePaths: () => Promise.resolve({ backups: [], skippedSkipIfExists: [] }),
  };
  const useCase = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await useCase.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: false,
  });
  if (result.status === "initialized") {
    assertEquals(result.backups, [".claude/x.md"]);
  }
});

Deno.test("InitProjectUseCase persists an installed.lock with SHA256 of every file", async () => {
  const lockStore = fakeLockStore();
  const uc = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit(),
    lockStore,
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: [
      {
        category: "project-root",
        name: "root",
        suffix: "a.md",
        content: "alpha",
        executable: false,
      },
      {
        category: "project-root",
        name: "root",
        suffix: "b.md",
        content: "beta",
        executable: false,
      },
    ] as CoreBundle,
    ensureDir: () => Promise.resolve(),
    now: () => new Date("2026-04-25T10:00:00Z"),
  });
  await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: false,
    dryRun: false,
  });
  const written = lockStore.lastWritten;
  assert(written !== null, "lock not written");
  assertEquals(written!.entries.size, 2);
  const aEntry = written!.entries.get("a.md");
  assert(aEntry !== undefined);
  assertEquals(aEntry!.installedAt, "2026-04-25T10:00:00.000Z");
  assertEquals(aEntry!.sha256.length, 64);
});

Deno.test("InitProjectUseCase records harness.key in the installed lock", async () => {
  const lockStore = fakeLockStore();
  const uc = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit(),
    lockStore,
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await uc.execute({ targetDir: "/tmp/demo", initGit: false, force: false, dryRun: false });
  assertEquals(lockStore.lastWritten?.harness, "claude");
});

Deno.test("InitProjectUseCase suppresses agentic dests from writes AND lock when parentManaged=true", async () => {
  const writer = fakeFsWriter();
  const lockStore = fakeLockStore();
  const uc = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore,
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: MIXED_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: false,
    dryRun: false,
    parentManaged: true,
  });

  const writtenDests = writer.written.map((w) => w.replace("/tmp/demo:", ""));
  // Agentic dests are filtered out of the written set.
  assert(!writtenDests.includes(".claude/skills/specnaut/SKILL.md"));
  assert(!writtenDests.includes(".claude/agents/developer.md"));
  assert(!writtenDests.includes(".claude/commands/specnaut.md"));
  // Non-agentic dests still provisioned.
  assert(writtenDests.includes(".specflow/memory/constitution.md"));
  assert(writtenDests.includes("AGENTS.md"));
  assert(writtenDests.includes(".claude/settings.json"));

  // FR-012: the lock excludes agentic entries and records parentManaged.
  const lock = lockStore.lastWritten!;
  assert(!lock.entries.has(".claude/skills/specnaut/SKILL.md"));
  assert(!lock.entries.has(".claude/agents/developer.md"));
  assert(!lock.entries.has(".claude/commands/specnaut.md"));
  assert(lock.entries.has(".specflow/memory/constitution.md"));
  assert(lock.entries.has("AGENTS.md"));
  assertEquals(lock.parentManaged, true);
});

Deno.test("InitProjectUseCase writes all dests and sets no parentManaged when not parent-managed", async () => {
  const writer = fakeFsWriter();
  const lockStore = fakeLockStore();
  const uc = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore,
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: MIXED_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: false,
    dryRun: false,
    parentManaged: false,
  });

  const writtenDests = writer.written.map((w) => w.replace("/tmp/demo:", ""));
  assert(writtenDests.includes(".claude/skills/specnaut/SKILL.md"));
  assert(writtenDests.includes(".claude/agents/developer.md"));
  assert(writtenDests.includes(".claude/commands/specnaut.md"));

  const lock = lockStore.lastWritten!;
  assert(lock.entries.has(".claude/skills/specnaut/SKILL.md"));
  assertEquals(lock.parentManaged, undefined);
});

Deno.test("InitProjectUseCase uses harness.mapBundle output as the file tree", async () => {
  const writer = fakeFsWriter();
  const uc = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await uc.execute({ targetDir: "/tmp/demo", initGit: false, force: false, dryRun: false });
  // The fake harness maps project-root suffix → flat dest.
  assert(writer.written.includes("/tmp/demo:CLAUDE.md"));
});

// ---------------------------------------------------------------------------
// 011-preserve-customisations: preservedPaths filter (issue #367)
// ---------------------------------------------------------------------------

const PRESERVE_CORE: CoreBundle = [
  ".claude/agents/product-owner.md",
  ".claude/agents/developer.md",
  "AGENTS.md",
].map((dest) => ({
  category: "project-root" as const,
  name: "root",
  suffix: dest,
  content: `# ${dest}\n`,
  executable: false,
})) as CoreBundle;

Deno.test("InitProjectUseCase: preservedPaths are absent from the write set and reported", async () => {
  const writer = fakeFsWriter();
  const uc = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: PRESERVE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: false,
    preservedPaths: new Set([".claude/agents/product-owner.md"]),
  });
  // The preserved path is NOT written.
  assertEquals(writer.written.includes("/tmp/demo:.claude/agents/product-owner.md"), false);
  // Other managed files ARE written.
  assert(writer.written.includes("/tmp/demo:.claude/agents/developer.md"));
  assert(writer.written.includes("/tmp/demo:AGENTS.md"));
  // The result reports the preserved path.
  assertEquals(result.status, "initialized");
  if (result.status === "initialized") {
    assertEquals(result.preserved, [".claude/agents/product-owner.md"]);
  }
});

// MED-1: filesWritten must reflect the post-preserve-filter write set, NOT
// the full bundle — otherwise a refresh reports writing files it skipped.
Deno.test("InitProjectUseCase: filesWritten excludes preserved paths", async () => {
  const uc = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: PRESERVE_CORE, // 3 non-mergeable files
    ensureDir: () => Promise.resolve(),
  });
  const result = await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: false,
    preservedPaths: new Set([".claude/agents/product-owner.md"]),
  });
  assertEquals(result.status, "initialized");
  if (result.status === "initialized") {
    // 3 files in the bundle, 1 preserved ⇒ exactly 2 actually written.
    assertEquals(result.filesWritten, 2);
    assertEquals(result.preserved, [".claude/agents/product-owner.md"]);
  }
});

// MED-1 (dry-run): the previewed "would write N" count must also exclude
// preserved paths, and the dry-run result must report them as preserved.
Deno.test("InitProjectUseCase: dry-run filesWritten excludes preserved paths", async () => {
  const uc = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: PRESERVE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: true,
    preservedPaths: new Set([".claude/agents/product-owner.md"]),
  });
  assertEquals(result.status, "initialized");
  if (result.status === "initialized") {
    assertEquals(result.filesWritten, 2);
    assertEquals(result.preserved, [".claude/agents/product-owner.md"]);
  }
});

// F1 (HARD): a preserved file must stay lock-tracked (FR-012) so diff and
// future upgrades still see it — skipping the WRITE must NOT drop the lock entry.
Deno.test("InitProjectUseCase: preserved file remains in the installed.lock (FR-012)", async () => {
  const lockStore = fakeLockStore();
  const uc = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit(),
    lockStore,
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: PRESERVE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: false,
    preservedPaths: new Set([".claude/agents/product-owner.md"]),
  });
  const lock = lockStore.lastWritten!;
  assert(lock.entries.has(".claude/agents/product-owner.md"));
  assert(lock.entries.has(".claude/agents/developer.md"));
});

// F2: a brand-new bundle path is still written even when preserves are set —
// the preserve list governs existing files only (FR-010).
Deno.test("InitProjectUseCase: new bundle path still written when preserves are set (FR-010)", async () => {
  const writer = fakeFsWriter();
  const uc = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: PRESERVE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: false,
    // a path NOT in the bundle is inert; the real bundle path is written.
    preservedPaths: new Set([".claude/agents/product-owner.md"]),
  });
  assert(writer.written.includes("/tmp/demo:AGENTS.md"));
  assert(writer.written.includes("/tmp/demo:.claude/agents/developer.md"));
});

// T019 / D8 (C7): a declared agentic path in a parent-managed sub-repo is a
// clean no-op. Agentic dests are filtered out of the bundle BEFORE the preserve
// filter runs, so the predicate is never consulted for them — the path is
// neither written nor reported as preserved (it was never a bundle dest here).
Deno.test("InitProjectUseCase: declared agentic path in a parent-managed sub-repo is a no-op (D8)", async () => {
  const writer = fakeFsWriter();
  const lockStore = fakeLockStore();
  const uc = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore,
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: MIXED_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const agenticDest = ".claude/agents/developer.md";
  const result = await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: false,
    parentManaged: true,
    // Declare an agentic path preserved — in a parent-managed run it is already
    // filtered from the bundle, so this declaration is inert.
    preservedPaths: new Set([agenticDest]),
  });
  const writtenDests = writer.written.map((w) => w.replace("/tmp/demo:", ""));
  // The agentic path is absent from writes (suppressed by parent-managed).
  assertEquals(writtenDests.includes(agenticDest), false);
  // It is NOT reported as preserved — it was never a bundle dest for this run.
  assertEquals(result.status, "initialized");
  if (result.status === "initialized") {
    assertEquals(result.preserved.includes(agenticDest), false);
  }
  // Non-agentic dests are still provisioned (the run is otherwise normal).
  assert(writtenDests.includes("AGENTS.md"));
});

// Absent / empty preservedPaths ⇒ today's behaviour: full bundle written,
// empty preserved report.
Deno.test("InitProjectUseCase: absent preservedPaths writes the full bundle (FR-011)", async () => {
  const writer = fakeFsWriter();
  const uc = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    backlogBackend: "local",
    versionScheme: "semver",
    core: PRESERVE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  const result = await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: true,
    dryRun: false,
  });
  assert(writer.written.includes("/tmp/demo:.claude/agents/product-owner.md"));
  if (result.status === "initialized") {
    assertEquals(result.preserved, []);
  }
});
