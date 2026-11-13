import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";
import { snapshot } from "../helpers/tree_snapshot.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #516 — `--dry-run` is documented as "Show the plan without writing", and
 * ends by printing "(dry-run — no files written)". It wrote twice anyway:
 *
 *   1. The rebrand migration `.specflow/` → `.specnaut/` ran eleven lines
 *      above the first dry-run guard, so a preview silently renamed the
 *      managed tree.
 *   2. Staging was populated in dry-run "so the agent can preview the
 *      reconciliation plan" — which also primed `specnaut reconcile` with
 *      upstream content for an upgrade that was never applied.
 *
 * These tests assert the property directly, on the tree. Asserting on stdout
 * is not enough: the whole defect was that stdout said nothing had happened.
 */

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

const INIT = ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"];

Deno.test("dry-run on a legacy .specflow/ project moves nothing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-dryrun-legacy-" });
  try {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    // Roll the project back to the pre-rebrand layout.
    await Deno.rename(join(dir, ".specnaut"), join(dir, ".specflow"));

    const before = await snapshot(dir);
    const r = await runSpecnaut(["upgrade", "--dry-run"], dir);

    assertEquals(r.code, 2, "a dry-run that cannot preview must refuse, not migrate");
    assertStringIncludes(r.stderr, ".specflow/");
    assert(await exists(join(dir, ".specflow")), ".specflow/ must still be there");
    assert(!(await exists(join(dir, ".specnaut"))), "dry-run must not create .specnaut/");
    assertEquals(await snapshot(dir), before, "the tree must be byte-for-byte unchanged");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dry-run writes no staging dir and leaves the tree untouched", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-dryrun-staging-" });
  try {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    // Customize a managed file, so the plan has something to stage.
    const skill = join(dir, ".claude/skills/specnaut/SKILL.md");
    await Deno.writeTextFile(skill, await Deno.readTextFile(skill) + "\n<!-- mine -->\n");

    const before = await snapshot(dir);
    const r = await runSpecnaut(["upgrade", "--dry-run"], dir);

    assertEquals(r.code, 0);
    assert(
      !(await exists(join(dir, ".specnaut/upgrade-staging"))),
      "a preview that leaves files on disk is not a preview",
    );
    assert(
      !(await exists(join(dir, ".specnaut/upgrade-pending.json"))),
      "and it must not claim an upgrade is pending reconciliation",
    );
    assertEquals(await snapshot(dir), before, "the tree must be byte-for-byte unchanged");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
