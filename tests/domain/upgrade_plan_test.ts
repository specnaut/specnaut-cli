import { assert, assertEquals } from "@std/assert";
import { computeUpgradePlan, type UpgradeAction } from "../../src/domain/upgrade_plan.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";

const emptyLock: InstalledLock = {
  version: 2,
  harness: "claude",
  backlogBackend: "local",
  templatesVersion: "0.1.0",
  entries: new Map(),
};

function lockWith(path: string, sha: string): InstalledLock {
  return {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
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

Deno.test("computeUpgradePlan emits remove for files removed from the new bundle (on disk, unmodified)", () => {
  const plan = computeUpgradePlan(
    new Map([["old.md", "a-sha"]]),
    lockWith("old.md", "a-sha"),
    new Map(),
  );
  assertEquals(plan.length, 1);
  assertEquals(plan[0].kind, "remove");
  if (plan[0].kind === "remove") {
    assertEquals(plan[0].dest, "old.md");
    assertEquals(plan[0].wasCustomized, false);
    assertEquals(plan[0].oldSha, "a-sha");
  }
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

Deno.test("computeUpgradePlan emits remove for clean orphan (lock + on disk + matches lock SHA + not in new bundle)", async () => {
  const sha = await sha256Hex("orphan content");
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["a.md", {
        sha256: await sha256Hex("a"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
      ["orphan.md", {
        sha256: sha,
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const diskShas = new Map([["a.md", await sha256Hex("a")], ["orphan.md", sha]]);
  const newShas = new Map([["a.md", await sha256Hex("a")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas);
  const remove = plan.find((p) => p.kind === "remove");
  assert(remove !== undefined);
  if (remove?.kind === "remove") {
    assertEquals(remove.dest, "orphan.md");
    assertEquals(remove.wasCustomized, false);
    assertEquals(remove.oldSha, sha);
  }
});

Deno.test("computeUpgradePlan emits remove with wasCustomized=true when disk diverges from lock SHA", async () => {
  const lockSha = await sha256Hex("original");
  const diskSha = await sha256Hex("user-edited");
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["orphan.md", {
        sha256: lockSha,
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const diskShas = new Map([["orphan.md", diskSha]]);
  const newShas = new Map<string, string>();
  const plan = computeUpgradePlan(diskShas, lock, newShas);
  const remove = plan.find((p) => p.kind === "remove");
  assert(remove !== undefined);
  if (remove?.kind === "remove") {
    assertEquals(remove.dest, "orphan.md");
    assertEquals(remove.wasCustomized, true);
    assertEquals(remove.oldSha, lockSha);
  }
});

Deno.test("computeUpgradePlan emits no action for orphan-not-on-disk (user already deleted)", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["orphan.md", {
        sha256: await sha256Hex("original"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const diskShas = new Map<string, string>();
  const newShas = new Map<string, string>();
  const plan = computeUpgradePlan(diskShas, lock, newShas);
  assertEquals(plan.find((p) => p.kind === "remove"), undefined);
});

// ── Plugin migration table (#73) ───────────────────────────────────────────
//
// Each test exercises one cell of the 6-state architect spec:
// (on-disk state) × (plugin state) → action.

const PLUGIN_PATH = ".claude/agents/product-owner.md";
const isCovered = (dest: string) => dest === PLUGIN_PATH;

Deno.test("plugin migration: vanilla on disk + plugin installed → migrate-to-plugin", async () => {
  const sha = await sha256Hex("original");
  const lock = lockWith(PLUGIN_PATH, sha);
  const diskShas = new Map([[PLUGIN_PATH, sha]]);
  const newShas = new Map([[PLUGIN_PATH, await sha256Hex("upstream-update")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas, true, isCovered);
  const a = plan.find((p) => p.dest === PLUGIN_PATH);
  assertEquals(a?.kind, "migrate-to-plugin");
  if (a?.kind === "migrate-to-plugin") {
    assertEquals(a.oldSha, sha);
  }
});

Deno.test("plugin migration: vanilla on disk + plugin installed (already at latest) → migrate-to-plugin (still hand off)", async () => {
  // Even when disk SHA already matches new bundle (would normally be
  // "unchanged"), with plugin installed we still hand the file off.
  const sha = await sha256Hex("identical-everywhere");
  const lock = lockWith(PLUGIN_PATH, sha);
  const diskShas = new Map([[PLUGIN_PATH, sha]]);
  const newShas = new Map([[PLUGIN_PATH, sha]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas, true, isCovered);
  assertEquals(plan.find((p) => p.dest === PLUGIN_PATH)?.kind, "migrate-to-plugin");
});

Deno.test("plugin migration: customized on disk + plugin installed → preserve with pluginAvailable=true", async () => {
  const lockSha = await sha256Hex("original");
  const lock = lockWith(PLUGIN_PATH, lockSha);
  const diskShas = new Map([[PLUGIN_PATH, await sha256Hex("user-edits")]]);
  const newShas = new Map([[PLUGIN_PATH, await sha256Hex("upstream-update")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas, true, isCovered);
  const a = plan.find((p) => p.dest === PLUGIN_PATH);
  assertEquals(a?.kind, "preserve");
  if (a?.kind === "preserve") {
    assertEquals(a.pluginAvailable, true);
    assertEquals(a.reason, "customized");
  }
});

Deno.test("plugin migration: missing on disk + plugin installed → defer-to-plugin", async () => {
  const lock = lockWith(PLUGIN_PATH, await sha256Hex("original"));
  const diskShas = new Map<string, string>(); // user deleted it
  const newShas = new Map([[PLUGIN_PATH, await sha256Hex("upstream-update")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas, true, isCovered);
  assertEquals(plan.find((p) => p.dest === PLUGIN_PATH)?.kind, "defer-to-plugin");
});

Deno.test("plugin migration: vanilla on disk + plugin NOT installed → existing auto-update behavior", async () => {
  const sha = await sha256Hex("original");
  const lock = lockWith(PLUGIN_PATH, sha);
  const diskShas = new Map([[PLUGIN_PATH, sha]]);
  const newShas = new Map([[PLUGIN_PATH, await sha256Hex("upstream-update")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas, false, isCovered);
  assertEquals(plan.find((p) => p.dest === PLUGIN_PATH)?.kind, "auto-update");
});

Deno.test("plugin migration: customized on disk + plugin NOT installed → preserve with pluginAvailable=false", async () => {
  const lockSha = await sha256Hex("original");
  const lock = lockWith(PLUGIN_PATH, lockSha);
  const diskShas = new Map([[PLUGIN_PATH, await sha256Hex("user-edits")]]);
  const newShas = new Map([[PLUGIN_PATH, await sha256Hex("upstream-update")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas, false, isCovered);
  const a = plan.find((p) => p.dest === PLUGIN_PATH);
  assertEquals(a?.kind, "preserve");
  if (a?.kind === "preserve") {
    assertEquals(a.pluginAvailable, false);
  }
});

Deno.test("plugin migration: missing on disk + plugin NOT installed → existing add-new behavior", async () => {
  const lock = lockWith(PLUGIN_PATH, await sha256Hex("original"));
  const diskShas = new Map<string, string>();
  const newShas = new Map([[PLUGIN_PATH, await sha256Hex("upstream")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas, false, isCovered);
  assertEquals(plan.find((p) => p.dest === PLUGIN_PATH)?.kind, "add-new");
});

Deno.test("plugin migration: uncovered path + plugin installed → existing behavior (covered=false)", async () => {
  // Even when plugin is installed, a path the plugin doesn't own
  // (like .claude/settings.json) goes through the normal flow.
  const UNCOVERED = ".claude/settings.json";
  const sha = await sha256Hex("hooks: {}");
  const lock = lockWith(UNCOVERED, sha);
  const diskShas = new Map([[UNCOVERED, sha]]);
  const newShas = new Map([[UNCOVERED, await sha256Hex("hooks: { ... }")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas, true, isCovered);
  assertEquals(plan.find((p) => p.dest === UNCOVERED)?.kind, "auto-update");
});
