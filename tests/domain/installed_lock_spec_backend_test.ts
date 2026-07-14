import { assertEquals } from "@std/assert";
import {
  type InstalledLock,
  type LockEntry,
  parseLock,
  serializeLock,
} from "../../src/domain/installed_lock.ts";

// Spec 020 / FR-010 — the `spec_backend` lock field: round-trips through
// serialize/parse and defaults to "local" when absent (backward-compatible
// upgrade path). Mirrors the backlog_backend default-on-absent coverage.

function lockWith(specBackend: InstalledLock["specBackend"]): InstalledLock {
  return {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend,
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

Deno.test("serializeLock emits spec_backend and parseLock round-trips it (cloud)", () => {
  const yaml = serializeLock(lockWith("cloud"));
  assertEquals(yaml.includes("spec_backend: cloud"), true);
  assertEquals(parseLock(yaml).specBackend, "cloud");
});

Deno.test("serializeLock round-trips spec_backend: local", () => {
  const yaml = serializeLock(lockWith("local"));
  assertEquals(yaml.includes("spec_backend: local"), true);
  assertEquals(parseLock(yaml).specBackend, "local");
});

Deno.test("parseLock defaults spec_backend to local when absent (FR-010)", () => {
  const v2 = `version: 2
harness: claude
templates_version: 0.7.0
entries: {}
`;
  assertEquals(parseLock(v2).specBackend, "local");
});

Deno.test("parseLock accepts spec_backend: cloud", () => {
  const v2 = `version: 2
harness: claude
spec_backend: cloud
templates_version: 0.7.0
entries: {}
`;
  assertEquals(parseLock(v2).specBackend, "cloud");
});

Deno.test("parseLock falls back to local on an unknown spec_backend value", () => {
  const v2 = `version: 2
harness: claude
spec_backend: not-a-backend
templates_version: 0.7.0
entries: {}
`;
  assertEquals(parseLock(v2).specBackend, "local");
});
