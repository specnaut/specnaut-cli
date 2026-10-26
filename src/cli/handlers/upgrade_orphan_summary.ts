import { bold, dim, red, yellow } from "@std/fmt/colors";
import type { UpgradeAction, UpgradePlan } from "../../domain/upgrade_plan.ts";
import { deletesOrphan } from "../../domain/orphan_scope.ts";

/**
 * The orphan half of `specnaut upgrade`'s summary: what left the bundle, and
 * what `upgrade` did about each (cli#665, cli#666).
 *
 * `force` is asked, not read off the plan: a customised orphan is the same
 * `remove` action whether it is deleted (under `--force`, backed up first) or
 * kept, so only the flag can say which heading is true.
 */

type Remove = Extract<UpgradeAction, { kind: "remove" }>;
type Refused = Extract<UpgradeAction, { kind: "orphan-refused" }>;

function orphanGroups(plan: UpgradePlan, force: boolean) {
  const removes = plan.filter((a): a is Remove => a.kind === "remove");
  return {
    removed: removes.filter((a) => !a.wasCustomized),
    customized: removes.filter((a) => a.wasCustomized),
    // The same rule the use case deletes by, so the heading cannot disagree with it.
    customizedDeleted: removes.some((a) => a.wasCustomized && deletesOrphan(a, force)),
    refused: plan.filter((a): a is Refused => a.kind === "orphan-refused"),
  };
}

export function renderOrphanGroups(plan: UpgradePlan, force: boolean): void {
  const { removed, customized, customizedDeleted, refused } = orphanGroups(plan, force);
  if (removed.length > 0) {
    console.log(bold("  removed (no longer in templates)"));
    for (const a of removed) console.log(red(`    ✗ ${a.dest}`));
    console.log();
  }
  if (customizedDeleted) {
    console.log(bold("  removed (was customized — backed up to .specnaut.bak)"));
    for (const a of customized) console.log(red(`    ✗ ${a.dest}`));
    console.log();
  } else if (customized.length > 0) {
    // Still tracked (cli#666), so this list repeats on every run until the file
    // is removed — by hand, or by `--force`, which backs it up first.
    console.log(bold("  removed but customized (not touched without --force)"));
    for (const a of customized) console.log(yellow(`    ⚠ ${a.dest}`));
    console.log();
  }
  if (refused.length > 0) {
    // The lock named these, but they sit outside every folder Specnaut writes,
    // so `upgrade` will not delete them — `--force` included.
    console.log(bold("  no longer tracked — outside Specnaut's folders, left in place"));
    for (const a of refused) {
      const why = a.reason === "git-dir" ? "inside .git/" : "outside the managed folders";
      console.log(yellow(`    ⚠ ${a.dest} ${dim(`(${why}${a.onDisk ? "" : ", not on disk"})`)}`));
    }
    console.log();
  }
}

/** The orphan counts for the summary's closing line, each followed by `, `. */
export function orphanCounts(plan: UpgradePlan, force: boolean): string {
  const { removed, customized, customizedDeleted, refused } = orphanGroups(plan, force);
  return `${removed.length} removed, ` +
    `${customized.length} orphan-${customizedDeleted ? "removed" : "preserved"}, ` +
    (refused.length > 0 ? `${refused.length} untracked, ` : "");
}
