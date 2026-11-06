import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import {
  advanceBase,
  bundled,
  commitAll,
  fixture,
  git,
  GIT_READ,
  LOCK,
  RATCHET,
  verify,
  write,
} from "./verify_scripts_fixture.ts";

/**
 * `specnaut verify-scripts` black-box: the output contract (BASE, BASE_TIP, BASE_BRANCH,
 * NAMES_FILE, UNTRUSTED lines, a final VERDICT) and its exits, on real repositories.
 */

const POSIX = Deno.build.os !== "windows";
const SHA = /^[0-9a-f]{40}$/;

Deno.test("a branch that leaves the helpers alone is trusted, and every field is printed", async () => {
  const { root } = await fixture();
  await write(root, { "src/a.ts": "x\n" });
  await commitAll(root, "work");
  const v = await verify(root);
  assertEquals([v.code, v.lines.at(-1)], [0, "VERDICT scripts trusted"], v.stderr);
  assertMatch(v.field("BASE")!, SHA);
  assertEquals(v.field("BASE_TIP"), v.field("BASE"));
  assertEquals(v.field("BASE_BRANCH"), "main");
  assertEquals(await Deno.readTextFile(v.field("NAMES_FILE")!), "src/a.ts\n");
  assertEquals(v.field("NAMES_FILE")!.startsWith(root), false, "NAMES_FILE is inside the repo");
});

Deno.test("a branch that edits a helper is untrusted, names it, and still prints its fields", async () => {
  const { root } = await fixture();
  await write(root, { [GIT_READ]: "#!/usr/bin/env bash\necho edited\n" });
  await commitAll(root, "edit");
  const v = await verify(root);
  assertEquals([v.code, v.lines.at(-1)], [1, "VERDICT scripts untrusted"], v.stderr);
  assertEquals(v.untrusted, [`${GIT_READ} differs from base`]);
  assertMatch(v.field("BASE")!, SHA);
  assertEquals(await Deno.readTextFile(v.field("NAMES_FILE")!), `${GIT_READ}\n`);
});

Deno.test("an uncommitted edit in the work tree is untrusted too: the bytes on disk are judged", async () => {
  const { root } = await fixture();
  await write(root, { [GIT_READ]: "echo dirty\n" });
  assertEquals((await verify(root)).untrusted, [`${GIT_READ} differs from base`]);
});

Deno.test("a script the base customised is trusted on a branch that leaves it alone", async () => {
  const custom = "#!/usr/bin/env bash\necho the project's own copy\n";
  const { root } = await fixture({
    files: {
      ".specnaut/installed.lock": LOCK,
      [GIT_READ]: custom,
    },
  });
  assertEquals((await verify(root)).code, 0);
});

Deno.test("an upgrade branch writing the bundled copies over older ones is trusted", async () => {
  const { root } = await fixture({
    files: { ".specnaut/installed.lock": LOCK, [GIT_READ]: "old\n" },
  });
  await write(root, { [GIT_READ]: bundled(GIT_READ), [RATCHET]: bundled(RATCHET) });
  await commitAll(root, "upgrade");
  const v = await verify(root);
  assertEquals([v.code, v.untrusted], [0, []], v.stderr);
});

Deno.test("a copy behind a base that moved is untrusted until the branch rebases", async () => {
  const custom = { ".specnaut/installed.lock": LOCK, [GIT_READ]: "echo the project's copy\n" };
  const { root } = await fixture({ files: custom });
  await git(root, "fetch", "-q", "origin");
  await advanceBase(root, { [GIT_READ]: "echo newer on base\n" });
  assertEquals((await verify(root)).untrusted, [`${GIT_READ} behind base: rebase`]);
  await git(root, "rebase", "-q", "origin/main");
  assertEquals((await verify(root)).code, 0);
});

Deno.test({
  name: "a link in the folder is untrusted, never followed",
  ignore: !POSIX,
  fn: async () => {
    const { root } = await fixture();
    await Deno.remove(join(root, GIT_READ));
    await Deno.symlink("/bin/sh", join(root, GIT_READ));
    assertEquals((await verify(root)).untrusted, [`${GIT_READ} a link`]);
  },
});

Deno.test("a local main holding commits origin lacks is untrusted", async () => {
  const { root } = await fixture();
  await git(root, "checkout", "-q", "main");
  await write(root, { "b.txt": "b\n" });
  await commitAll(root, "local only");
  await git(root, "checkout", "-q", "feature");
  const v = await verify(root);
  assertEquals([v.code, v.untrusted], [1, ["refs/heads/main local main ahead of origin"]]);
});

Deno.test("a project in a folder under the repository's top is judged at its own path", async () => {
  const { root, project } = await fixture({ prefix: "app" });
  await write(project, { [GIT_READ]: "echo edited\n" });
  await commitAll(root, "edit");
  const v = await verify(project);
  assertEquals(v.untrusted, [`${GIT_READ} differs from base`]);
  assertEquals(await Deno.readTextFile(v.field("NAMES_FILE")!), `app/${GIT_READ}\n`);
});

Deno.test("no base it can name: exit 3, and the last line is still untrusted", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "verify-scripts-loose-" }));
  await git(dir, "init", "-q");
  await Deno.mkdir(join(dir, ".specnaut"));
  const home = await Deno.makeTempDir({ prefix: "verify-scripts-home-" });
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
  const v = await verify(dir, env);
  assertEquals([v.code, v.lines], [3, ["VERDICT scripts untrusted"]], v.stderr);
  assertMatch(v.stderr, /the base is unknown: no origin\/HEAD and no global init\.defaultBranch/);
});

Deno.test("run outside a project: exit 2", async () => {
  const dir = await Deno.makeTempDir({ prefix: "verify-scripts-none-" });
  assertEquals((await verify(dir)).code, 2);
});

Deno.test("the reader names no subcommand that reads the work tree through git", async () => {
  const src = await Deno.readTextFile(
    new URL("../../src/infrastructure/git_object_reader.ts", import.meta.url),
  );
  const code = src.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  for (const word of ['"hash-object"', '"status"', '"diff"', '"--filters"', '"--textconv"']) {
    assertEquals(code.includes(word), false, `git_object_reader.ts runs ${word}`);
  }
});
