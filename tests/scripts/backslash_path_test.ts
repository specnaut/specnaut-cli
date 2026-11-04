import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { git, REFUSALS_ON_BASE, run, sandbox } from "./git_sandbox.ts";
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
 *     dir the harness holds — `C:\…\proj/.specnaut/hooks/protect-generated.sh`. A
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
      const wrong: string[] = [];
      for (const [name, { args, code, line }] of Object.entries(REFUSALS_ON_BASE)) {
        for (const [form, path] of Object.entries(forms(sb.work, name))) {
          const r = await run("bash", [path, ...args], sb.work);
          if (r.code !== code || !r.stderr.includes(line)) {
            wrong.push(`${form} ${name}: ${r.code}, not ${code} with "${line}": ${r.stderr}`);
          }
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
    "on Windows, protect-generated.sh reached as the configured hook command builds it judges the call",
  ignore: !WINDOWS, // off Windows a `\` is a filename character: these paths name nothing
  fn: async () => {
    const sb = await hooks.sandbox();
    try {
      const repo = await hooks.makeRepo(sb, { head: "feat", mode: "auto" });
      // `bash "$CLAUDE_PROJECT_DIR/.specnaut/hooks/protect-generated.sh"`, the project dir a `C:\…`.
      const path = `${hooks.HOOKS_DIR.replace(/[\\/]+$/, "")}/protect-generated.sh`;
      assert(path.includes("\\"), `no backslash in ${path}`);
      const judge = async (file: string) =>
        hooks.runHook(
          sb,
          "protect-generated.sh",
          "claude",
          await hooks.payload("claude", "pre_tool_use_edit", {
            cwd: repo,
            tool_input: { file_path: `${repo}/${file}` },
          }),
          { path },
        );
      const lock = await judge(".specnaut/installed.lock");
      assertEquals(lock.code, 2, lock.stderr);
      // Its rule's own line, not the refusal of a guard that never found _guard.sh.
      assertMatch(lock.stderr, /^specnaut protect-generated: denied: /);
      const other = await judge("src/a.ts");
      assertEquals([other.code, other.stdout], [0, ""], other.stderr);
    } finally {
      await sb.cleanup();
    }
  },
});

Deno.test("runHook refuses an opts.path that names another hook, or comes with opts.hooksDir", async () => {
  // Any OS: the guard is never reached, so a `\` here is only text (cli#728).
  const sb = await hooks.sandbox();
  try {
    const call = async (path: string, extra: Record<string, string> = {}) =>
      await hooks.runHook(
        sb,
        "guard-merge.sh",
        "claude",
        "{}",
        { path, ...extra } as { path: string },
      );
    await assertRejects(
      () => call("C:\\p/.specnaut/hooks/guard-release.sh"),
      Error,
      "does not name",
    );
    await assertRejects(
      () => call("C:\\p/.specnaut/hooks/xguard-merge.sh"),
      Error,
      "does not name",
    );
    await assertRejects(
      () => call("C:\\p/.specnaut/hooks/guard-merge.sh", { hooksDir: "/elsewhere" }),
      Error,
      "replaces opts.hooksDir",
    );
  } finally {
    await sb.cleanup();
  }
});
