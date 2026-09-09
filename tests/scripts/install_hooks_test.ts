// Regression test for #335: `deno task setup` must work when Specnaut
// is checked out as a git submodule (where `.git` is a *gitdir file*
// pointing at the parent repo's `.git/modules/<name>/`, not a directory).
//
// Before #335 the install script hardcoded `<cwd>/.git/hooks/pre-commit`
// and crashed with `NotADirectory: lstat '...'` because `.git` was a
// file. The fix routes the hooks-dir lookup through
// `git rev-parse --git-path hooks`, which returns the correct path in
// both layouts. This test pins the contract by exercising both.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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

// ─────────────────────────────── #591 ───────────────────────────────
//
// The hook was installed as an ABSOLUTE symlink, so the link text was the path
// the checkout occupied at install time. Rename the directory and it dangles —
// and git `stat()`s through a symlink, so a dangling hook reads as no hook.
// Commits kept succeeding with none of the four gates run, and nothing said so.
//
// Then `main()` refused to repair the state it had created: a link pointing at
// nothing was treated exactly like a hand-written hook that must not be
// clobbered.

import { classifyHook, installPreCommitHook, SHIM_MARKER } from "../../scripts/install-hooks.ts";

/** A git repo with a `hooks/pre-commit` that leaves a marker only it can leave. */
async function fakeRepo(
  opts: { hook?: string | null } = {},
): Promise<{ dir: string; marker: string }> {
  const dir = await Deno.makeTempDir({ prefix: "install-hooks-591-" });
  const init = await new Deno.Command("git", { args: ["init", "-q"], cwd: dir }).output();
  assert(init.success, "git init failed");
  const marker = "HOOK-RAN";
  if (opts.hook !== null) {
    await Deno.mkdir(`${dir}/hooks`, { recursive: true });
    // The marker is written next to the repo, not inside it, so moving the
    // checkout does not carry an old marker along and make a dead hook look
    // alive. A negative assertion satisfied by the wrong thing is the failure
    // this whole ticket is about.
    await Deno.writeTextFile(
      `${dir}/hooks/pre-commit`,
      opts.hook ??
        `#!/usr/bin/env bash\nprintf '%s' "${marker}" > "$(git rev-parse --show-toplevel)/../ran.txt"\n`,
    );
    await Deno.chmod(`${dir}/hooks/pre-commit`, 0o755);
  }
  return { dir, marker };
}

