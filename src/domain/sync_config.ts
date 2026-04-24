import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

export type SyncProvider = "github";

export type FieldMap = {
  readonly status: string;
  readonly priority: string;
  readonly complexity: string;
};

export type ProjectConfig = {
  readonly number: number;
  readonly owner: string;
  readonly fieldMap: FieldMap;
};

export type SyncConfig = {
  readonly version: 1;
  readonly sync: {
    readonly provider: SyncProvider;
    readonly repo: string;
    readonly project: ProjectConfig | null;
    readonly label_prefix: string;
  };
};

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function asObject(v: unknown, name: string): Record<string, unknown> {
  if (v === null || typeof v !== "object") throw new Error(`${name} must be an object`);
  return v as Record<string, unknown>;
}

export function parseSyncConfig(yaml: string): SyncConfig {
  const raw = parseYaml(yaml);
  const root = asObject(raw, "config root");

  if (root.version !== 1) {
    throw new Error(`Unsupported config version (expected 1): ${String(root.version)}`);
  }
  const sync = asObject(root.sync, "sync");

  const provider = sync.provider;
  if (provider !== "github") {
    throw new Error(`Unsupported provider: ${String(provider)}`);
  }
  const repo = sync.repo;
  if (typeof repo !== "string" || !REPO_RE.test(repo)) {
    throw new Error(`Invalid repo (expected owner/name): ${String(repo)}`);
  }
  const labelPrefix = typeof sync.label_prefix === "string" ? sync.label_prefix : "backlog/";

  let project: ProjectConfig | null = null;
  if (sync.project !== undefined && sync.project !== null) {
    const p = asObject(sync.project, "sync.project");
    const number = p.number;
    const owner = p.owner;
    const fm = asObject(p.field_map, "sync.project.field_map");
    if (typeof number !== "number") throw new Error("sync.project.number must be a number");
    if (typeof owner !== "string") throw new Error("sync.project.owner must be a string");
    const status = typeof fm.status === "string" ? fm.status : "Status";
    const priority = typeof fm.priority === "string" ? fm.priority : "Priority";
    const complexity = typeof fm.complexity === "string" ? fm.complexity : "Complexity";
    project = { number, owner, fieldMap: { status, priority, complexity } };
  }

  return {
    version: 1,
    sync: { provider, repo, project, label_prefix: labelPrefix },
  };
}

export function serializeSyncConfig(cfg: SyncConfig): string {
  const obj = {
    version: 1,
    sync: {
      provider: cfg.sync.provider,
      repo: cfg.sync.repo,
      ...(cfg.sync.project !== null
        ? {
          project: {
            number: cfg.sync.project.number,
            owner: cfg.sync.project.owner,
            field_map: {
              status: cfg.sync.project.fieldMap.status,
              priority: cfg.sync.project.fieldMap.priority,
              complexity: cfg.sync.project.fieldMap.complexity,
            },
          },
        }
        : {}),
      label_prefix: cfg.sync.label_prefix,
    },
  };
  return stringifyYaml(obj);
}
