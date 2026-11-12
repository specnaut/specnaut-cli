import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { MAX_SCRIPT_BYTES } from "../../src/application/script_trust_ports.ts";
import { FsScriptTreeWalker } from "../../src/infrastructure/fs_script_tree_walker.ts";

/**
 * The walker on a real disk, for the entries only POSIX makes cheaply: a link on the way to the
 * folder, a hard link, a FIFO. Each is recorded as what it is; none is followed or opened.
 */

const POSIX = Deno.build.os !== "windows";
const SCRIPT = ".specnaut/scripts/bash/a.sh";

async function project(): Promise<string> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "script-walker-" }));
  await Deno.mkdir(join(root, ".specnaut/scripts/bash"), { recursive: true });
  await Deno.writeTextFile(join(root, SCRIPT), "echo a\n");
  return root;
}

/** The walk, each entry as `kind path`, with its link count for a file. */
async function walk(root: string): Promise<string[] | string> {
  const w = await new FsScriptTreeWalker(root).walk();
  if (w.kind === "blocked") return `blocked ${w.path}: ${w.why}`;
  return w.entries.map((e) => `${e.kind} ${e.path}${e.kind === "file" ? ` ${e.links}` : ""}`);
}

Deno.test({
  name: "a link on the way to the folder stops the walk at that link",
  ignore: !POSIX,
  fn: async () => {
    const real = await project();
    const viaScripts = await Deno.realPath(await Deno.makeTempDir({ prefix: "script-walker-" }));
    await Deno.mkdir(join(viaScripts, ".specnaut"));
    await Deno.symlink(join(real, ".specnaut/scripts"), join(viaScripts, ".specnaut/scripts"));
    assertEquals(await walk(viaScripts), "blocked .specnaut/scripts: a link");

    const viaSpecnaut = await Deno.realPath(await Deno.makeTempDir({ prefix: "script-walker-" }));
    await Deno.symlink(join(real, ".specnaut"), join(viaSpecnaut, ".specnaut"));
    assertEquals(await walk(viaSpecnaut), "blocked .specnaut: a link");

    const folderLink = await project();
    await Deno.symlink(
      join(real, ".specnaut/scripts/bash"),
      join(folderLink, ".specnaut/scripts/b"),
    );
    assertEquals(await walk(folderLink), ["link .specnaut/scripts/b", `file ${SCRIPT} 1`]);
  },
});

Deno.test({
  name: "a file hard-linked from outside the folder is recorded with its link count",
  ignore: !POSIX,
  fn: async () => {
    const root = await project();
    await Deno.link(join(root, SCRIPT), join(root, "elsewhere.sh"));
    assertEquals(await walk(root), [`file ${SCRIPT} 2`]);
  },
});

Deno.test({
  name: "a FIFO is not a regular file, and the walk never opens it",
  ignore: !POSIX,
  fn: async () => {
    const root = await project();
    const fifo = ".specnaut/scripts/bash/pipe";
    const made = await new Deno.Command("mkfifo", { args: [join(root, fifo)] }).output();
    assertEquals(made.code, 0, new TextDecoder().decode(made.stderr));
    assertEquals(await walk(root), [`file ${SCRIPT} 1`, `other ${fifo}`]);
  },
});

Deno.test("a scripts path that is a file, not a folder, stops the walk", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "script-walker-" }));
  await Deno.mkdir(join(root, ".specnaut"));
  await Deno.writeTextFile(join(root, ".specnaut/scripts"), "");
  assertEquals(await walk(root), "blocked .specnaut/scripts: not a folder");
});

Deno.test("no scripts folder is an empty walk", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "script-walker-" }));
  assertEquals(await walk(root), []);
});

Deno.test("a file over the size cap is unreadable, never held whole; one at the cap is read", async () => {
  const root = await project();
  await Deno.writeTextFile(join(root, SCRIPT), "x".repeat(MAX_SCRIPT_BYTES));
  assertEquals(await walk(root), [`file ${SCRIPT} 1`]);
  await Deno.writeTextFile(join(root, SCRIPT), "x".repeat(MAX_SCRIPT_BYTES + 1));
  assertEquals(await walk(root), [`unreadable ${SCRIPT}`]);
});
