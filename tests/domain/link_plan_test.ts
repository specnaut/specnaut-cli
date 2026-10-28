import { assertEquals } from "@std/assert";
import { computeUpgradePlan } from "../../src/domain/upgrade_plan.ts";
import type { PlannableLinkState } from "../../src/domain/link_plan.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";

/** The plan for a context-link destination comes from its disk state (cli#680). */

const DEST = ".claude/CLAUDE.md";
const lock: InstalledLock = {
  version: 2,
  harness: "claude",
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  templatesVersion: "1.0.0",
  entries: new Map([[DEST, { sha256: "old", installedAt: "t", templatesVersion: "1.0.0" }]]),
};

const planFor = (state: PlannableLinkState, declared = false) =>
  computeUpgradePlan(new Map([[DEST, "disk"]]), lock, new Map([[DEST, "identity"]]), {
    linkStates: new Map([[DEST, state]]),
    isDeclaredPreserved: () => declared,
  });

Deno.test("link plan: each disk state maps to its action", () => {
  const kinds = ([
    "absent",
    "ours-link",
    "ours-fallback",
    "materialised",
    "generated",
    "customized",
    "foreign-link",
  ] as const)
    .map((s) => [s, planFor(s)[0]?.kind]);
  assertEquals(kinds, [
    ["absent", "add-new"],
    ["ours-link", "unchanged"],
    ["ours-fallback", "unchanged"],
    ["materialised", "auto-update"],
    ["generated", "auto-update"],
    ["customized", "replace-with-link"],
    ["foreign-link", "replace-with-link"],
  ]);
});

Deno.test("link plan: a declaration still wins over the link state", () => {
  const [action] = planFor("customized", true);
  assertEquals(action.kind === "preserve" && action.reason, "declared");
});
