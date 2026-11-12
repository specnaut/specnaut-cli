import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { HOOKS_DIR, makeRepo, payload, runHook, type Sandbox, sandbox } from "./hook_sandbox.ts";

/**
 * guard-dispatch-model.sh fails closed when `_agents.txt` is missing (cli#768):
 * without the list it cannot tell a Specnaut agent from the user's own, so an
 * override is refused rather than allowed. The hook runs from a copy of the
 * hooks directory with the list removed; the control run, with the list put
 * back, shows the copy allows a non-Specnaut override, so the refusal is the
 * missing list's and nothing else's.
 */

/** A copy of the hooks directory holding the hook and its library, and no `_agents.txt`. */
async function hooksWithoutList(sb: Sandbox): Promise<string> {
  const hooksDir = join(sb.dir, "hooks");
  await Deno.mkdir(hooksDir);
  for (const f of ["guard-dispatch-model.sh", "_guard.sh"]) {
    await Deno.copyFile(join(HOOKS_DIR, f), join(hooksDir, f));
  }
  return hooksDir;
}

/** The hook, run from `hooksDir`, on a dispatch of the user's `my-helper` with a model override. */
async function dispatchMyHelper(sb: Sandbox, repo: string, hooksDir: string) {
  const input = await payload("claude", "pre_tool_use_agent", {
    cwd: repo,
    tool_input: { subagent_type: "my-helper", model: "haiku" },
  });
  return runHook(sb, "guard-dispatch-model.sh", "claude", input, { hooksDir });
}

Deno.test("guard-dispatch-model refuses an override when _agents.txt is missing", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    const hooksDir = await hooksWithoutList(sb);
    const r = await dispatchMyHelper(sb, repo, hooksDir);
    assertEquals(r.code, 2, `a missing list must refuse, got ${r.code}: ${r.stderr}`);
    assertStringIncludes(r.stderr, "_agents.txt is missing");
    assertStringIncludes(r.stderr, "'my-helper' cannot be checked");
    assertEquals(r.stdout, "", "a refusal prints no allow decision");
    // The control: the same copy with the list back allows a non-Specnaut override.
    await Deno.copyFile(join(HOOKS_DIR, "_agents.txt"), join(hooksDir, "_agents.txt"));
    const control = await dispatchMyHelper(sb, repo, hooksDir);
    assertEquals(control.code, 0, `with the list, the override is allowed: ${control.stderr}`);
    assert(!control.stderr.includes("is missing"));
  } finally {
    await sb.cleanup();
  }
});
