import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { git, run, sandbox } from "./git_sandbox.ts";
import * as hooks from "../templates/hooks/hook_sandbox.ts";

/**
 * cli#716 — the path a Windows caller hands bash, never normalised.
 *
 * Every other test goes through `bashPath`, which rewrites `\` to `/`, so
 * without this file no test hands a script a backslash. Two forms reach them:
 *
 *   - native: the project dir joined the Windows way, as Deno or PowerShell
 *     builds it — `C:\…\.specnaut\scripts\bash\land-feature.sh`. The merge
 *     scripts find their siblings through `dirname`, which Git Bash reads `\`
 *     in, so this form must land.
 *   - harness: the configured hook command, which appends `/…` to the project
 *     dir the harness holds — `C:\…\proj/.specnaut/hooks/guard-merge.sh`. A
 *     guard finds `_guard.sh` by the last `/` of its own path, and this form
 *     has one. A guard reached by the all-backslash form refuses (it looks
 *     in `.`), and no configured command builds that form.
 *
 * Windows only, and reported as ignored elsewhere: off Windows a `\` is a
 * filename character, so the same strings name files that do not exist and a
 * run would prove nothing. Windows CI is the only gate that runs these.
 */
const WINDOWS = Deno.build.os === "windows";

/** The script's path in both forms; each must hold a `\`, or the case proves nothing. */
function forms(work: string, name: string): Record<string, string> {
  const paths = {
    native: join(work, ".specnaut", "scripts", "bash", name),
    harness: `${work}/.specnaut/scripts/bash/${name}`,
  };
  for (const p of Object.values(paths)) assert(p.includes("\\"), `no backslash in ${p}`);
  return paths;
}

Deno.test({
  name: "on Windows, each merge script run by a backslash path finds its siblings",
  ignore: !WINDOWS, // off Windows a `\` is a filename character: these paths name nothing
  fn: async () => {
    const sb = await sandbox();
    try {
      // On main, with no feature: each stops at its own refusal, past the
      // sibling lookup. A sibling unfound is 3 (base-branch.sh) or 13 (merge-hold.sh).
      const want: Record<string, [number, ...string[]]> = {
        "epic-status.sh": [14],
        "fold-fixups.sh": [14],
        "land-feature.sh": [2],
        "remove-spec.sh": [22, "007-x"],
      };
      const wrong: string[] = [];
      for (const [name, [code, ...args]] of Object.entries(want)) {
        for (const [form, path] of Object.entries(forms(sb.work, name))) {
          const r = await run("bash", [path, ...args], sb.work);
          if (r.code !== code) wrong.push(`${form} ${name}: ${r.code}, not ${code}: ${r.stderr}`);
        }
      }
      assertEquals(wrong, []);
    } finally {
      await sb.cleanup();
    }
  },
});

Deno.test({
  name: "on Windows, land-feature.sh run by its native backslash path lands and pushes",
  ignore: !WINDOWS, // off Windows a `\` is a filename character: these paths name nothing
  fn: async () => {
    const sb = await sandbox();
    try {
      await git(sb.work, "switch", "--quiet", "-c", "feature");
      const head = await sb.commit("f", "x\n", "feat(7): a feature");
      const r = await run("bash", [forms(sb.work, "land-feature.sh").native], sb.work);
      assertEquals(r.code, 0, r.stderr);
      assertMatch(r.stdout, /^LANDED main [0-9a-f]{12}\.\.[0-9a-f]{12} 1 commit\(s\)$/m);
      assertEquals(await git(sb.remote, "rev-parse", "main"), head);
      assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "main");
    } finally {
      await sb.cleanup();
    }
  },
});

Deno.test({
  name:
    "on Windows, guard-merge.sh reached as the configured hook command builds it judges the call",
  ignore: !WINDOWS, // off Windows a `\` is a filename character: these paths name nothing
  fn: async () => {
    const sb = await hooks.sandbox();
    try {
      const repo = await hooks.makeRepo(sb, { head: "feat", mode: "manual" });
      // `bash "$CLAUDE_PROJECT_DIR/.specnaut/hooks/guard-merge.sh"`, the project dir a `C:\…`.
      const path = `${hooks.HOOKS_DIR.replace(/[\\/]+$/, "")}/guard-merge.sh`;
      assert(path.includes("\\"), `no backslash in ${path}`);
      const judge = async (command: string) =>
        hooks.runHook(
          sb,
          "guard-merge.sh",
          "claude",
          await hooks.payload("claude", "pre_tool_use_bash", {
            cwd: repo,
            tool_input: { command },
          }),
          { path },
        );
      const push = await judge("git push origin main");
      assertEquals(push.code, 2, push.stderr);
      // Its rule's own line, not the refusal of a guard that never found _guard.sh.
      assertMatch(push.stderr, /^specnaut guard-merge: merge: manual — held: /);
      const status = await judge("git status");
      assertEquals([status.code, status.stdout], [0, ""], status.stderr);
    } finally {
      await sb.cleanup();
    }
  },
});
