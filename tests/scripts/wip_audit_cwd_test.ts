import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { git, run, sandbox } from "./git_sandbox.ts";

/**
 * cli#774 — wip-audit.sh's pathspecs are the repository's, whatever directory
 * it runs in: `ls-tree` and `diff` read a pathspec against the caller's cwd,
 * so from a subdirectory a branch's own feature.json link went unseen.
 */

Deno.test("a branch's feature.json link is ACTIVE from any directory the audit runs in", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "work");
    const tip = await sb.commit(".specnaut/feature.json", '{ "linked_issue": 21 }\n', "plan: x");
    await git(sb.work, "switch", "--quiet", "main");
    await Deno.mkdir(join(sb.work, "src/deep"), { recursive: true });
    const r = await run(
      "bash",
      ["../../.specnaut/scripts/bash/wip-audit.sh", "21"],
      join(sb.work, "src/deep"),
    );
    assertEquals([r.code, r.stdout.split("\n")[0]], [0, `ACTIVE 21 ${tip}`], r.stderr);
  } finally {
    await sb.cleanup();
  }
});
