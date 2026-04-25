export type CoreCategory =
  | "command"
  | "agent"
  | "skill"
  | "spec-root"
  | "project-root"
  | "backlog-cmd";

export type CoreEntry = {
  readonly category: CoreCategory;
  readonly name: string;
  readonly suffix: string | null;
  readonly content: string;
  readonly executable: boolean;
};

export type CoreBundle = ReadonlyArray<CoreEntry>;

export function entriesByCategory(
  bundle: CoreBundle,
): Map<CoreCategory, ReadonlyArray<CoreEntry>> {
  const out = new Map<CoreCategory, CoreEntry[]>();
  for (const entry of bundle) {
    const existing = out.get(entry.category);
    if (existing) existing.push(entry);
    else out.set(entry.category, [entry]);
  }
  return out as Map<CoreCategory, ReadonlyArray<CoreEntry>>;
}

export function findByName(
  bundle: CoreBundle,
  category: CoreCategory,
  name: string,
  suffix: string | null = null,
): CoreEntry | null {
  return (
    bundle.find(
      (e) => e.category === category && e.name === name && (e.suffix ?? null) === suffix,
    ) ?? null
  );
}
