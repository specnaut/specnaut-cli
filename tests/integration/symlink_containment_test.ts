import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function box(): Promise<{ root: string; proj: string; outside: string }> {
  const root = await Deno.makeTempDir({ prefix: "e2e-containment-" });
  const proj = join(root, "proj");
  const outside = join(root, "outside");
  await Deno.mkdir(proj);
  await Deno.mkdir(outside);
  return { root, proj, outside };
}

/**
 * The two escapes whose damage is only visible from outside the process
 * (cli#574): one destroys a file, the other puts one on stdout. Both are
 * asserted against the REAL binary, because both were found by running it.
 */

Deno.test({
  name: "a repository that ships a symlinked .specflow cannot redirect init",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    // The foothold. `.specnaut/` would have become a symlink pointing outside
    // the project, and the lock, the marker, the preserve list and the spec
    // cache's recursive delete would all have written through it for the rest
    // of the run.
    const { root, proj, outside } = await box();
    try {
      await Deno.writeTextFile(join(outside, "precious.md"), "PRECIOUS");
      await Deno.symlink(outside, join(proj, ".specflow"));

      const r = await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
        { cwd: proj },
      );

      assert(r.code !== 0, `init must refuse, got exit 0:\n${r.stdout}`);
      // The MIGRATOR's wording, not merely the word "symlink". With the
      // migrator's `lstat` reverted this test still passed, because a later
      // guard caught the escape and its message also contains "symlink" — so
      // the assertion was green for the wrong reason. Defence in depth is why
      // nothing leaked; it is not why this assertion should pass.
      assert(
        (r.stdout + r.stderr).includes(".specflow is a symlink"),
        `the refusal must come from the migrator, before anything runs:\n${r.stdout}${r.stderr}`,
      );
      assertEquals(
        await Deno.readTextFile(join(outside, "precious.md")),
        "PRECIOUS",
        "nothing outside the project may be touched",
      );
      assertEquals(
        await Deno.stat(join(outside, "scripts")).then(() => true).catch(() => false),
        false,
        "and nothing may be scaffolded there",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: "specnaut diff never prints the contents of a file outside the project",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    // The exfiltration primitive, end to end. Measured before the fix: the
    // secret's lines appeared in the unified diff on stdout. This CLI's stdout
    // is routinely read into a coding agent's context and into CI logs, which
    // is why this is not a local-only outcome.
    const { root, proj, outside } = await box();
    try {
      const canary = "CANARY-8f21-DO-NOT-PRINT";
      await Deno.writeTextFile(join(outside, "secret.txt"), `${canary}\nsecond line\n`);

      const init = await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
        { cwd: proj },
      );
      assertEquals(init.code, 0, init.stderr);

      // A real bundle destination, so the diff classifies it `differs` and
      // renders BOTH blobs — an orphan lock key would only ever be reported by
      // name, which is a weaker case and would pass against a broken fix.
      const dest = join(proj, ".claude/CLAUDE.md");
      await Deno.remove(dest);
      await Deno.symlink(join(outside, "secret.txt"), dest);

      const r = await runSpecnaut(["diff"], { cwd: proj });
      assert(
        !(r.stdout + r.stderr).includes(canary),
        `the outside file's contents must not reach stdout:\n${r.stdout}`,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: "specnaut diff reports a dangling .claude link instead of aborting (cli#686)",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    // A writer refuses a path through a missing directory; a reader has nothing
    // to read there and must say "absent", not abort the user's `diff`.
    const { root, proj } = await box();
    try {
      const init = await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
        { cwd: proj },
      );
      assertEquals(init.code, 0, init.stderr);
      await Deno.remove(join(proj, ".claude"), { recursive: true });
      await Deno.symlink("nope", join(proj, ".claude"));

      const r = await runSpecnaut(["diff"], { cwd: proj });
      assertEquals(r.code, 0, r.stderr);
      assert(!r.stderr.includes("refusing"), r.stderr);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
