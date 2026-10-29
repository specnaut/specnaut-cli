import { bold, cyan, dim, green, yellow } from "@std/fmt/colors";
import type { UpgradePlan } from "../../domain/upgrade_plan.ts";
import type { UpgradeProjectResult } from "../../application/upgrade_project.ts";
import {
  crossesMajorBoundary,
  MIGRATION_GUIDE_PATH,
  MIGRATION_GUIDE_URL,
} from "../../domain/major_boundary.ts";
import { orphanCounts, renderOrphanGroups } from "./upgrade_orphan_summary.ts";
import { backupLine, contextLinkLine, linkMovedLine } from "./write_report.ts";
import { type HookTrustTarget, printUpgradeHookTrust } from "./hook_trust_note.ts";

/**
 * The report `specnaut upgrade` prints: the grouped summary of what the plan
 * did to each file, bucketed by the response each bucket needs from the
 * reader, then the outcome of an applied run.
 */

/**
 * @param written Dests this run actually wrote. Empty for a dry run, which has
 *   nothing to report but the forecast — there, the plan IS the outcome.
 * @param force Whether `--force` was passed — see `upgrade_orphan_summary.ts`.
 */
export function renderSummary(
  plan: UpgradePlan,
  from: string,
  to: string,
  written: ReadonlySet<string> = new Set(),
  force = false,
) {
  const groups = {
    auto: plan.filter((a) => a.kind === "auto-update"),
    // A preserve the run then wrote is not a preserve — `--force` overwrites
    // the whole `customized` bucket, and rendering the plan verbatim reported
    // every one of those files as "not touched" while their content had just
    // been replaced (#519). Split them out before anything reads this group.
    preserve: plan.filter((a) => a.kind === "preserve" && !written.has(a.dest)),
    overwritten: plan.filter((a) => a.kind === "preserve" && written.has(a.dest)),
    added: plan.filter((a) => a.kind === "add-new"),
    unchanged: plan.filter((a) => a.kind === "unchanged"),
    migrated: plan.filter((a) => a.kind === "migrate-to-plugin"),
    deferred: plan.filter((a) => a.kind === "defer-to-plugin"),
    relinked: plan.filter((a) => a.kind === "replace-with-link"),
  };

  console.log(
    `\n${bold("specnaut upgrade")} — templates ${dim(from)} → ${cyan(to)}\n`,
  );

  if (groups.auto.length > 0) {
    console.log(bold("  auto-update (unchanged locally)"));
    for (const a of groups.auto) console.log(green(`    ✓ ${a.dest}`));
    console.log();
  }
  if (groups.added.length > 0) {
    console.log(bold("  new files to add"));
    for (const a of groups.added) console.log(green(`    + ${a.dest}`));
    console.log();
  }
  if (groups.relinked.length > 0) {
    // Not a preserve: the link is the fix (cli#680), and keeping the user's
    // file would leave AGENTS.md unread for exactly the people who edited it.
    console.log(bold("  replaced with a link to AGENTS.md (yours backed up — see below)"));
    for (const a of groups.relinked) {
      const was = a.kind === "replace-with-link" && a.previous === "foreign-link"
        ? "was a link elsewhere"
        : "was your own file — move what you need into AGENTS.md";
      console.log(yellow(`    ↪ ${a.dest} ${dim(`(${was})`)}`));
    }
    console.log();
  }
  if (groups.overwritten.length > 0) {
    console.log(bold("  overwritten (was customized — previous content backed up)"));
    for (const a of groups.overwritten) console.log(cyan(`    ↻ ${a.dest}`));
    console.log();
  }
  // Customized files split into two states that read identically today and
  // need opposite responses. One is settled — you edited it, upstream has not
  // moved, nothing is missing. The other is an update that was published and
  // never arrived, and will never arrive on its own: the lock entry froze with
  // the file, so every later run reaches the same verdict. Reporting both as
  // "customized locally" is what let five files in this project's own install
  // sit three months behind, referencing agents that had been deleted, while
  // every run printed a clean success.
  //
  // Split by REASON first. The `settled`/`behind` repair above was applied to
  // the `customized` population only, and a declared preserve returned from
  // `buildUpgradePlan` before `staleSince` was ever computed — so it carried
  // none, landed in `settled` by construction, and printed under a heading
  // asserting the two things a declaration makes unverifiable: that the file
  // was customized (it was declared) and that upstream had not moved (nobody
  // had looked). A guard repaired once, blind to the branch that never
  // reaches the fix.
  const customized = groups.preserve.filter((a) =>
    a.kind === "preserve" && a.reason === "customized"
  );
  const declared = groups.preserve.filter((a) => a.kind === "preserve" && a.reason === "declared");
  const settled = customized.filter((a) => a.kind === "preserve" && !a.staleSince);
  const behind = customized.filter((a) => a.kind === "preserve" && a.staleSince);

  const declaredIn = (state: string) =>
    declared.filter((a) => a.kind === "preserve" && a.declaredDrift === state);
  const declCurrent = declaredIn("current");
  const declBehind = declaredIn("behind");
  const declNoBaseline = declaredIn("no-lock-entry");
  const declDropped = declaredIn("dropped-upstream");

  if (declCurrent.length > 0) {
    console.log(bold("  preserved by declaration — level with upstream"));
    for (const a of declCurrent) console.log(green(`    ✓ ${a.dest}`));
    console.log();
  }
  if (declBehind.length > 0) {
    console.log(
      bold("  preserved by declaration, and BEHIND — upstream moved since the freeze"),
    );
    console.log(
      dim(
        "    A declaration is a maintenance obligation, and this is the only" +
          " place it is reported:\n    a declared path is never staged, so" +
          " `specnaut reconcile --status` cannot list it.",
      ),
    );
    for (const a of declBehind) {
      if (a.kind !== "preserve") continue;
      const since = a.declaredFrozenAt
        ? ` ${
          dim(
            `(frozen at v${a.declaredFrozenAt.templatesVersion}, ${
              a.declaredFrozenAt.installedAt.slice(0, 10)
            })`,
          )
        }`
        : "";
      console.log(yellow(`    ⚠ ${a.dest}${since}`));
      console.log(dim(`        diff it: specnaut diff ${a.dest}`));
    }
    console.log(
      dim(
        "    Nothing here is applied automatically, and the declaration still" +
          " wins over --force.\n    Re-read each against upstream and drop the" +
          " preserve line if its reason has expired.\n",
      ),
    );
  }
  if (declNoBaseline.length > 0) {
    console.log(bold("  preserved by declaration — no baseline recorded, cannot compare"));
    console.log(
      dim('    The lock carries no entry for these, so "level with upstream" would be a guess.'),
    );
    for (const a of declNoBaseline) console.log(yellow(`    ? ${a.dest}`));
    console.log();
  }
  if (declDropped.length > 0) {
    console.log(bold("  preserved by declaration — upstream no longer ships this path"));
    for (const a of declDropped) console.log(yellow(`    ⚠ ${a.dest}`));
    console.log();
  }

  if (settled.length > 0) {
    console.log(bold("  customized locally (not touched)"));
    for (const a of settled) {
      const tag = a.kind === "preserve" && a.pluginAvailable
        ? ` ${dim("[plugin available — reconcile manually]")}`
        : "";
      console.log(yellow(`    ⚠ ${a.dest}${tag}`));
    }
    console.log();
  }
  if (behind.length > 0) {
    console.log(bold("  customized, and behind — an update was published and never applied"));
    // Grouped by the version each file froze at, not listed flat. Files rarely
    // freeze one at a time: a single out-of-band edit — a repo-wide rename, a
    // bulk sed — strands a whole set at the same version on the same day. Seeing
    // them share a freeze point names the event that caused it, which a flat
    // list repeating the same date on every line actively hides.
    const byFreeze = new Map<string, typeof behind>();
    for (const a of behind) {
      if (a.kind !== "preserve" || !a.staleSince) continue;
      const key = `${a.staleSince.templatesVersion}\u0000${a.staleSince.installedAt.slice(0, 10)}`;
      const bucket = byFreeze.get(key);
      if (bucket) bucket.push(a);
      else byFreeze.set(key, [a]);
    }
    for (const [key, files] of byFreeze) {
      const [version, day] = key.split("\u0000");
      console.log(
        dim(
          `    last written by v${version} on ${day} — every upgrade since has skipped ` +
            `${files.length === 1 ? "it" : `these ${files.length}`}:`,
        ),
      );
      for (const a of files) {
        console.log(yellow(`      ⚠ ${a.dest}`));
        console.log(dim(`          specnaut reconcile ${a.dest} --accept-upstream`));
      }
    }
    console.log(
      dim(
        `    All ${behind.length} at once: specnaut upgrade --reset-baseline` +
          ` (keeps a .specnaut.bak of each).\n`,
      ),
    );
  }
  renderOrphanGroups(plan, force);
  if (groups.migrated.length > 0) {
    console.log(bold("  migrated to specnaut-plugin plugin (backed up + removed)"));
    for (const a of groups.migrated) console.log(cyan(`    → ${a.dest}`));
    console.log();
  }
  if (groups.deferred.length > 0) {
    console.log(bold("  deferred to specnaut-plugin plugin (was missing on disk)"));
    for (const a of groups.deferred) console.log(dim(`    · ${a.dest}`));
    console.log();
  }

  console.log(
    dim(
      // The declared buckets are counted here too. Scoping `settled`/`behind`
      // to the customized population left this tail printing "0 preserved,
      // 0 behind" on a run that had just reported a declared path as behind —
      // the same silence this change removes, one line further down, where a
      // reader skimming the summary is most likely to stop.
      `  ${groups.auto.length} auto-update, ${settled.length + declCurrent.length} preserved, ` +
        `${behind.length + declBehind.length} behind, ` +
        (groups.overwritten.length > 0 ? `${groups.overwritten.length} overwritten, ` : "") +
        (groups.relinked.length > 0 ? `${groups.relinked.length} relinked, ` : "") +
        `${groups.added.length} added, ${
          orphanCounts(plan, force)
        }${groups.migrated.length} migrated, ` +
        `${groups.deferred.length} deferred, ${groups.unchanged.length} unchanged`,
    ),
  );
}

