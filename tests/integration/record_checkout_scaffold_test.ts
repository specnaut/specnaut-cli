import { assertEquals } from "@std/assert";
import { bundleForLock } from "../../src/application/lock_bundle.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { parseLock } from "../../src/domain/installed_lock.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { LOCK } from "./verify_scripts_fixture.ts";

/** Which harness is scaffolded the `SessionStart` hook that runs `specnaut record-checkout`. */

Deno.test("only Claude Code is scaffolded the hook that takes the record; every other harness takes none", () => {
  for (const harness of ["claude", "codex", "copilot", "cursor", "opencode", "antigravity"]) {
    const lock = parseLock(LOCK.replace("harness: claude", `harness: ${harness}`));
    const files = bundleForLock(CORE_BUNDLE, lock, findHarness)!;
    const calling = Object.entries(files)
      .filter(([, f]) => f.content.includes("record-checkout"))
      .map(([path]) => path)
      .sort();
    const expected = harness === "claude"
      ? [".claude/hooks/record-checkout.sh", ".claude/settings.json"]
      : [];
    assertEquals(calling, expected, harness);
  }
});
