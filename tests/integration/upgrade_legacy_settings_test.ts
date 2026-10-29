import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { lockText } from "./_lock_fixture.ts";
import {
  CONSTITUTION_PATH,
  LEGACY_CONSTITUTION_PATH,
  SIZE_LIMITS_CONFIG_PATH,
  UI_CONFIG_PATH,
} from "../../src/domain/constitution_paths.ts";

/**
 * Spec 038, FR-010 end to end: a pre-038 constitution with a customised size
 * table and a target-surface declaration is moved byte for byte, its two
 * settings land in their configs, the shipped `_config.sh` reads the size
 * config back, and a dry run writes neither.
 */

const OLD = "# Acme rules\n\n## Size" + " limits\n\n| Unit | Target | Ceiling |\n" +
  "| :--- | ---: | ---: |\n| file | 280 | 450 |\n\nExempt: `*.lock`\n\n" +
  "## Front-end patterns\n\n### Target surface\n\nThis project targets desktop viewports only.\n";

async function legacyProject(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-settings-" });
  try {
    const r = await runSpecnaut(
      ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: dir },
    );
    assertEquals(r.code, 0, r.stderr);
    await Deno.remove(join(dir, CONSTITUTION_PATH));
    await Deno.writeTextFile(
      join(dir, ".specnaut/installed.lock"),
      (await lockText(dir)).replace(/^ {2}docs\/constitution\.md:\n(?: {4}.*\n)*/m, ""),
    );
    await Deno.mkdir(join(dir, ".specnaut/memory"), { recursive: true });
    await Deno.writeTextFile(join(dir, LEGACY_CONSTITUTION_PATH), OLD);
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("upgrade carries the old table and declaration into their configs", async () => {
  await legacyProject(async (dir) => {
    const dry = await runSpecnaut(["upgrade", "--dry-run"], { cwd: dir });
    assertEquals(dry.code, 0, dry.stderr);
    assertStringIncludes(dry.stdout, `would write ${SIZE_LIMITS_CONFIG_PATH}`);
    assertEquals(await exists(join(dir, SIZE_LIMITS_CONFIG_PATH)), false);

    const r = await runSpecnaut(["upgrade"], { cwd: dir });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await Deno.readTextFile(join(dir, CONSTITUTION_PATH)), OLD, "never edited");
    assertStringIncludes(r.stdout, `wrote ${SIZE_LIMITS_CONFIG_PATH}`);
    assertStringIncludes(r.stdout, "can be deleted");
    assertEquals(
      await Deno.readTextFile(join(dir, UI_CONFIG_PATH)),
      'target_surface: "desktop viewports only"\n',
    );
    const read = await new Deno.Command("bash", {
      args: [
        "-c",
        '. .specnaut/scripts/bash/_config.sh && config_size_limits "$CONFIG_SIZE_LIMITS"',
      ],
      cwd: dir,
      stdout: "piped",
    }).output();
    assertEquals(read.code, 0);
    assertEquals(
      new TextDecoder().decode(read.stdout).replaceAll("\r", ""),
      "file 280 450 config\nfunction 30 50 default\nconstitution 60 100 default\nexempt *.lock\n",
    );

    // Written once: a second run finds the configs and says nothing of them.
    await Deno.writeTextFile(join(dir, UI_CONFIG_PATH), "# ours\n");
    const again = await runSpecnaut(["upgrade"], { cwd: dir });
    assertEquals(again.code, 0, again.stderr);
    assertEquals(again.stdout.includes(UI_CONFIG_PATH), false);
    assertEquals(await Deno.readTextFile(join(dir, UI_CONFIG_PATH)), "# ours\n");
  });
});
