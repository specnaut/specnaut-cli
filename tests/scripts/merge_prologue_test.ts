import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import { git, hermetic, run, sandbox } from "./git_sandbox.ts";
import { calls, lfsBranch } from "./lfs_push_fixture.ts";

/**
 * cli#806 — `land-feature.sh` and `lfs-push.sh` share one prologue, `_hooks_off.sh`: every git call
 * of either runs with hooks off, and a PATH `_verifier.sh` refuses is named by the script that
 * sourced it, with that script's own outcome. (Their exit 12, named, is observed in
 * land_feature_commit_test.ts and lfs_push_failures_test.ts.)
 */

const hooksOff = "-c core.hooksPath=/dev/null";
/**
 * The calls neither script makes itself, both reads: base-branch.sh's two, run by both as a child
 * the alias does not reach, and the verifier's probe of git's version (untrusted_git.ts).
 */
const NOT_THEIRS = /^(--no-pager -c core\.fsmonitor=false (symbolic-ref|config --get) |version$)/;

Deno.test(
  "every git call of land-feature.sh and lfs-push.sh runs with hooks off",
  // The shim is a bash script named `git` on PATH; Windows resolves `git.exe` first.
  { ignore: Deno.build.os === "windows" },
  async () => {
    const sb = await lfsBranch();
    try {
      const log = join(sb.root, "git.log");
      // Logs each call as the script made it, `-c` pairs included, and fakes git-lfs.
      const r = await sb.scriptWithGit(
        `printf '%s\\n' "$*" >>'${log}'
all=("$@"); while [ "\${1:-}" = -c ]; do shift 2; done
if [ "$1" = lfs ]; then [ "$2" = version ] && echo git-lfs/3.0.0; exit 0; fi
exec "$REAL_GIT" "\${all[@]}"`,
        "land-feature.sh",
      );
      assertEquals(r.code, 0, r.stderr);
      const seen = await calls(log);
      // Positive control: both scripts' writes went through the shim.
      for (const sub of [" lfs push origin ", " push ", " status --porcelain"]) {
        assert(seen.some((c) => c.includes(sub)), `${sub} never ran:\n${seen.join("\n")}`);
      }
      const hooksOn = seen.filter((c) => !c.includes(hooksOff) && !NOT_THEIRS.test(c));
      assertEquals(hooksOn, []);
    } finally {
      await sb.cleanup();
    }
  },
);

/** `name` run from `cwd` with `first` before the sandbox's PATH. */
function runWith(script: string, cwd: string, first: string) {
  const env = hermetic();
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH")!;
  return run("bash", [script], cwd, { [key]: `${first}${DELIMITER}${env[key]}` });
}

Deno.test("a PATH _verifier.sh refuses is named by the script that ran, with its own outcome", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "feature");
    await sb.commit("f", "x\n", "feat(7): a feature");
    const before = await git(sb.remote, "rev-parse", "main");
    for (const [name, outcome] of [["lfs-push", "pushed"], ["land-feature", "landed"]]) {
      const script = join(sb.work, `.specnaut/scripts/bash/${name}.sh`);
      const relative = await runWith(script, sb.work, "bin");
      assertEquals(relative.code, 13, relative.stderr);
      assertStringIncludes(
        relative.stderr,
        `${name}: VERIFIER REFUSED: PATH entry 'bin' is not an absolute path - start the session` +
          ` from a shell without that entry. Nothing was ${outcome}\n`,
      );
      // Outside every repository: the other refusal.
      const outside = await runWith(script, sb.root, "/");
      assertEquals(outside.code, 13, outside.stderr);
      assertStringIncludes(
        outside.stderr,
        `${name}: VERIFIER REFUSED: specnaut has no repository to be judged outside of - could` +
          ` not judge HEAD, nothing was ${outcome}\n`,
      );
    }
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
  } finally {
    await sb.cleanup();
  }
});
