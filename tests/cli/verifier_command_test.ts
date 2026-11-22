import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { inProject, tempFileWriter } from "../../src/cli/handlers/verifier_command.ts";

/**
 * `verify-scripts` and `record-approvals` share their exits 2 and 3 and their temp-file writer:
 * each is checked once, here, so neither handler can drift from the other.
 */

/** Runs `check` through `inProject` in `cwd`, recording each refusal. */
async function run(cwd: string, check: () => Promise<number>) {
  const said: [number, string][] = [];
  const code = await inProject(cwd, (c, why) => (said.push([c, why]), c), check);
  return { code, said };
}

Deno.test("a folder with no .specnaut/ is exit 2, and the check never runs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    let ran = false;
    const r = await run(dir, () => (ran = true, Promise.resolve(0)));
    assertEquals([r.code, ran], [2, false]);
    assertEquals(r.said, [[2, "no .specnaut/ here: run it from the project's root"]]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a throw from the check is exit 3, naming it; its own exit passes through", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(dir, ".specnaut"));
    const thrown = await run(dir, () => Promise.reject(new Error("git could not start")));
    assertEquals(thrown.said, [[3, "the check could not run: git could not start"]]);
    assertEquals([thrown.code, (await run(dir, () => Promise.resolve(1))).code], [3, 1]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the writer leaves the text in a new file named with its prefix", async () => {
  const path = await tempFileWriter("specnaut-test-")("one\ntwo\n");
  try {
    assertEquals(path.split(/[\\/]/).at(-1)?.startsWith("specnaut-test-"), true);
    assertEquals(await Deno.readTextFile(path), "one\ntwo\n");
  } finally {
    await Deno.remove(path);
  }
});
