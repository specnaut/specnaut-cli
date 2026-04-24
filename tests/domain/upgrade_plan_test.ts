import { assertEquals } from "@std/assert";
import { computeUpgradePlan, type UpgradeAction } from "../../src/domain/upgrade_plan.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";

const emptyLock: InstalledLock = {
  version: 1,
  templatesVersion: "0.1.0",
  entries: new Map(),
};

function lockWith(path: string, sha: string): InstalledLock {
  return {
    version: 1,
    templatesVersion: "0.1.0",
    entries: new Map([[
      path,
      { sha256: sha, installedAt: "2026-04-25T00:00:00Z", templatesVersion: "0.1.0" },
    ]]),
  };
}

Deno.test("computeUpgradePlan emits add-new for file not on disk and not in lock", () => {
  const plan = computeUpgradePlan(
    new Map(),
    emptyLock,
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan.length, 1);
  assertEquals(plan[0].kind, "add-new");
  if (plan[0].kind === "add-new") assertEquals(plan[0].dest, "CLAUDE.md");
});

Deno.test("computeUpgradePlan emits unchanged when disk matches new bundle", () => {
  const plan = computeUpgradePlan(
    new Map([["CLAUDE.md", "same-sha"]]),
    lockWith("CLAUDE.md", "same-sha"),
    new Map([["CLAUDE.md", "same-sha"]]),
  );
  assertEquals(plan[0].kind, "unchanged");
});

Deno.test("computeUpgradePlan emits auto-update when disk matches lock but differs from new", () => {
  const plan = computeUpgradePlan(
    new Map([["CLAUDE.md", "old-sha"]]),
    lockWith("CLAUDE.md", "old-sha"),
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan[0].kind, "auto-update");
  if (plan[0].kind === "auto-update") {
    assertEquals(plan[0].oldSha, "old-sha");
    assertEquals(plan[0].newSha, "new-sha");
  }
});

Deno.test("computeUpgradePlan emits preserve when disk diverges from lock and new bundle", () => {
  const plan = computeUpgradePlan(
    new Map([["CLAUDE.md", "user-sha"]]),
    lockWith("CLAUDE.md", "original-sha"),
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan[0].kind, "preserve");
});

Deno.test("computeUpgradePlan emits preserve when no lock entry and disk differs", () => {
  const plan = computeUpgradePlan(
    new Map([["CLAUDE.md", "user-sha"]]),
    emptyLock,
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan[0].kind, "preserve");
});

Deno.test("computeUpgradePlan re-adds file that user deleted (was in lock)", () => {
  const plan = computeUpgradePlan(
    new Map(),
    lockWith("CLAUDE.md", "original-sha"),
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan[0].kind, "add-new");
});

Deno.test("computeUpgradePlan does not emit actions for files removed from the new bundle", () => {
  const plan = computeUpgradePlan(
    new Map([["old.md", "a-sha"]]),
    lockWith("old.md", "a-sha"),
    new Map(),
  );
  assertEquals(plan.length, 0);
});

Deno.test("computeUpgradePlan sorts actions by dest for deterministic output", () => {
  const plan = computeUpgradePlan(
    new Map(),
    emptyLock,
    new Map([
      ["z.md", "z"],
      ["a.md", "a"],
      ["m.md", "m"],
    ]),
  );
  assertEquals(plan.map((a: UpgradeAction) => a.dest), ["a.md", "m.md", "z.md"]);
});
