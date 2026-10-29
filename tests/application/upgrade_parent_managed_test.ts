import { assert, assertEquals } from "@std/assert";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import {
  coreFromBundle,
  fakeLockStore,
  fakeReader,
  fakeStagingStore,
  fakeWriter,
  findFakeHarness,
} from "./upgrade_fakes.ts";

// Parent-managed upgrade suppression (009-parent-managed-init), extracted from
// upgrade_project_test.ts when that file was over its size ceiling (spec 038).

Deno.test("UpgradeProjectUseCase: lock.parentManaged=true filters agentic dests from the plan and writes", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "0.7.0",
    entries: new Map(), // parent-managed lock never had agentic entries (FR-012)
    parentManaged: true,
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    stagingStore: fakeStagingStore(),
    reader: fakeReader({}), // no .claude/ on disk — it was deliberately removed
    writer,
    lockStore,
    core: coreFromBundle({
      ".specnaut/memory/size-limits.md": { content: "toolkit\n", executable: false },
      ".claude/skills/specnaut/SKILL.md": { content: "skill\n", executable: false },
      ".claude/agents/developer.md": { content: "agent\n", executable: false },
      ".claude/commands/specnaut.md": { content: "cmd\n", executable: false },
    }),
    templatesVersion: "0.8.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  if (result.status === "applied") {
    // No agentic dest appears anywhere in the plan.
    for (const action of result.plan) {
      assert(
        !action.dest.startsWith(".claude/skills/") &&
          !action.dest.startsWith(".claude/agents/") &&
          !action.dest.startsWith(".claude/commands/"),
        `agentic dest leaked into plan: ${action.dest}`,
      );
    }
  }
  // Toolkit file added; agentic files never written / resurrected.
  assertEquals(writer.written.get(".specnaut/memory/size-limits.md"), "toolkit\n");
  assertEquals(writer.written.has(".claude/skills/specnaut/SKILL.md"), false);
  assertEquals(writer.written.has(".claude/agents/developer.md"), false);
  assertEquals(writer.written.has(".claude/commands/specnaut.md"), false);
  // Lock keeps parentManaged and no agentic entries (FR-012).
  assertEquals(lockStore.last?.parentManaged, true);
  assertEquals(lockStore.last?.entries.has(".claude/skills/specnaut/SKILL.md"), false);
});

Deno.test("UpgradeProjectUseCase: parentManagedOverride re-derives + persists on a legacy lock without the field", async () => {
  // Legacy lock — no parent_managed field — but the handler re-derived
  // parent-managed=true and passes it as an override.
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "0.7.0",
    entries: new Map(),
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    stagingStore: fakeStagingStore(),
    reader: fakeReader({}),
    writer,
    lockStore,
    core: coreFromBundle({
      ".specnaut/memory/size-limits.md": { content: "toolkit\n", executable: false },
      ".claude/agents/developer.md": { content: "agent\n", executable: false },
    }),
    templatesVersion: "0.8.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({
    projectDir: "/p",
    dryRun: false,
    force: false,
    parentManagedOverride: true,
  });
  assertEquals(result.status, "applied");
  assertEquals(writer.written.has(".claude/agents/developer.md"), false);
  assertEquals(writer.written.get(".specnaut/memory/size-limits.md"), "toolkit\n");
  // The re-derived decision is persisted into the rewritten lock.
  assertEquals(lockStore.last?.parentManaged, true);
});

Deno.test("UpgradeProjectUseCase: legacy lock + parentManagedOverride persists parent_managed even when up-to-date", async () => {
  // Up-to-date case: disk + lock + bundle all match (no file work). A legacy
  // lock (no parent_managed field) plus a handler-derived override of `true`
  // must still rewrite the lock with the corrected field — otherwise the
  // decision never reaches disk until an unrelated file change occurs
  // (009-parent-managed-init / FR-007).
  const content = "toolkit\n";
  const sha = await sha256Hex(content);
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "0.8.0",
    // Only a non-agentic toolkit entry; agentic dests are suppressed by the
    // override so they never enter the plan.
    entries: new Map([[".specnaut/memory/size-limits.md", {
      sha256: sha,
      installedAt: "2026-05-01T00:00:00Z",
      templatesVersion: "0.8.0",
    }]]),
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    stagingStore: fakeStagingStore(),
    reader: fakeReader({ ".specnaut/memory/size-limits.md": content }),
    writer,
    lockStore,
    core: coreFromBundle({
      ".specnaut/memory/size-limits.md": { content, executable: false },
      ".claude/agents/developer.md": { content: "agent\n", executable: false },
    }),
    templatesVersion: "0.8.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({
    projectDir: "/p",
    dryRun: false,
    force: false,
    parentManagedOverride: true,
  });
  // No file work (the only non-suppressed file is unchanged).
  assertEquals(result.status, "up-to-date");
  // But the lock was still rewritten with the corrected field.
  assertEquals(lockStore.last?.parentManaged, true);
  // Metadata-only: no files written.
  assertEquals(writer.written.size, 0);
});