type Applied = Extract<UpgradeProjectResult, { status: "applied" }>;

/**
 * What an applied run wrote, after the summary: the backups and links it made,
 * the tick, then the hook-trust note and the two warnings that belong right
 * where the eye lands.
 */
export async function renderOutcome(result: Applied, hooks: HookTrustTarget): Promise<void> {
  const written = new Set(result.written);
  if (result.backups.length > 0) console.log();
  for (const b of result.backups) console.log(backupLine(b));
  if (result.linksMoved.length > 0) console.log();
  for (const b of result.linksMoved) console.log(linkMovedLine(b));
  if (result.contextLinks.length > 0) console.log();
  for (const link of result.contextLinks) console.log(contextLinkLine(link));
  console.log();
  console.log(green(`✓ upgraded to templates ${result.fromVersion} → ${result.toVersion}`));
  await printUpgradeHookTrust(hooks, result);
  warnLeftBehind(result.plan, written);
  warnMajorBoundary(result.fromVersion, result.toVersion);
}

/**
 * A run whose only outcome is skips still printed a bare green tick. That is
 * the line people read, and it said the work was done. Name what was left,
 * right where the eye lands, or the group above goes unread.
 *
 * Only files the run left alone. A `--force` run delivers the whole behind
 * bucket, and this warning still fired for every one of them — telling the
 * reader that "nothing will deliver them on a later run" about updates the
 * same command had just applied, which reads as a failure and invites a
 * pointless second pass (#519).
 */