async function commit(cwd: string, msg: string): Promise<{ code: number; err: string }> {
  await Deno.writeTextFile(`${cwd}/file-${crypto.randomUUID()}.txt`, "x\n");
  await new Deno.Command("git", { args: ["add", "-A"], cwd }).output();
  const out = await new Deno.Command("git", {
    args: [
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=T",
      "commit",
      "-q",
      "-m",
      msg,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}

/**
 * Three tests below drive a real `git commit` and assert on whether the hook
 * FIRED. That exercises git's own hook spawning, not this installer, and
 * git-for-Windows does not spawn a `#!`-script hook the way a POSIX git does —
 * on the Windows runner it reports `cannot spawn .git/hooks/pre-commit: No such
 * file or directory` for a file that is plainly there.
 *
 * They are skipped there deliberately and named as skipped, rather than
 * softened into something that passes everywhere by asserting less. This suite
 * does not claim Windows hook execution; it claims the installer's decisions,
 * and those are covered on every platform by the tests that do not spawn.
 */
const SPAWNS_HOOKS = Deno.build.os !== "windows";

Deno.test("install: a dangling symlink is repaired, not reported as a foreign hook", async () => {
  const { dir } = await fakeRepo();
  try {
    await Deno.symlink(`${dir}/gone/pre-commit`, `${dir}/.git/hooks/pre-commit`);

    const state = await classifyHook(
      `${dir}/.git/hooks/pre-commit`,
      `${dir}/hooks/pre-commit`,
    );
    assertEquals(state.kind, "legacy-symlink", `classified as ${state.kind}`);

    const r = await installPreCommitHook(dir);
    assert(r.ok, `a dangling link was refused:\n${r.lines.join("\n")}`);
    const said = r.lines.join("\n");
    assert(
      !said.includes("was not installed by this script"),
      `a link pointing at nothing was treated as someone else's hook:\n${said}`,
    );
    assertStringIncludes(said, "dangling");
    // It must name what failed to resolve — "repaired something" is not a report.
    assertStringIncludes(said, `${dir}/gone/pre-commit`);
    assertStringIncludes(await Deno.readTextFile(`${dir}/.git/hooks/pre-commit`), SHIM_MARKER);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("install: a hand-written hook is still refused", async () => {
  const { dir } = await fakeRepo();
  try {
    await Deno.writeTextFile(`${dir}/.git/hooks/pre-commit`, "#!/bin/sh\necho mine\n");
    const r = await installPreCommitHook(dir);
    assert(!r.ok, "someone else's hook was overwritten");
    assertEquals(r.code, 2);
    assertStringIncludes(r.lines.join("\n"), "Back it up and re-run");
    assertEquals(await Deno.readTextFile(`${dir}/.git/hooks/pre-commit`), "#!/bin/sh\necho mine\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("install: a foreign symlink that RESOLVES is still refused", async () => {
  // The repair above keys on the link pointing at nothing. A working symlink to
  // somebody else's hook is a deliberate setup and stays untouched — otherwise
  // "repair dangling links" would have quietly become "take over the hook".
  const { dir } = await fakeRepo();
  try {
    await Deno.writeTextFile(`${dir}/theirs.sh`, "#!/bin/sh\nexit 0\n");
    await Deno.symlink(`${dir}/theirs.sh`, `${dir}/.git/hooks/pre-commit`);
    const r = await installPreCommitHook(dir);
    assert(!r.ok, "a working third-party hook was replaced");
    assertEquals(r.code, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("install: the old absolute symlink is upgraded in place", async () => {
  const { dir } = await fakeRepo();
  try {
    await Deno.symlink(`${dir}/hooks/pre-commit`, `${dir}/.git/hooks/pre-commit`);
    const r = await installPreCommitHook(dir);
    assert(r.ok, r.lines.join("\n"));
    assertStringIncludes(r.lines.join("\n"), "old absolute symlink");
    const info = await Deno.lstat(`${dir}/.git/hooks/pre-commit`);
    assert(!info.isSymlink, "it is still a symlink, so it still dies on a move");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("install: a repo with no hook to run is a failure, not a checkmark", async () => {
  // The condition #591 is about, stated as an assertion: the script must report
  // what is true after it runs, not that it finished writing a file.
  const { dir } = await fakeRepo({ hook: null });
  try {
    const r = await installPreCommitHook(dir);
    assert(!r.ok, `an unrunnable install reported success:\n${r.lines.join("\n")}`);
    assertStringIncludes(r.lines.join("\n"), "missing");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "install: the hook survives a move of the checkout",
  ignore: !SPAWNS_HOOKS,
  async fn() {
    // The acceptance criterion, and the reason the mechanism changed at all.
    const { dir, marker } = await fakeRepo();
    const moved = `${dir}-moved`;
    try {
      const r = await installPreCommitHook(dir);
      assert(r.ok, r.lines.join("\n"));

      const before = await commit(dir, "before the move");
      assertEquals(before.code, 0, before.err);
      assertEquals(await Deno.readTextFile(`${dir}/../ran.txt`), marker);
      await Deno.remove(`${dir}/../ran.txt`);

      await Deno.rename(dir, moved);

      // No second `deno task setup`. That is the whole point.
      const after = await commit(moved, "after the move");
      assertEquals(after.code, 0, after.err);
      assertEquals(
        await Deno.readTextFile(`${moved}/../ran.txt`),
        marker,
        "the hook did not run after the checkout moved",
      );
    } finally {
      for (const d of [dir, moved]) {
        await Deno.remove(d, { recursive: true }).catch(() => {});
      }
      await Deno.remove(`${dir}/../ran.txt`).catch(() => {});
    }
  },
});

Deno.test({
  name: "install: the mechanism it replaced does NOT survive a move",
  ignore: !SPAWNS_HOOKS,
  async fn() {
    // The control. Without it, the test above passes for any mechanism at all and
    // proves nothing about the one that failed — including the possibility that
    // git was running no hook in either case.
    const { dir, marker } = await fakeRepo();
    const moved = `${dir}-oldmoved`;
    try {
      await Deno.symlink(`${dir}/hooks/pre-commit`, `${dir}/.git/hooks/pre-commit`);

      const before = await commit(dir, "before the move");
      assertEquals(before.code, 0, before.err);
      assertEquals(
        await Deno.readTextFile(`${dir}/../ran.txt`),
        marker,
        "the absolute symlink did not fire even before moving — the probe is dead",
      );
      await Deno.remove(`${dir}/../ran.txt`);

      await Deno.rename(dir, moved);

      const after = await commit(moved, "after the move");
      assertEquals(after.code, 0, `${after.err}`);
      let ran = false;
      try {
        await Deno.stat(`${moved}/../ran.txt`);
        ran = true;
      } catch { /* the hook was skipped, which is the defect */ }
      assert(!ran, "the absolute symlink survived a move — #591's premise is wrong");
    } finally {
      for (const d of [dir, moved]) {
        await Deno.remove(d, { recursive: true }).catch(() => {});
      }
      await Deno.remove(`${dir}/../ran.txt`).catch(() => {});
    }
  },
});

Deno.test({
  name: "install: the shim fails closed when the hook disappears",
  ignore: !SPAWNS_HOOKS,
  async fn() {
    // A shim that exec'd nothing and exited 0 would reproduce the defect one
    // layer in: the commit passes because no check ran.
    const { dir } = await fakeRepo();
    try {
      const r = await installPreCommitHook(dir);
      assert(r.ok, r.lines.join("\n"));
      await Deno.remove(`${dir}/hooks/pre-commit`);

      const c = await commit(dir, "with the hook body gone");
      assert(c.code !== 0, "a commit passed with no hook body to run");
      assertStringIncludes(c.err, "broken install, not a pass");
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test("install: a shim from an older version is refreshed, not called already-installed", async () => {
  // The marker says "ours". It does not say "current". A check that stopped at
  // the marker would report `✓ already installed` over a shim written by an
  // older version forever — the same shape as refusing to repair a link this
  // script had itself installed, which is the other half of #591.
  const { dir } = await fakeRepo();
  try {
    await Deno.writeTextFile(
      `${dir}/.git/hooks/pre-commit`,
      `#!/usr/bin/env bash\n# ${SHIM_MARKER} — from an older version\nexit 0\n`,
    );
    const r = await installPreCommitHook(dir);
    assert(r.ok, r.lines.join("\n"));
    assertStringIncludes(r.lines.join("\n"), "older version");
    const now = await Deno.readTextFile(`${dir}/.git/hooks/pre-commit`);
    assertStringIncludes(now, "hooks/pre-commit");
    assert(!now.includes("from an older version"), "the stale shim was left in place");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
