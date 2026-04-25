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
  assertEquals(lock.version, 2);
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
    version: 2,
    harness: "claude",
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
  assertEquals(roundtrip.version, 2);
  assertEquals(roundtrip.templatesVersion, lock.templatesVersion);
  assertEquals(roundtrip.entries.get("CLAUDE.md")?.sha256, "aaa");
});

Deno.test("parseLock auto-upgrades a v1 lock to v2 with harness=claude", () => {
  const v1 = `version: 1
templates_version: 0.2.0
entries:
  CLAUDE.md:
    sha256: aaa
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.2.0"
`;
  const lock = parseLock(v1);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "claude");
  assertEquals(lock.templatesVersion, "0.2.0");
});

Deno.test("parseLock accepts v2 lock with harness field", () => {
  const v2 = `version: 2
harness: cursor
templates_version: 0.3.0
entries:
  .cursor/skills/speckit-specify/SKILL.md:
    sha256: bbb
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.3.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "cursor");
});

Deno.test("parseLock rejects unsupported v2 harness", () => {
  const bad = `version: 2
harness: not-a-harness
templates_version: 0.3.0
entries: {}
`;
  assertThrows(() => parseLock(bad), Error, "harness");
});

Deno.test("serializeLock writes version 2 with harness field", () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "cursor",
    templatesVersion: "0.3.0",
    entries: new Map(),
  };
  const yaml = serializeLock(lock);
  assertEquals(yaml.includes("version: 2"), true);
  assertEquals(yaml.includes("harness: cursor"), true);
});

Deno.test("parseLock accepts v2 lock with harness=codex", () => {
  const v2 = `version: 2
harness: codex
templates_version: 0.4.0
entries:
  .agents/skills/specflow-specify/SKILL.md:
    sha256: ccc
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.4.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "codex");
});

Deno.test("parseLock accepts v2 lock with harness=gemini", () => {
  const v2 = `version: 2
harness: gemini
templates_version: 0.5.0
entries:
  .gemini/commands/specflow-specify.toml:
    sha256: ddd
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.5.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "gemini");
});