function warnLeftBehind(plan: UpgradePlan, written: ReadonlySet<string>): void {
  const n = plan.filter((a) => a.kind === "preserve" && a.staleSince && !written.has(a.dest))
    .length;
  if (n === 0) return;
  console.log(
    yellow(
      `⚠ ${n} file${n === 1 ? "" : "s"} did not receive ` +
        `${n === 1 ? "an update" : "updates"} published for ` +
        `${n === 1 ? "it" : "them"} — see "customized, and behind" above. ` +
        `Nothing will deliver ${n === 1 ? "it" : "them"} on a later run.`,
    ),
  );
}

/**
 * A breaking upgrade is the one moment `UPGRADING.md` exists for, and until
 * now the binary never named it — the only inbound links were the README and
 * one published release body, neither of which somebody mid-upgrade is
 * reading (#481). Printed only when the major actually changes, so it stays
 * meaningful instead of becoming a line people learn to skip.
 */
function warnMajorBoundary(from: string, to: string): void {
  if (!crossesMajorBoundary(from, to)) return;
  console.log();
  console.log(
    yellow(`⚠ this crossed a major version — read the migration guide before you continue:`),
  );
  console.log(`  ${MIGRATION_GUIDE_PATH}  ·  ${MIGRATION_GUIDE_URL}`);
}
