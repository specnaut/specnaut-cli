import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, sandbox } from "./git_sandbox.ts";

/**
 * land-feature.sh runs every git call with `core.hooksPath` pointed nowhere: a branch that commits
 * hooks and a repository-relative hooks path naming them must not have them run by the landing.
 */

const exists = (path: string) => Deno.stat(path).then(() => true, () => false);

Deno.test("the landing runs none of the branch's git hooks, whatever core.hooksPath names", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "feature");
    const marker = join(sb.root, "hook-ran");
    const hook = `#!/bin/sh\necho "$0" >>'${bashPath(marker)}'\nexit 0\n`;
    await Deno.mkdir(join(sb.work, ".githooks"));
    for (const name of ["post-checkout", "post-merge", "pre-push", "reference-transaction"]) {
      await Deno.writeTextFile(join(sb.work, ".githooks", name), hook);
      // Windows has no mode bits: Git for Windows runs a hook by its `#!` line.
      if (Deno.build.os !== "windows") await Deno.chmod(join(sb.work, ".githooks", name), 0o755);
    }
    await git(sb.work, "add", ".githooks");
    await git(sb.work, "commit", "--quiet", "-m", "chore: commit hooks");
    await git(sb.work, "config", "core.hooksPath", ".githooks");
    // Positive control: the hooks are live for a git that does not turn them off.
    await git(sb.work, "checkout", "--quiet", "-b", "probe");
    assert(await exists(marker), "the branch's hooks never ran: the test proves nothing");
    await git(sb.work, "checkout", "--quiet", "feature");
    await git(sb.work, "branch", "--quiet", "-D", "probe");
    await Deno.remove(marker);
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await exists(marker), false, await Deno.readTextFile(marker).catch(() => ""));
  } finally {
    await sb.cleanup();
  }
});
