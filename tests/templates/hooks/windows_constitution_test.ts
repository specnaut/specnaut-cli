import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { makeRepo, payload, runHook, sandbox } from "./hook_sandbox.ts";
import { gitBash } from "./hook_path.ts";

/**
 * Spec 038: the constitution, by the `C:\` forms a Windows harness sends,
 * through its own guard — judged as the file, never refused as a path. Beside
 * `windows_test.ts`, which holds the same forms for the generated-file guard.
 */
Deno.test("a C:\\ path to docs/constitution.md is judged as the constitution", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    await Deno.mkdir(join(repo, "src"));
    await Deno.mkdir(join(repo, "docs"));
    await Deno.writeTextFile(join(repo, "docs", "constitution.md"), "x\n");
    const { env, win } = await gitBash(sb);
    for (
      const [cwd, file] of [
        [repo, win(join(repo, "docs", "constitution.md"))],
        [join(repo, "src"), "..\\docs\\constitution.md"],
      ]
    ) {
      const r = await runHook(
        sb,
        "protect-constitution.sh",
        "claude",
        await payload("claude", "pre_tool_use_edit", {
          cwd: win(cwd),
          tool_input: { file_path: file },
        }),
        { env },
      );
      assertEquals(r.code, 2, `${file}: ${r.stderr}`);
      assertStringIncludes(r.stderr, "would change docs/constitution.md", "judged, not refused");
    }
  } finally {
    await sb.cleanup();
  }
});
