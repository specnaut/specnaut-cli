import { assertEquals, assertThrows } from "@std/assert";
import { parseSyncConfig, serializeSyncConfig } from "../../src/domain/sync_config.ts";

const VALID_YAML = `version: 1
sync:
  provider: github
  repo: kevinraimbaud/specflow
  project:
    number: 3
    owner: kevinraimbaud
    field_map:
      status: Status
      priority: Priority
      complexity: Complexity
  label_prefix: backlog/
`;

Deno.test("parseSyncConfig returns structured config for valid YAML", () => {
  const cfg = parseSyncConfig(VALID_YAML);
  assertEquals(cfg.version, 1);
  assertEquals(cfg.sync.provider, "github");
  assertEquals(cfg.sync.repo, "kevinraimbaud/specflow");
  assertEquals(cfg.sync.project?.number, 3);
  assertEquals(cfg.sync.project?.owner, "kevinraimbaud");
  assertEquals(cfg.sync.project?.fieldMap.status, "Status");
  assertEquals(cfg.sync.label_prefix, "backlog/");
});

Deno.test("parseSyncConfig accepts config without project (issues-only mode)", () => {
  const yaml = `version: 1
sync:
  provider: github
  repo: kevinraimbaud/specflow
  label_prefix: backlog/
`;
  const cfg = parseSyncConfig(yaml);
  assertEquals(cfg.sync.project, null);
});

Deno.test("parseSyncConfig rejects unsupported version", () => {
  const yaml = VALID_YAML.replace("version: 1", "version: 99");
  assertThrows(() => parseSyncConfig(yaml), Error, "version");
});

Deno.test("parseSyncConfig rejects unsupported provider", () => {
  const yaml = VALID_YAML.replace("provider: github", "provider: gitlab");
  assertThrows(() => parseSyncConfig(yaml), Error, "provider");
});

Deno.test("parseSyncConfig rejects malformed repo (must be owner/name)", () => {
  const yaml = VALID_YAML.replace(
    "repo: kevinraimbaud/specflow",
    "repo: not-a-valid-repo-string",
  );
  assertThrows(() => parseSyncConfig(yaml), Error, "repo");
});

Deno.test("serializeSyncConfig round-trips a config", () => {
  const cfg = parseSyncConfig(VALID_YAML);
  const yaml = serializeSyncConfig(cfg);
  const roundtrip = parseSyncConfig(yaml);
  assertEquals(roundtrip, cfg);
});
