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

/**
 * cli#783: releases up to 9.4.0 declared the cockpit's catalog as a `github`
 * source with `path`, which Claude Code does not refresh — the cockpit never
 * loaded, and a hand fix was reverted by the next upgrade. The real upgrade
 * replaces it, says so once, and has nothing to say the second time.
 */
Deno.test("specnaut upgrade repairs the github marketplace source Claude Code cannot refresh", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-upgrade-783-" });
  try {
    const path = await initWithLegacyDeclaration(dir);

    const first = await runSpecnaut(["upgrade"], { cwd: dir });
    assertEquals(first.code, 0, `upgrade failed: ${first.stderr}`);
    assertStringIncludes(first.stdout, "repaired the marketplace specnaut-marketplace");
    const source = JSON.parse(await Deno.readTextFile(path))
      .extraKnownMarketplaces["specnaut-marketplace"].source;
    assertEquals(source.source, "url");
    assertStringIncludes(
      source.url,
      "https://raw.githubusercontent.com/specnaut/specnaut-cli/v",
    );

    await assertUpgradeIsQuiet(dir, path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A scaffolded project whose marketplace is the github source releases up to 9.4.0 wrote. */
async function initWithLegacyDeclaration(dir: string): Promise<string> {
  const init = await runSpecnaut(
    ["init", "--here", "--ai", "claude", "--backlog", "local", "--no-git"],
    { cwd: dir },
  );
  assertEquals(init.code, 0, `init failed: ${init.stderr}`);
  const path = join(dir, ".claude/settings.json");
  const settings = JSON.parse(await Deno.readTextFile(path));
  settings.extraKnownMarketplaces["specnaut-marketplace"] = {
    source: {
      source: "github",
      repo: "specnaut/specnaut-cli",
      ref: "v9.4.0",
      path: "packaging/marketplace/.claude-plugin/marketplace.json",
    },
  };
  await Deno.writeTextFile(path, JSON.stringify(settings, null, 2) + "\n");
  return path;
}

/** A second upgrade changes nothing and says nothing about the marketplace. */
async function assertUpgradeIsQuiet(dir: string, path: string): Promise<void> {
  const before = await Deno.readTextFile(path);
  const again = await runSpecnaut(["upgrade"], { cwd: dir });
  assertEquals(again.code, 0, `second upgrade failed: ${again.stderr}`);
  assertEquals(again.stdout.includes("marketplace specnaut-marketplace"), false, again.stdout);
  assertEquals(await Deno.readTextFile(path), before);
}
