import { assertEquals } from "@std/assert";
import { bundleForLock, bundleOptionsOf } from "../../src/application/lock_bundle.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

const lock: InstalledLock = {
  version: 2,
  harness: "claude",
  backlogBackend: "github",
  versionScheme: "semver",
  specBackend: "local",
  templatesVersion: "1.0.0",
  entries: new Map(),
};

Deno.test("a lock's bundle is the harness's mapping through the lock's own options", () => {
  const bundle = bundleForLock(CORE_BUNDLE, lock, findHarness);
  assertEquals(bundle, findHarness("claude")!.mapBundle(CORE_BUNDLE, bundleOptionsOf(lock)));
  assertEquals(bundle?.[".specnaut/scripts/bash/git-read.sh"] !== undefined, true);
});

Deno.test("a lock naming no harness the binary knows maps to no bundle, never a throw", () => {
  assertEquals(bundleForLock(CORE_BUNDLE, lock, () => null), null);
});
