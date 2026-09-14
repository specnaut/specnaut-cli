import { assertEquals } from "@std/assert";
import { computeUpgradePlan } from "../../src/domain/upgrade_plan.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { isPluginCoveredPath } from "../../src/domain/plugin_coverage.ts";

/**
 * specnaut-cli#605 — the round trip that makes "widening coverage is safe"
 * a demonstrated property rather than an asserted one.
 *
 * #605 widened plugin coverage from 2 skills to every skill the plugin ships,
 * which means `upgrade` will now DELETE 28 more destinations from a project
 * when the plugin is installed. That is only acceptable because the deletion is
 * reversible: uninstall the plugin, run `upgrade`, and the file comes back from
 * the bundle. The ruling leaned on that. Nothing tested it.
 *
 * The reversal is not a special case in the code — it falls out of
 * `covered = pluginInstalled && isPluginCovered(dest)`. When the plugin goes
 * away `covered` is false, the missing-on-disk branch takes `add-new` instead of
 * `defer-to-plugin`, and the bundle restores the file. These tests pin that
 * chain at the seam where it is decided.
 *
 * **They use the real predicate, not a stub.** A stub would prove the plan
 * logic and say nothing about whether `board/SKILL.md` is actually covered —
 * which is the part #605 changed and the part a future edit could quietly
 * revert.
 *
 * The load-bearing precondition is stated in `plugin_coverage.ts` and asserted
 * by the parity test: every covered path must still be in `CORE_BUNDLE`.
 * `add-new` can only fire for a dest the bundle ships, so a *phantom* covered
 * path is deleted and never restored. That is #455, and it is why breadth is
 * safe while staleness is not.
 */

const DEST = ".claude/skills/board/SKILL.md";
const VANILLA = "sha-vanilla";

function lockWith(entries: [string, string][]): InstalledLock {
  return {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "0.1.0",
    entries: new Map(
      entries.map((
        [p, sha],
      ) => [p, { sha256: sha, installedAt: "2026-04-25T00:00:00Z", templatesVersion: "0.1.0" }]),
    ),
  };
}

const covers = (dest: string) => isPluginCoveredPath("claude", dest);

Deno.test("step 1 — with the plugin installed, a vanilla covered skill is handed to the plugin", () => {
  const plan = computeUpgradePlan(
    new Map([[DEST, VANILLA]]), // on disk, unmodified
    lockWith([[DEST, VANILLA]]), // and tracked at that same hash
    new Map([[DEST, "sha-new"]]), // the bundle has moved on
    true, // plugin installed
    covers,
  );

  assertEquals(plan.length, 1);
  assertEquals(
    plan[0].kind,
    "migrate-to-plugin",
    `${DEST} was not handed to the plugin — #605 widened coverage to it, so ` +
      `this is the branch that now applies to 28 more destinations`,
  );
});

Deno.test("step 2 — with the plugin gone, the same skill is restored from the bundle", () => {
  // The state step 1 leaves behind: deleted from disk, dropped from the lock.
  const plan = computeUpgradePlan(
    new Map(), // not on disk
    lockWith([]), // and not in the lock
    new Map([[DEST, "sha-new"]]), // still shipped by the bundle
    false, // plugin uninstalled
    covers,
  );

  assertEquals(plan.length, 1);
  assertEquals(
    plan[0].kind,
    "add-new",
    "the file is not restored — then `upgrade` deleted a file it cannot give " +
      'back, and `check --project`\'s advice ("restore via specnaut upgrade") ' +
      "is unfollowable. The whole case for widening rests on this step",
  );
});

Deno.test("with the plugin still installed, a migrated file is deferred rather than rewritten", () => {
  // Distinguishes "restored because the plugin left" from "restored on every
  // run". Without this, step 2 would pass even if `add-new` fired
  // unconditionally — which would re-create on disk the very file the plugin is
  // serving, and step 1 would undo it again on the next upgrade.
  const plan = computeUpgradePlan(
    new Map(),
    lockWith([]),
    new Map([[DEST, "sha-new"]]),
    true,
    covers,
  );
  assertEquals(plan.length, 1);
  assertEquals(
    plan[0].kind,
    "defer-to-plugin",
    "a covered file absent while the plugin serves it must stay absent",
  );
});

Deno.test("a customised covered skill is preserved, never migrated", () => {
  // The other half of the widening's blast radius. 28 more destinations can now
  // reach this branch, and the answer must stay "touch nothing".
  const plan = computeUpgradePlan(
    new Map([[DEST, "sha-user-edited"]]),
    lockWith([[DEST, VANILLA]]),
    new Map([[DEST, "sha-new"]]),
    true,
    covers,
  );
  assertEquals(plan.length, 1);
  assertEquals(plan[0].kind, "preserve", "a user's edit must never be migrated away");
  if (plan[0].kind === "preserve") {
    assertEquals(
      plan[0].pluginAvailable,
      true,
      "the user is not told the plugin can serve this, so the preserve looks like a plain conflict",
    );
  }
});

Deno.test("an uncovered path is untouched by plugin state", () => {
  // The boundary the criterion draws. `board`'s SCRIPTS resolve paths relative
  // to their own location, so they stay binary-owned however the documents are
  // treated — the distinction the old "(project-stateful)" assertion conflated.
  const script = ".specnaut/scripts/backlog/add.sh";
  const plan = computeUpgradePlan(
    new Map([[script, VANILLA]]),
    lockWith([[script, VANILLA]]),
    new Map([[script, "sha-new"]]),
    true,
    covers,
  );
  assertEquals(plan.length, 1);
  assertEquals(
    plan[0].kind,
    "auto-update",
    "a backlog script was routed through the plugin branch — it would be " +
      "deleted from the project and served from a path where its own relative " +
      "lookups break",
  );
});
