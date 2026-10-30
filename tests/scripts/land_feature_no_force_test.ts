import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";

/**
 * cli#711 — land-feature.sh never forces. A rejected push never reaches
 * origin, so no remote-side check can see a force: the argv of every `git push`
 * and `git branch` the landing makes is recorded and read instead.
 */

Deno.test("a landing never forces: no push carries a force flag or a + refspec, no branch -D", {
  // The shim is a bash script named `git` on PATH; Windows resolves `git.exe` first.
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "feature");
    await sb.commit("f", "x\n", "feat(7): a feature");
    const log = join(sb.root, "git-argv.log");
    // One line per call, its arguments separated by \x1f.
    const r = await sb.scriptWithGit(
      `printf '%s\\x1f' "$@" >>'${log}'; printf '\\n' >>'${log}'\nexec "$REAL_GIT" "$@"`,
      "land-feature.sh",
    );
    assertEquals(r.code, 0, r.stderr);
    const calls = (await Deno.readTextFile(log)).split("\n").filter(Boolean).map((line) => {
      const argv = line.split("\x1f").slice(0, -1);
      // Skip git's own options (`-c k=v`, `--no-pager`) to reach the subcommand.
      let i = 0;
      while (i < argv.length && argv[i].startsWith("-")) i += argv[i] === "-c" ? 2 : 1;
      return { sub: argv[i], args: argv.slice(i + 1) };
    });
    const pushes = calls.filter((c) => c.sub === "push");
    const branches = calls.filter((c) => c.sub === "branch");
    // Positive control: the landing did push and did delete, so the shim saw both.
    assertEquals(pushes.length, 1, JSON.stringify(calls));
    assert(branches.some((c) => c.args.includes("-d")), JSON.stringify(branches));
    const forced = (a: string) =>
      a === "-f" || a === "--force" || a.startsWith("--force-with-lease") ||
      (/^-[a-zA-Z]+$/.test(a) && a.includes("f"));
    for (const p of pushes) {
      assertEquals(p.args.filter(forced), [], `a forced push: ${p.args.join(" ")}`);
      assertEquals(p.args.filter((a) => a.startsWith("+")), [], `a + refspec: ${p.args.join(" ")}`);
    }
    for (const b of branches) {
      assertEquals(
        b.args.filter((a) => a === "-D" || a === "--force" || a === "-f"),
        [],
        `a forced branch call: ${b.args.join(" ")}`,
      );
    }
  } finally {
    await sb.cleanup();
  }
});
