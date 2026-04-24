import { assertEquals, assertThrows } from "@std/assert";
import {
  type InstalledLock,
  type LockEntry,
  parseLock,
  serializeLock,
} from "../../src/domain/installed_lock.ts";

const VALID_YAML = `version: 1
templates_version: 0.2.0
entries:
  ".claude/commands/speckit.specify.md":
    sha256: abc123
    installed_at: "2026-04-25T10:00:00Z"
    templates_version: 0.2.0
  AGENTS.md:
    sha256: def456
    installed_at: "2026-04-25T10:00:00Z"
    templates_version: 0.2.0
`;

Deno.test("parseLock returns a structured lock for valid YAML", () => {
  const lock = parseLock(VALID_YAML);
  assertEquals(lock.version, 1);
  assertEquals(lock.templatesVersion, "0.2.0");
  assertEquals(lock.entries.size, 2);
  const speckit = lock.entries.get(".claude/commands/speckit.specify.md");
  assertEquals(speckit?.sha256, "abc123");
  assertEquals(speckit?.installedAt, "2026-04-25T10:00:00Z");
});

Deno.test("parseLock rejects unsupported version", () => {
  const yaml = VALID_YAML.replace("version: 1", "version: 42");
  assertThrows(() => parseLock(yaml), Error, "version");
});

Deno.test("parseLock rejects missing templates_version", () => {
  const yaml = VALID_YAML.replace(/templates_version:.*\n/, "");
  assertThrows(() => parseLock(yaml), Error, "templates_version");
});

Deno.test("serializeLock round-trips", () => {
  const lock: InstalledLock = {
    version: 1,
    templatesVersion: "0.3.0",
    entries: new Map<string, LockEntry>([
      ["CLAUDE.md", {
        sha256: "aaa",
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.3.0",
      }],
    ]),
  };
  const yaml = serializeLock(lock);
  const roundtrip = parseLock(yaml);
  assertEquals(roundtrip.version, lock.version);
  assertEquals(roundtrip.templatesVersion, lock.templatesVersion);
  assertEquals(roundtrip.entries.get("CLAUDE.md")?.sha256, "aaa");
});
