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
    backlogBackend: "local",
    versionScheme: "semver",
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
  assertEquals(roundtrip.backlogBackend, "local");
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
    backlogBackend: "local",
    versionScheme: "semver",
    templatesVersion: "0.3.0",
    entries: new Map(),
  };
  const yaml = serializeLock(lock);
  assertEquals(yaml.includes("version: 2"), true);
  assertEquals(yaml.includes("harness: cursor"), true);
  assertEquals(yaml.includes("backlog_backend: local"), true);
});

Deno.test("parseLock defaults backlog_backend to local when absent", () => {
  const v2 = `version: 2
harness: claude
templates_version: 0.7.0
entries: {}
`;
  const lock = parseLock(v2);
  assertEquals(lock.backlogBackend, "local");
});

Deno.test("parseLock accepts backlog_backend=github", () => {
  const v2 = `version: 2
harness: claude
backlog_backend: github
templates_version: 0.7.0
entries: {}
`;
  const lock = parseLock(v2);
  assertEquals(lock.backlogBackend, "github");
});

Deno.test("parseLock accepts backlog_backend=gitlab", () => {
  const v2 = `version: 2
harness: claude
backlog_backend: gitlab
templates_version: 0.7.0
entries: {}
`;
  const lock = parseLock(v2);
  assertEquals(lock.backlogBackend, "gitlab");
});

Deno.test("parseLock falls back to local on unknown backlog_backend value", () => {
  // Unknown values are silently coerced to "local" rather than thrown,
  // matching how missing harness fields default in v1 → v2 migration.
  const v2 = `version: 2
harness: claude
backlog_backend: not-a-backend
templates_version: 0.7.0
entries: {}
`;
  const lock = parseLock(v2);
  assertEquals(lock.backlogBackend, "local");
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

Deno.test("parseLock accepts v2 lock with harness=windsurf", () => {
  const v2 = `version: 2
harness: windsurf
templates_version: 0.6.0
entries:
  .windsurf/workflows/specflow-specify.md:
    sha256: eee
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.6.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "windsurf");
});

Deno.test("parseLock accepts v2 lock with harness=copilot", () => {
  const v2 = `version: 2
harness: copilot
templates_version: 0.7.0
entries:
  .github/instructions/specflow-specify.instructions.md:
    sha256: fff
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.7.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "copilot");
});

Deno.test("serializeLock emits parent_managed: true when set, round-trips through parseLock", () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    templatesVersion: "1.0.0",
    entries: new Map(),
    parentManaged: true,
  };
  const yaml = serializeLock(lock);
  assertEquals(yaml.includes("parent_managed: true"), true);
  const roundtrip = parseLock(yaml);
  assertEquals(roundtrip.parentManaged, true);
});

Deno.test("serializeLock omits parent_managed when not set", () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    templatesVersion: "1.0.0",
    entries: new Map(),
  };
  const yaml = serializeLock(lock);
  assertEquals(yaml.includes("parent_managed"), false);
});

Deno.test("parseLock defaults parentManaged to undefined when key absent (legacy lock)", () => {
  const v2 = `version: 2
harness: claude
templates_version: 0.7.0
entries: {}
`;
  const lock = parseLock(v2);
  assertEquals(lock.parentManaged, undefined);
});

Deno.test("parseLock reads parent_managed: true", () => {
  const v2 = `version: 2
harness: claude
parent_managed: true
templates_version: 0.7.0
entries: {}
`;
  const lock = parseLock(v2);
  assertEquals(lock.parentManaged, true);
});

Deno.test("parseLock accepts v2 lock with harness=opencode", () => {
  const v2 = `version: 2
harness: opencode
templates_version: 0.7.0
entries:
  .opencode/commands/specflow-specify.md:
    sha256: ggg
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.7.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "opencode");
});
