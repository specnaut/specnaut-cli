import { assertEquals } from "@std/assert";
import { computeUpgradePlan, type UpgradePlanOptions } from "../../src/domain/upgrade_plan.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";

/**
 * `isSupersededEdit` (cli#803): a router whose only local edit is a verb row
 * the bundle now ships is planned as unedited — after a declared preserve,
 * which still wins, and before the plugin table, which then migrates it.
 */

const ROUTER = ".claude/skills/task/SKILL.md";
const lock: InstalledLock = {
  version: 2,
  harness: "claude",
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  templatesVersion: "9.4.0",
  entries: new Map([[ROUTER, {
    sha256: "lock-sha",
    installedAt: "2026-01-01T00:00:00Z",
    templatesVersion: "9.3.0",
  }]]),
};
const plan = (opts: UpgradePlanOptions) =>
  computeUpgradePlan(new Map([[ROUTER, "disk-sha"]]), lock, new Map([[ROUTER, "new-sha"]]), opts);
const superseded = { isSupersededEdit: (dest: string) => dest === ROUTER };

Deno.test("a superseded verb row is no edit: the router is updated", () => {
  assertEquals(plan(superseded), [
    { kind: "auto-update", dest: ROUTER, oldSha: "disk-sha", newSha: "new-sha" },
  ]);
});

Deno.test("without the predicate the same router is a customisation, kept", () => {
  assertEquals(plan({}).map((a) => [a.kind, a.kind === "preserve" ? a.reason : ""]), [
    ["preserve", "customized"],
  ]);
});

Deno.test("a declared preserve still wins over a superseded row", () => {
  const actions = plan({ ...superseded, isDeclaredPreserved: () => true });
  assertEquals(actions.map((a) => [a.kind, a.kind === "preserve" ? a.reason : ""]), [
    ["preserve", "declared"],
  ]);
});

Deno.test("a superseded router the plugin serves migrates to the plugin", () => {
  const actions = plan({ ...superseded, pluginInstalled: true, isPluginCovered: () => true });
  assertEquals(actions, [{ kind: "migrate-to-plugin", dest: ROUTER, oldSha: "disk-sha" }]);
});
