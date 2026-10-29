import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";

/**
 * An upgrade with nothing else to do still re-merges `.claude/settings.json`
 * (plan § 10 H3): a project already on the current release reaches its next
 * upgrade through the up-to-date path, so a hook registration that moved would
 * otherwise never reach it. What the merge did is said, as on the applied path.
 */
Deno.test("specnaut upgrade on an up-to-date project re-merges settings.json and says what it enabled", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-upgrade-json-" });
  try {
    const init = await runSpecnaut(
      ["init", "--here", "--ai", "claude", "--backlog", "local", "--no-git"],
      { cwd: dir },
    );
    assertEquals(init.code, 0, `init failed: ${init.stderr}`);
    const path = join(dir, ".claude/settings.json");
    await Deno.writeTextFile(path, '{ "theme": "dark" }\n');

    const { code, stdout, stderr } = await runSpecnaut(["upgrade"], { cwd: dir });
    assertEquals(code, 0, `upgrade failed: ${stderr}`);
    assertStringIncludes(stdout, "already up to date");
    assertStringIncludes(stdout, "enabled specnaut-cockpit@specnaut-marketplace");
    const merged = JSON.parse(await Deno.readTextFile(path));
    assertEquals(merged.theme, "dark");
    assert(Object.keys(merged.hooks ?? {}).length > 0, "the hooks were not grafted back in");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
