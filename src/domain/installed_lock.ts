import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

export type KnownHarness =
  | "claude"
  | "cursor"
  | "codex"
  | "windsurf"
  | "copilot"
  | "opencode";
export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
  "claude",
  "cursor",
  "codex",
  "windsurf",
  "copilot",
  "opencode",
];

export type BacklogBackend = "local" | "github" | "gitlab" | "cloud";
export const KNOWN_BACKLOG_BACKENDS: ReadonlyArray<BacklogBackend> = [
  "local",
  "github",
  "gitlab",
  "cloud",
];

export type VersionScheme = "semver" | "date";
export const KNOWN_VERSION_SCHEMES: ReadonlyArray<VersionScheme> = [
  "semver",
  "date",
];

/**
 * Where a project's specifications are stored (spec 020 / cli#424).
 * `local` = `.specnaut/specs/` markdown files (the pre-feature behaviour, first-
 * class default); `cloud` = hosted on SpecNaut Cloud via the versioned
 * `/api/v1/specs*` contract. Sibling of {@link BacklogBackend}.
 */
export type SpecBackend = "local" | "cloud";
export const KNOWN_SPEC_BACKENDS: ReadonlyArray<SpecBackend> = [
  "local",
  "cloud",
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
  readonly versionScheme: VersionScheme;
  /**
   * Where this project's specs live (spec 020). Absent in a pre-feature lock →
   * `"local"` (FR-010, backward compatible). Sibling of `backlogBackend`.
   */
  readonly specBackend: SpecBackend;
  readonly templatesVersion: string;
  readonly entries: ReadonlyMap<string, LockEntry>;
  /**
   * Caches the parent-managed decision (009-parent-managed-init). When `true`,
   * the target is a member of a providing Specnaut workspace and agentic files
   * (`.claude/skills|agents|commands`) were intentionally suppressed — `entries`
   * therefore contains no agentic keys (FR-012). Serialized as `parent_managed:
   * true` and emitted only when set; a legacy lock without the key parses to
   * `undefined`, prompting upgrade to re-derive it once via the reader.
   */
  readonly parentManaged?: true;
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

  // Default to "semver" when absent: existing locks pre-date the
  // tag-release pack. SemVer is the safer default for unknown projects
  // (a library mis-classified as date-based is more disruptive than the
  // reverse — consumers downstream reason about version numbers).
  const rawScheme = root.version_scheme;
  const versionScheme: VersionScheme = typeof rawScheme === "string" &&
      KNOWN_VERSION_SCHEMES.includes(rawScheme as VersionScheme)
    ? (rawScheme as VersionScheme)
    : "semver";

  // Default to "local" when absent: existing locks pre-date the spec-backend
  // selection feature, and the local-md flow is what was implicitly active
  // (FR-010 — backward-compatible upgrade path). Mirrors `backlog_backend`.
  const rawSpecBackend = root.spec_backend;
  const specBackend: SpecBackend = typeof rawSpecBackend === "string" &&
      KNOWN_SPEC_BACKENDS.includes(rawSpecBackend as SpecBackend)
    ? (rawSpecBackend as SpecBackend)
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
  // `parent_managed` only ever stores the truthy decision; any other value
  // (absent, false, garbage) means "not parent-managed" ⇒ undefined.
  const parentManaged = root.parent_managed === true ? true : undefined;

  return {
    version: 2,
    harness,
    backlogBackend,
    versionScheme,
    specBackend,
    templatesVersion,
    entries,
    ...(parentManaged ? { parentManaged } : {}),
  };
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
    version_scheme: lock.versionScheme,
    spec_backend: lock.specBackend,
    // Emit `parent_managed` only when set so legacy/standalone locks stay
    // byte-for-byte identical to before this feature.
    ...(lock.parentManaged ? { parent_managed: true } : {}),
    templates_version: lock.templatesVersion,
    entries: entriesObj,
  });
}
