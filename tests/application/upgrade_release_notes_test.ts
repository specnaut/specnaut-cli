import { assertEquals } from "@std/assert";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import { upgradeReleaseNotes } from "../../src/application/upgrade_release_notes.ts";
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

/**
 * The crossed range (cli#759, FR-001): from the version the lock recorded
 * before this run to the binary's own. Decided once, the same way, whichever
 * way the run finished — the up-to-date branch is the one that used to drop
 * the starting version, on a crossing that moved only the version (S4).
 */

const BINARY = {
  templatesVersion: "4.0.1",
  history: [
    { version: "4.0.0", content: "**Four.**\n" },
    { version: "4.0.1", content: "**Four point one.**\n" },
  ],
};

async function upgradeFrom4_0_0(disk: string, bundle: string) {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "4.0.0",
    entries: new Map([["a.md", {
      sha256: await sha256Hex(disk),
      installedAt: "2026-04-25T00:00:00Z",
      templatesVersion: "4.0.0",
    }]]),
  };
  const uc = new UpgradeProjectUseCase({
    stagingStore: fakeStagingStore(),
    reader: fakeReader({ "a.md": disk }),
    writer: fakeWriter(),
    lockStore: fakeLockStore(lock),
    core: coreFromBundle({ "a.md": { content: bundle, executable: false } }),
    findHarness: findFakeHarness,
    templatesVersion: BINARY.templatesVersion,
  });
  return await uc.execute({ projectDir: "/p", dryRun: false, force: false });
}

const crossed = (notes: ReturnType<typeof upgradeReleaseNotes>) =>
  notes.kind === "crossed" ? notes.releases.map((r) => r.version) : notes.kind;

Deno.test("a crossing that moved only the version still shows its release (S4)", async () => {
  const result = await upgradeFrom4_0_0("same", "same");
  assertEquals(result.status, "up-to-date");
  if (result.status === "planned") return;
  assertEquals(result.fromVersion, "4.0.0");
  assertEquals(crossed(upgradeReleaseNotes(result, BINARY)), ["4.0.1"]);
});

Deno.test("an applied upgrade crosses the same range", async () => {
  const result = await upgradeFrom4_0_0("old", "new");
  assertEquals(result.status, "applied");
  if (result.status === "planned") return;
  assertEquals(crossed(upgradeReleaseNotes(result, BINARY)), ["4.0.1"]);
});

Deno.test("no version change shows nothing (S2)", () => {
  assertEquals(upgradeReleaseNotes({ fromVersion: "4.0.1" }, BINARY), { kind: "no-change" });
});
