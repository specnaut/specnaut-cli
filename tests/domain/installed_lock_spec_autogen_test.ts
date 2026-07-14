import { assertEquals } from "@std/assert";
import {
  type InstalledLock,
  type LockEntry,
  parseLock,
  serializeLock,
} from "../../src/domain/installed_lock.ts";

// Spec 021 / FR-005 — the `spec_autogen` lock field: the opt-in toggle that
// couples cloud-mode task creation with spec auto-generation. It round-trips
// through serialize/parse and defaults to `false` when absent (backward-
// compatible). Mirrors the `spec_backend` default-on-absent coverage, but is
// serialised only when enabled (like `parent_managed`) so a project that never
// turned it on keeps a byte-identical lock.

function lockWith(specAutogen: boolean | undefined): InstalledLock {
  return {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "cloud",
    ...(specAutogen === undefined ? {} : { specAutogen }),
    templatesVersion: "1.0.0",
    entries: new Map<string, LockEntry>([
      ["CLAUDE.md", {
        sha256: "aaa",
        installedAt: "2026-07-14T00:00:00Z",
        templatesVersion: "1.0.0",
      }],
    ]),
  };
}

Deno.test("serializeLock emits spec_autogen: true and parseLock round-trips it", () => {
  const yaml = serializeLock(lockWith(true));
  assertEquals(yaml.includes("spec_autogen: true"), true);
  assertEquals(parseLock(yaml).specAutogen, true);
});

Deno.test("serializeLock omits spec_autogen when false (byte-identical to pre-feature lock)", () => {
  const yaml = serializeLock(lockWith(false));
  assertEquals(yaml.includes("spec_autogen"), false);
  assertEquals(parseLock(yaml).specAutogen, false);
});

Deno.test("serializeLock omits spec_autogen when absent on the lock object", () => {
  const yaml = serializeLock(lockWith(undefined));
  assertEquals(yaml.includes("spec_autogen"), false);
  assertEquals(parseLock(yaml).specAutogen, false);
});

Deno.test("parseLock defaults spec_autogen to false when absent (FR-005)", () => {
  const v2 = `version: 2
harness: claude
spec_backend: cloud
templates_version: 0.7.0
entries: {}
`;
  assertEquals(parseLock(v2).specAutogen, false);
});

Deno.test("parseLock reads spec_autogen: true", () => {
  const v2 = `version: 2
harness: claude
spec_backend: cloud
spec_autogen: true
templates_version: 0.7.0
entries: {}
`;
  assertEquals(parseLock(v2).specAutogen, true);
});

Deno.test("parseLock coerces a non-true spec_autogen value to false", () => {
  const v2 = `version: 2
harness: claude
spec_backend: cloud
spec_autogen: yes-please
templates_version: 0.7.0
entries: {}
`;
  assertEquals(parseLock(v2).specAutogen, false);
});
