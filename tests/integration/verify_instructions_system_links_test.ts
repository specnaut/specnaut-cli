import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { fixture, git } from "./verify_scripts_fixture.ts";
import { base, lines, NOT_HEAD } from "./verify_instructions_fixture.ts";

/**
 * Git for Windows sets `core.symlinks=false` in its system configuration, which the check's
 * hardened git does not read: there it reads links as on, so the file git wrote for a committed
 * link is named rather than trusted. The check fails closed; it never passes a file it cannot tell
 * from a replacement. Windows only, where that system file is the real one; the test still sets
 * its own, so the case holds whatever the runner's configuration says.
 */

const WINDOWS = Deno.build.os === "windows";

/** git in `cwd`, with no inherited GIT_* variable and `env` laid over; its exit code. */
async function gitCode(cwd: string, env: Record<string, string>, ...args: string[]) {
  const inherited = Object.entries(Deno.env.toObject()).filter(([k]) => !/^GIT_/i.test(k));
  const out = await new Deno.Command("git", {
    args,
    cwd,
    clearEnv: true,
    env: { ...Object.fromEntries(inherited), ...env },
    stdout: "null",
    stderr: "null",
  }).output();
  return out.code;
}

/** A base whose CLAUDE.md is a link to AGENTS.md, committed without making a link on disk. */
async function linkedBase(): Promise<string> {
  const { root } = await fixture({ files: base() });
  await git(root, "checkout", "-q", "main");
  await Deno.writeTextFile(join(root, "..", "target"), "AGENTS.md");
  const blob = (await git(root, "hash-object", "-w", join(root, "..", "target"))).trim();
  await git(root, "update-index", "--add", "--cacheinfo", `120000,${blob},CLAUDE.md`);
  await git(root, "commit", "-q", "-m", "link");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "checkout", "-q", "feature");
  await git(root, "merge", "-q", "--ff-only", "main");
  return root;
}

Deno.test({
  name: WINDOWS
    ? "a link checked out as text by core.symlinks=false in the system config only is named"
    : "a link checked out as text by core.symlinks=false in the system config only is named " +
      "(skipped: runs on Windows, whose git sets core.symlinks in its system config)",
  ignore: !WINDOWS,
  fn: async () => {
    const root = await linkedBase();
    const system = join(root, "..", "system.gitconfig");
    await Deno.writeTextFile(system, "[core]\n\tsymlinks = false\n");
    // `git init` on Windows may write core.symlinks into the repository: only the system file says.
    const unset = await gitCode(root, {}, "config", "--unset-all", "core.symlinks");
    // Exit 5 is git's "not set", the usual answer off Windows.
    assertEquals([0, 5].includes(unset), true, `git config --unset-all: exit ${unset}`);
    await Deno.remove(join(root, "CLAUDE.md"));
    const empty = join(root, "..", "global.gitconfig");
    await Deno.writeTextFile(empty, "");
    const only = { GIT_CONFIG_SYSTEM: system, GIT_CONFIG_GLOBAL: empty };
    assertEquals(await gitCode(root, only, "checkout", "--", "CLAUDE.md"), 0, "checkout failed");
    const written = await Deno.lstat(join(root, "CLAUDE.md"));
    assertEquals(written.isFile, true, "git did not read the system file: it wrote a link");
    assertEquals(await Deno.readTextFile(join(root, "CLAUDE.md")), "AGENTS.md");
    assertEquals(await lines(root), [`VERDICT instructions untrusted CLAUDE.md ${NOT_HEAD}`]);
  },
});
