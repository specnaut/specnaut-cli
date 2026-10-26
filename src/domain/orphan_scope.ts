import type { InstalledLock, LockEntry } from "./installed_lock.ts";
import type { UpgradeAction, UpgradePlan } from "./upgrade_plan.ts";

/**
 * What `upgrade` may do with an orphan: a lock entry the bundle no longer
 * carries (cli#665, cli#666).
 *
 * The lock is committed, so its entries are contributor-controlled input. An
 * orphan whose recorded sha matches the file on disk is deleted on a plain
 * upgrade with no backup, so which paths an entry may name is bounded here —
 * by the folders Specnaut writes, not by whatever the lock happens to list.
 */

/**
 * Where an orphan sits relative to what `upgrade` may delete.
 *
 *   - `"in-scope"`              under a shared root or a harness root.
 *   - `"git-dir"`               a `.git` segment anywhere in the path, refused
 *                               whatever the roots say.
 *   - `"outside-managed-roots"` anything else — including every path that is
 *                               not plainly relative, which a prefix test on
 *                               `.specnaut/scripts/../../src/app.ts` would pass.
 */
export type OrphanScope = "in-scope" | "git-dir" | "outside-managed-roots";
export type RefusedScope = Exclude<OrphanScope, "in-scope">;

/**
 * The `.specnaut/` folders every harness writes. Not `.specnaut/` itself: its
 * other folders and files are the project's own — specs, local backlog,
 * addenda, `installed.lock`, `preserve.yml`, `backlog-config.yml` — and no
 * lock entry may ever reach them.
 */
export const SHARED_ROOTS: ReadonlyArray<string> = [
  ".specnaut/logs/",
  ".specnaut/memory/",
  ".specnaut/scripts/",
  ".specnaut/templates/",
];

/**
 * The files directly in `.specnaut/` that are Specnaut's, so a release may
 * retire them: the ones it ships, and the ones it has retired whose copies
 * projects may still carry. Listed by name because that folder's other files
 * are the project's. `managed_roots_test.ts` fails when a shipped file is
 * missing here; a retired one stays until no supported upgrade path has it.
 */
export const SPECNAUT_FILES: ReadonlyArray<string> = [
  ".specnaut/LABELS.md",
  ".specnaut/backlog.md",
  ".specnaut/gates.yml",
  ".specnaut/workflow.yml",
  ".specnaut/harness-tools.md", // retired in 7.0.0
];

/** Characters a filesystem may ignore in a name — HFS+ drops these. */
const IGNORABLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;

/**
 * A segment as Windows resolves it: trailing dots and spaces are dropped, so
 * `.git.` and `.git ` name `.git`.
 */
const windowsName = (segment: string) => segment.replace(/[. ]+$/, "").toLowerCase();

/** `.git` as any filesystem may spell it, including the 8.3 short name `GIT~1`. */
const isGit = (s: string) =>
  s !== "." && s !== ".." && (windowsName(s) === ".git" || /^git~\d+$/i.test(s));

/** Whether `action` is an orphan this run deletes — the one statement of it. */
export const deletesOrphan = (action: UpgradeAction, force: boolean): boolean =>
  action.kind === "remove" && (!action.wasCustomized || force);

/**
 * Decide whether `upgrade` may delete the orphan at `dest`.
 *
 * Lexical only. The writer asks again on the path with symlinks resolved
 * (`deletePaths`' `within`), because a committed link under a root can point
 * anywhere and no reading of the text can see it.
 *
 * `managedRoots` absent means the harness declared none: only `SHARED_ROOTS`
 * are in scope. Failing closed is the point — a caller that forgets the roots
 * removes less, never more.
 */
export function orphanScope(
  dest: string,
  managedRoots: ReadonlyArray<string> = [],
): OrphanScope {
  const segments = dest.split("/");
  if (segments.some((s) => isGit(s.replace(new RegExp(IGNORABLE, "g"), "")))) return "git-dir";
  const plain = !dest.includes("\\") && !IGNORABLE.test(dest) &&
    segments.every((s) =>
      s !== "" && s !== "." && s !== ".." && !s.includes(":") && windowsName(s) === s.toLowerCase()
    );
  if (!plain) return "outside-managed-roots";
  if (SPECNAUT_FILES.includes(dest)) return "in-scope";
  return [...SHARED_ROOTS, ...managedRoots].some((root) =>
      dest.startsWith(root) && dest.length > root.length
    )
    ? "in-scope"
    : "outside-managed-roots";
}

