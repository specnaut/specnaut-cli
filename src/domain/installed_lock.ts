import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

export type KnownHarness =
  | "claude"
  | "cursor"
  | "codex"
  | "gemini"
  | "windsurf"
  | "copilot"
  | "opencode";
export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
  "claude",
  "cursor",
  "codex",
  "gemini",
  "windsurf",
  "copilot",
  "opencode",
];

export type BacklogBackend = "local" | "github" | "gitlab";
export const KNOWN_BACKLOG_BACKENDS: ReadonlyArray<BacklogBackend> = [
  "local",
  "github",
  "gitlab",
];

export type LockEntry = {
  readonly sha256: string;
  readonly installedAt: string;
  readonly templatesVersion: string;
};

export type InstalledLock = {
  readonly version: 2;
  readonly harness: KnownHarness;
  readonly backlogBackend: BacklogBackend;
  readonly templatesVersion: string;
  readonly entries: ReadonlyMap<string, LockEntry>;
};

function asObject(v: unknown, name: string): Record<string, unknown> {
  if (v === null || typeof v !== "object") {
    throw new Error(`${name} must be an object`);
  }
  return v as Record<string, unknown>;
}

function assertKnownHarness(v: unknown): asserts v is KnownHarness {
  if (typeof v !== "string" || !KNOWN_HARNESSES.includes(v as KnownHarness)) {
    throw new Error(
      `Unsupported harness '${String(v)}' — known: ${KNOWN_HARNESSES.join(", ")}`,
    );
  }
}

export function parseLock(yaml: string): InstalledLock {
  const root = asObject(parseYaml(yaml), "lock root");
  const rawVersion = root.version;
  if (rawVersion !== 1 && rawVersion !== 2) {
    throw new Error(`Unsupported lock version (expected 1 or 2): ${String(rawVersion)}`);
  }

  let harness: KnownHarness;
  if (rawVersion === 2) {
    assertKnownHarness(root.harness);
    harness = root.harness;
  } else {
    harness = "claude";
  }

  // Default to "local" when absent: existing locks pre-date the backend
  // selection feature, and the local-md flow is what was implicitly active.
  const rawBackend = root.backlog_backend;
  const backlogBackend: BacklogBackend = typeof rawBackend === "string" &&
      KNOWN_BACKLOG_BACKENDS.includes(rawBackend as BacklogBackend)
    ? (rawBackend as BacklogBackend)
    : "local";

  const templatesVersion = root.templates_version;
  if (typeof templatesVersion !== "string") {
    throw new Error("missing top-level templates_version");
  }
  const rawEntries = asObject(root.entries ?? {}, "entries");
  const entries = new Map<string, LockEntry>();
  for (const [path, value] of Object.entries(rawEntries)) {
    const entry = asObject(value, `entries[${path}]`);
    const sha256 = entry.sha256;
    const installedAt = entry.installed_at;
    const ver = entry.templates_version;
    if (typeof sha256 !== "string") throw new Error(`entries[${path}].sha256 must be string`);
    if (typeof installedAt !== "string") {
      throw new Error(`entries[${path}].installed_at must be string`);
    }
    if (typeof ver !== "string") {
      throw new Error(`entries[${path}].templates_version must be string`);
    }
    entries.set(path, { sha256, installedAt, templatesVersion: ver });
  }
  return { version: 2, harness, backlogBackend, templatesVersion, entries };
}

export function serializeLock(lock: InstalledLock): string {
  const entriesObj: Record<string, Record<string, string>> = {};
  const keys = [...lock.entries.keys()].sort();
  for (const k of keys) {
    const e = lock.entries.get(k)!;
    entriesObj[k] = {
      sha256: e.sha256,
      installed_at: e.installedAt,
      templates_version: e.templatesVersion,
    };
  }
  return stringifyYaml({
    version: 2,
    harness: lock.harness,
    backlog_backend: lock.backlogBackend,
    templates_version: lock.templatesVersion,
    entries: entriesObj,
  });
}
