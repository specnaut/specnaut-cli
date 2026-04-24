import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

export type LockEntry = {
  readonly sha256: string;
  readonly installedAt: string;
  readonly templatesVersion: string;
};

export type InstalledLock = {
  readonly version: 1;
  readonly templatesVersion: string;
  readonly entries: ReadonlyMap<string, LockEntry>;
};

function asObject(v: unknown, name: string): Record<string, unknown> {
  if (v === null || typeof v !== "object") {
    throw new Error(`${name} must be an object`);
  }
  return v as Record<string, unknown>;
}

export function parseLock(yaml: string): InstalledLock {
  const root = asObject(parseYaml(yaml), "lock root");

  if (root.version !== 1) {
    throw new Error(
      `Unsupported lock version (expected 1): ${String(root.version)}`,
    );
  }
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
    if (typeof sha256 !== "string") {
      throw new Error(`entries[${path}].sha256 must be string`);
    }
    if (typeof installedAt !== "string") {
      throw new Error(`entries[${path}].installed_at must be string`);
    }
    if (typeof ver !== "string") {
      throw new Error(`entries[${path}].templates_version must be string`);
    }
    entries.set(path, { sha256, installedAt, templatesVersion: ver });
  }
  return { version: 1, templatesVersion, entries };
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
    version: 1,
    templates_version: lock.templatesVersion,
    entries: entriesObj,
  });
}