type PlanOrphansOptions = {
  managedRoots?: ReadonlyArray<string>;
  isDeclaredPreserved: (dest: string) => boolean;
  pluginAvailable: (dest: string) => boolean;
};

const droppedDeclared = (dest: string, pluginAvailable: boolean): UpgradeAction => ({
  kind: "preserve",
  dest,
  reason: "declared",
  pluginAvailable,
  declaredDrift: "dropped-upstream",
});

/**
 * The plan's actions for every orphan, in path order.
 *
 * Scope first, before the absent-file skip and before the declared-preserve
 * rule: an entry nothing may delete is reported and dropped whether or not its
 * file exists — a lock naming a path outside Specnaut's folders is worth one
 * line even when there is nothing left on disk to protect.
 */
export function planOrphans(
  diskShas: ReadonlyMap<string, string>,
  lock: InstalledLock,
  newShas: ReadonlyMap<string, string>,
  opts: PlanOrphansOptions,
): UpgradeAction[] {
  const actions: UpgradeAction[] = [];
  const orphans = [...lock.entries.keys()].filter((dest) => !newShas.has(dest)).sort();
  for (const dest of orphans) {
    const diskSha = diskShas.get(dest);
    const scope = orphanScope(dest, opts.managedRoots);
    if (scope !== "in-scope") {
      actions.push({ kind: "orphan-refused", dest, reason: scope, onDisk: diskSha !== undefined });
      continue;
    }
    if (diskSha === undefined) continue;
    // FR-009: a declared path the bundle dropped is kept (preservation wins over
    // removal), with its own drift state: there is no upstream to be behind.
    if (opts.isDeclaredPreserved(dest)) {
      actions.push(droppedDeclared(dest, opts.pluginAvailable(dest)));
      continue;
    }
    const lockSha = lock.entries.get(dest)!.sha256;
    actions.push({ kind: "remove", dest, oldSha: lockSha, wasCustomized: diskSha !== lockSha });
  }
  return actions;
}

/**
 * The lock entries of the customised orphans this run KEPT, verbatim (cli#666).
 *
 * The lock is rebuilt from the bundle, so an orphan's entry used to fall out of
 * it whatever happened to the file. For a removed orphan that is right; for a
 * kept one it erased the only record that the file was Specnaut's: the next run
 * no longer saw an orphan, never reported it again, and `--force` had nothing
 * to remove. Carried unchanged, the entry keeps the sha it was installed with,
 * so every later run reaches the same verdict and `--force` can still back the
 * file up and delete it. Never the user's sha: that would make the next run
 * read the edit as vanilla and delete it without a backup.
 *
 * `orphan-refused` entries are not carried: an entry nothing may delete is
 * dropped, not kept (cli#665).
 */
export function keptOrphanEntries(
  plan: UpgradePlan,
  lock: InstalledLock,
  force: boolean,
): Map<string, LockEntry> {
  const kept = new Map<string, LockEntry>();
  for (const action of plan) {
    if (action.kind !== "remove" || deletesOrphan(action, force)) continue;
    const entry = lock.entries.get(action.dest);
    if (entry !== undefined) kept.set(action.dest, entry);
  }
  return kept;
}

/**
 * `plan` with each orphan the writer refused re-labelled `orphan-refused`: the
 * plan read only the path's text, and the writer found it resolves outside
 * (cli#665). What the summary reports is what happened, not what was planned.
 */
export function relabelRefused(plan: UpgradePlan, refused: ReadonlySet<string>): UpgradePlan {
  return plan.map((a) =>
    refused.has(a.dest)
      ? { kind: "orphan-refused", dest: a.dest, reason: "outside-managed-roots", onDisk: true }
      : a
  );
}
