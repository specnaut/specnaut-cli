import { assertEquals } from "@std/assert";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import type { CoreBundle } from "../../src/domain/core_bundle.ts";
import {
  coreFromBundle,
  fakeLockStore,
  fakeReader,
  fakeStagingStore,
  fakeWriter,
  findFakeHarness,
} from "./upgrade_fakes.ts";

/**
 * The user-owned JSON files (`.claude/settings.json`, `.codex/hooks.json`) are
 * re-merged on EVERY upgrade that writes — the up-to-date path included — and
 * the result names the ones the merge changed (plan § 10 H3). A project already
 * on the current release reaches its next upgrade through the up-to-date path,
 * so a hook registration that moved would otherwise never reach it.
 */

const SETTINGS = ".claude/settings.json";

/** On disk and in the lock, `a.md` is "alpha"; the bundle ships `bundled`. */
async function setup(lockVersion: string, bundled: string) {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: lockVersion,
    entries: new Map([["a.md", {
      sha256: await sha256Hex("alpha"),
      installedAt: "2026-04-25T00:00:00Z",
      templatesVersion: lockVersion,
    }]]),
  };
  const settings = {
    category: "project-root",
    name: "root",
    suffix: SETTINGS,
    content: "{}",
    executable: false,
    mergeJson: "claude-settings",
  } as unknown as CoreBundle[number];
  const core: CoreBundle = [
    ...coreFromBundle({ "a.md": { content: bundled, executable: false } }),
    settings,
  ];
  const writer = fakeWriter();
  const uc = new UpgradeProjectUseCase({
    stagingStore: fakeStagingStore(),
    reader: fakeReader({ "a.md": "alpha" }),
    writer,
    lockStore: fakeLockStore(lock),
    core,
    findHarness: findFakeHarness,
    templatesVersion: "0.3.0",
  });
  return { uc, writer };
}

Deno.test("upgrade: the up-to-date path re-merges the JSON files and reports what changed", async () => {
  const { uc, writer } = await setup("0.3.0", "alpha");
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "up-to-date");
  assertEquals(writer.written.has(SETTINGS), true);
  if (result.status !== "up-to-date") return;
  assertEquals(result.mergedChanged, [SETTINGS]);
  // The plugin notes travel with the merge: a plugin enabled on this path is
  // said here as loudly as on the applied one.
  assertEquals(result.notes, [`${SETTINGS}: merged`]);
});

Deno.test("upgrade: a dry run on the up-to-date path merges nothing", async () => {
  const { uc, writer } = await setup("0.3.0", "alpha");
  const result = await uc.execute({ projectDir: "/p", dryRun: true, force: false });
  assertEquals(result.status, "up-to-date");
  assertEquals(writer.written.size, 0);
  if (result.status === "up-to-date") assertEquals(result.mergedChanged, []);
});

Deno.test("upgrade: the applied path reports the JSON files the merge changed", async () => {
  const { uc, writer } = await setup("0.2.0", "alpha-next");
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  assertEquals(writer.written.get("a.md"), "alpha-next");
  if (result.status !== "applied") return;
  assertEquals(result.mergedChanged, [SETTINGS]);
  assertEquals(result.notes, [`${SETTINGS}: merged`]);
});
