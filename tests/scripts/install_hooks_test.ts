// Regression test for #335: `deno task setup` must work when Specflow
// is checked out as a git submodule (where `.git` is a *gitdir file*
// pointing at the parent repo's `.git/modules/<name>/`, not a directory).
//
// Before #335 the install script hardcoded `<cwd>/.git/hooks/pre-commit`
// and crashed with `NotADirectory: lstat '...'` because `.git` was a
// file. The fix routes the hooks-dir lookup through
// `git rev-parse --git-path hooks`, which returns the correct path in
// both layouts. This test pins the contract by exercising both.

import { assert, assertEquals } from "@std/assert";
import { resolveHooksDir } from "../../scripts/install-hooks.ts";

Deno.test("resolveHooksDir: plain checkout (.git is a directory)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "install-hooks-plain-" });
  try {
    const init = await new Deno.Command("git", {
      args: ["init", "-q"],
      cwd: dir,
    }).output();
    assert(init.success, "git init failed");

    const got = await Deno.realPath(await resolveHooksDir(dir));
    const want = await Deno.realPath(`${dir}/.git/hooks`);
    assertEquals(got, want);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("resolveHooksDir: submodule checkout (.git is a gitdir file)", async () => {
  // Reproduce the submodule layout that surfaced #335: the working copy
  // lives at `host/child/` and its `.git` is a file pointing at the
  // separate gitdir under `host/.git/modules/child/`. `git init
  // --separate-git-dir=...` produces exactly this shape.
  const host = await Deno.makeTempDir({ prefix: "install-hooks-submodule-" });
  try {
    const childDir = `${host}/child`;
    const gitDir = `${host}/.git/modules/child`;
    await Deno.mkdir(childDir, { recursive: true });
    await Deno.mkdir(`${host}/.git/modules`, { recursive: true });

    const init = await new Deno.Command("git", {
      args: ["init", "-q", `--separate-git-dir=${gitDir}`],
      cwd: childDir,
    }).output();
    assert(
      init.success,
      `git init --separate-git-dir failed: ${new TextDecoder().decode(init.stderr)}`,
    );

    const got = await Deno.realPath(await resolveHooksDir(childDir));
    const want = await Deno.realPath(`${gitDir}/hooks`);
    assertEquals(got, want);
  } finally {
    await Deno.remove(host, { recursive: true });
  }
});
