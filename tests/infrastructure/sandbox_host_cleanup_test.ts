import { assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { FsSandboxHost, reopen } from "../../src/infrastructure/fs_sandbox_host.ts";
import type { ChmodRun } from "../../src/infrastructure/fs_sandbox_host.ts";

const posix = Deno.build.os !== "windows";
const modeOf = async (path: string) => (await Deno.lstat(path)).mode! & 0o777;

/** A folder outside the scratch, kept read-only, that a link inside the scratch points at. */
async function outsideFolder(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-outside-" });
  await Deno.chmod(dir, 0o555);
  return dir;
}

async function dropOutside(dir: string): Promise<void> {
  await Deno.chmod(dir, 0o700);
  await Deno.remove(dir, { recursive: true });
}

Deno.test({
  name: "reopen: a link is never followed, whether it is the folder given or an entry in it",
  ignore: !posix,
  fn: async () => {
    const outside = await outsideFolder();
    const dir = await Deno.makeTempDir({ prefix: "specnaut-reopen-" });
    try {
      const locked = join(dir, "locked");
      const deep = join(locked, "deep");
      await Deno.mkdir(deep, { recursive: true });
      await Deno.chmod(deep, 0o000);
      await Deno.chmod(locked, 0o500);
      await Deno.symlink(outside, join(dir, "link"));
      await reopen(dir);
      await reopen(join(dir, "link"));
      assertEquals(await modeOf(locked) & 0o700, 0o700);
      assertEquals(await modeOf(deep) & 0o700, 0o700, "a folder below a closed one is opened too");
      assertEquals(await modeOf(outside), 0o555);
    } finally {
      await Deno.remove(dir, { recursive: true });
      await dropOutside(outside);
    }
  },
});

Deno.test({
  name: "scratch: removal leaves a linked folder outside as it was, and nothing behind",
  ignore: !posix,
  fn: async () => {
    const outside = await outsideFolder();
    const host = new FsSandboxHost("/nowhere", "/home/dev", () => Promise.resolve("/src"));
    const scratch = await host.scratch();
    try {
      const home = join(scratch.path, "home");
      await Deno.mkdir(join(home, "locked"), { recursive: true });
      await Deno.chmod(join(home, "locked"), 0o500);
      await Deno.symlink(outside, join(home, "link"));
      await scratch.remove();
      await assertRejects(() => Deno.lstat(scratch.path), Deno.errors.NotFound);
      assertEquals(await modeOf(outside), 0o555);
      const left: string[] = [];
      for await (const e of Deno.readDir(dirname(scratch.path))) {
        if (e.name.startsWith("specnaut-sandbox-done-")) left.push(e.name);
      }
      assertEquals(left, []);
    } finally {
      await dropOutside(outside);
    }
  },
});

Deno.test("reopen: the walk is the system chmod's, recursive and physical, never one made by path", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-reopen-" });
  const calls: string[][] = [];
  const run: ChmodRun = (args) => {
    calls.push(args);
    return Promise.resolve({ code: 0, stderr: "" });
  };
  try {
    await reopen(dir, run);
    assertEquals(calls, [["-R", "-P", "u+rwx", dir]]);
    const failing: ChmodRun = () => Promise.resolve({ code: 1, stderr: "denied" });
    await assertRejects(() => reopen(dir, failing), Error, "denied");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
