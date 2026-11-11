import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { fixture, git, verify } from "./verify_scripts_fixture.ts";

/**
 * The verify-scripts fixture answers the same on every machine: its git reads no `GIT_*` variable
 * the suite inherits (a hook's `GIT_DIR` would aim every commit at the outer repository), and the
 * CLI it runs reads no global configuration of the developer's.
 */

/** Runs `fn` with `vars` set in this process, then puts every one back as it was. */
async function withEnv(vars: Record<string, string>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(vars)) Deno.env.set(k, v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("the fixture's git ignores a GIT_DIR the suite inherits", async () => {
  const decoy = await Deno.makeTempDir({ prefix: "verify-scripts-decoy-" });
  await withEnv({ GIT_DIR: join(decoy, ".git") }, async () => {
    const { root } = await fixture();
    assertEquals((await git(root, "rev-parse", "--abbrev-ref", "HEAD")).trim(), "feature");
  });
  assertEquals([...Deno.readDirSync(decoy)], [], "the fixture wrote into the inherited GIT_DIR");
});

Deno.test("the CLI the fixture runs reads no global git configuration of the developer's", async () => {
  const home = await Deno.makeTempDir({ prefix: "verify-scripts-dev-home-" });
  await Deno.writeTextFile(join(home, ".gitconfig"), "[init]\n\tdefaultBranch = main\n");
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "verify-scripts-noorigin-" }));
  await git(dir, "init", "-q", "-b", "main");
  await Deno.mkdir(join(dir, ".specnaut"));
  await git(dir, "commit", "-q", "--allow-empty", "-m", "base");
  await withEnv({ HOME: home, XDG_CONFIG_HOME: join(home, ".config") }, async () => {
    const v = await verify(dir);
    assertEquals([v.code, v.lines], [3, ["VERDICT scripts untrusted"]], v.stderr);
  });
});
