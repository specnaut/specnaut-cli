import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { HOOKS_DIR, makeRepo, payload, runHook, sandbox } from "./hook_sandbox.ts";

/**
 * guard-dispatch-model.sh fails closed when `_agents.txt` is missing (cli#768):
 * without the list it cannot tell a Specnaut agent from the user's own, so an
 * override is refused rather than allowed. The hook runs from a copy of the
 * hooks directory with the list removed; the control run, with the list put
 * back, shows the copy allows a non-Specnaut override, so the refusal is the
 * missing list's and nothing else's.
 */
Deno.test("guard-dispatch-model refuses an override when _agents.txt is missing", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    const hooksDir = join(sb.dir, "hooks");
    await Deno.mkdir(hooksDir);
    for (const f of ["guard-dispatch-model.sh", "_guard.sh"]) {
      await Deno.copyFile(join(HOOKS_DIR, f), join(hooksDir, f));
    }
    const dispatch = (subagent_type: string) =>
      payload("claude", "pre_tool_use_agent", {
        cwd: repo,
        tool_input: { subagent_type, model: "haiku" },
      });

    const r = await runHook(sb, "guard-dispatch-model.sh", "claude", await dispatch("my-helper"), {
      hooksDir,
    });
    assertEquals(r.code, 2, `a missing list must refuse, got ${r.code}: ${r.stderr}`);
    assertStringIncludes(r.stderr, "_agents.txt is missing");
    assertStringIncludes(r.stderr, "'my-helper' cannot be checked");
    assertEquals(r.stdout, "", "a refusal prints no allow decision");

    await Deno.copyFile(join(HOOKS_DIR, "_agents.txt"), join(hooksDir, "_agents.txt"));
    const control = await runHook(
      sb,
      "guard-dispatch-model.sh",
      "claude",
      await dispatch("my-helper"),
      { hooksDir },
    );
    assertEquals(
      control.code,
      0,
      `with the list, a non-Specnaut override is allowed: ${control.stderr}`,
    );
    assert(!control.stderr.includes("is missing"));
  } finally {
    await sb.cleanup();
  }
});
