import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { execInSandbox } from "../../src/application/sandbox_exec.ts";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import { FsSandboxHost } from "../../src/infrastructure/fs_sandbox_host.ts";

/**
 * The host side of a sandboxed run: the export's scratch copy found by its commit, as real paths;
 * and a private scratch folder removed after the run, even when the run left it hard to remove.
 * The container image: `devcontainer_image_test.ts`.
 */

const SHA = "e".repeat(40);
const posix = Deno.build.os !== "windows";

async function withTemp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-host-" }));
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** A cache folder holding an export of `SHA` and its scratch copy, as the export store makes it. */
async function exportIn(dir: string): Promise<string> {
  const root = join(dir, "cache");
  await Deno.mkdir(join(root, SHA, "scratch"), { recursive: true, mode: 0o700 });
  await Deno.chmod(root, 0o700);
  return root;
}

const hostOver = (root: string, dir: string) =>
  new FsSandboxHost(root, join(dir, "home"), () => Promise.resolve(join(dir, "checkout")));

Deno.test({
  name: "locate: the export's scratch copy, the home and the checkout, as real paths",
  ignore: !posix,
  fn: () =>
    withTemp(async (dir) => {
      const root = await exportIn(dir);
      await Deno.mkdir(join(dir, "home"));
      assertEquals(await hostOver(root, dir).locate(SHA), {
        tree: join(root, SHA, "scratch"),
        home: join(dir, "home"),
        checkout: join(dir, "checkout"),
      });
    }),
});

Deno.test({
  name: "locate: no export of that commit is refused",
  ignore: !posix,
  fn: () =>
    withTemp(async (dir) => {
      const root = await exportIn(dir);
      await Deno.mkdir(join(dir, "home"));
      const other = "f".repeat(40);
      await assertRejects(() => hostOver(root, dir).locate(other), SandboxRefused, other);
      const none = join(dir, "no-cache");
      await assertRejects(() => hostOver(none, dir).locate(SHA), SandboxRefused, SHA);
    }),
});

Deno.test({
  name: "locate: a scratch copy reached through a link is refused",
  ignore: !posix,
  fn: () =>
    withTemp(async (dir) => {
      const root = join(dir, "cache");
      await Deno.mkdir(join(root, SHA), { recursive: true, mode: 0o700 });
      await Deno.mkdir(join(dir, "elsewhere"));
      await Deno.symlink(join(dir, "elsewhere"), join(root, SHA, "scratch"));
      await Deno.mkdir(join(dir, "home"));
      await assertRejects(() => hostOver(root, dir).locate(SHA), SandboxRefused, "link");
    }),
});

Deno.test("locate: only a full commit id names an export", async () => {
  const host = new FsSandboxHost("/nowhere", "/home/dev", () => Promise.resolve("/src"));
  for (const sha of ["abc", "../x", "E".repeat(40)]) {
    await assertRejects(() => host.locate(sha), SandboxRefused, "commit id");
  }
});

Deno.test({
  name: "scratch: a new private folder, removed with what a run left in it, locked or not",
  ignore: !posix,
  fn: async () => {
    const host = new FsSandboxHost("/nowhere", "/home/dev", () => Promise.resolve("/src"));
    const scratch = await host.scratch();
    assertEquals((await Deno.lstat(scratch.path)).mode! & 0o777, 0o700);
    assertEquals(await Deno.realPath(scratch.path), scratch.path);
    const locked = join(scratch.path, "home", "locked");
    await Deno.mkdir(locked, { recursive: true });
    await Deno.writeTextFile(join(locked, "f"), "x");
    await Deno.chmod(locked, 0o500);
    await scratch.remove();
    await assertRejects(() => Deno.lstat(scratch.path), Deno.errors.NotFound);
  },
});

Deno.test({
  name: "real: a --toolchain link to the home or into the checkout is refused, never bound",
  ignore: !posix,
  fn: () =>
    withTemp(async (dir) => {
      const root = await exportIn(dir);
      await Deno.mkdir(join(dir, "home"));
      await Deno.mkdir(join(dir, "checkout", "bin"), { recursive: true });
      await Deno.mkdir(join(dir, "tools"));
      await Deno.symlink(join(dir, "home"), join(dir, "tools", "to-home"));
      await Deno.symlink(join(dir, "checkout", "bin"), join(dir, "tools", "to-checkout"));
      const runs: string[] = [];
      const deps = {
        prober: { probe: () => Promise.resolve(LINUX_BWRAP) },
        host: hostOver(root, dir),
        runnerFor: () => ({ run: () => (runs.push("ran"), Promise.reject(new Error("ran"))) }),
      };
      for (const [link, why] of [["to-home", "holds the home"], ["to-checkout", "overlaps"]]) {
        const toolchain = [join(dir, "tools", link)];
        const result = await execInSandbox(deps, { sha: SHA, toolchain, command: ["make"] });
        assertEquals(result.kind, "not_run", link);
        assert(result.kind === "not_run" && result.why.includes(why), JSON.stringify(result));
      }
      assertEquals(runs, []);
      const missing = [join(dir, "tools", "none")];
      const run = () => execInSandbox(deps, { sha: SHA, toolchain: missing, command: ["make"] });
      await assertRejects(run, SandboxRefused, "none");
    }),
});

const LINUX_BWRAP = {
  os: "linux",
  arch: "x86_64",
  image: { kind: "none", why: "no devcontainer" },
  podman: "absent",
  podmanLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
  docker: false,
  dockerLimits: { memory: true, swap: true, pids: true, cpuQuota: true },
  bwrap: "usable",
  bwrapVersion: "bubblewrap 0.9.0",
  bwrapScope: false,
  sandboxExec: false,
} as const;
