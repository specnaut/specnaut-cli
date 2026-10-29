import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";

/**
 * A brownfield `init` into a project that already has `.claude/settings.json`
 * merges Specnaut's plugin declarations into it. A plugin Specnaut enables runs
 * code once installed, so `init` says so — as `upgrade` always has (#642).
 * Through the real entry point: the note is only worth something if it prints.
 */
Deno.test("specnaut init into an existing settings.json names the plugin it enabled", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-notes-" });
  try {
    await Deno.mkdir(join(dir, ".claude"));
    await Deno.writeTextFile(join(dir, ".claude/settings.json"), '{ "theme": "dark" }\n');
    const { code, stdout, stderr } = await runSpecnaut(
      ["init", "--here", "--ai", "claude", "--backlog", "local", "--no-git"],
      { cwd: dir },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);
    assertStringIncludes(stdout, "enabled specnaut-cockpit@specnaut-marketplace");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
