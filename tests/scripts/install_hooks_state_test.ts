import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { SHIM_MARKER, shimContent } from "../../scripts/install-hooks-shim.ts";
import { installPreCommitHook } from "../../scripts/install-hooks.ts";
import { classifyHook, installProblems } from "../../scripts/install-hooks-state.ts";

/**
 * What the installer reads at the hook target before it writes (`classifyHook`), and after
 * (`installProblems`). The install itself, end to end: `install_hooks_test.ts`.
 */

async function withFolder(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "install-hooks-state-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** `p` with Windows' separators read as `/`: a link's text is compared, not its spelling. */
const slash = (p: string) => p.replaceAll("\\", "/");

/** The state at `target`, a link's text read with `slash`. */
async function classified(target: string, source: string) {
  const state = await classifyHook(target, source);
  return state.kind === "legacy-symlink" ? { ...state, link: slash(state.link) } : state;
}

/** A hook at `dir/hook`, runnable. */
async function hookIn(dir: string): Promise<string> {
  const source = join(dir, "hook");
  await Deno.writeTextFile(source, "#!/bin/sh\nexit 0\n");
  await Deno.chmod(source, 0o755);
  return source;
}

Deno.test("hook state: nothing, the current shim and an older shim at the target", () =>
  withFolder(async (dir) => {
    const target = join(dir, "pre-commit");
    assertEquals(await classifyHook(target, "unused"), { kind: "absent" });
    await Deno.writeTextFile(target, shimContent());
    assertEquals(await classifyHook(target, "unused"), { kind: "ours-shim", current: true });
    await Deno.writeTextFile(target, `#!/bin/sh\n# ${SHIM_MARKER}, an older text\n`);
    assertEquals(await classifyHook(target, "unused"), { kind: "ours-shim", current: false });
  }));

Deno.test("hook state: a link dangling or naming the hook is stale; any other is foreign", () =>
  withFolder(async (dir) => {
    const [source, target] = [await hookIn(dir), join(dir, "pre-commit")];
    const gone = join(dir, "gone");
    await Deno.symlink(gone, target, { type: "file" });
    const dangling = { kind: "legacy-symlink", link: slash(gone), dangling: true } as const;
    assertEquals(await classified(target, source), dangling);
    await Deno.remove(target);
    await Deno.symlink(source, target, { type: "file" });
    const old = { kind: "legacy-symlink", link: slash(source), dangling: false } as const;
    assertEquals(await classified(target, source), old);
    const other = join(dir, "theirs");
    const state = await classifyHook(target, other);
    assertEquals(state.kind === "foreign" && slash(state.detail), `a symlink to ${slash(source)}`);
  }));

Deno.test("hook state: a file this script did not write is foreign", () =>
  withFolder(async (dir) => {
    const target = join(dir, "pre-commit");
    await Deno.writeTextFile(target, "#!/bin/sh\necho mine\n");
    const foreign = {
      kind: "foreign",
      detail: "a regular file this script did not write",
    } as const;
    assertEquals(await classifyHook(target, "unused"), foreign);
  }));

Deno.test("hook state: an install is runnable only with both the shim and the hook there", () =>
  withFolder(async (dir) => {
    const [source, target] = [await hookIn(dir), join(dir, "pre-commit")];
    assertEquals(await installProblems(target, source), [
      `${target} is not there after writing it`,
    ]);
    await Deno.writeTextFile(target, shimContent());
    await Deno.chmod(target, 0o755);
    assertEquals(await installProblems(target, source), []);
    const missing = join(dir, "missing");
    const said = [`the hook it resolves to is missing: ${missing}`];
    assertEquals(await installProblems(target, missing), said);
  }));

Deno.test({
  name: "hook state: a shim or a hook without its executable bit cannot run",
  // Windows has no executable bit: `isExecutable` answers yes there (`install-hooks-state.ts`).
  ignore: Deno.build.os === "windows",
  fn: () =>
    withFolder(async (dir) => {
      const [source, target] = [await hookIn(dir), join(dir, "pre-commit")];
      await Deno.writeTextFile(target, shimContent());
      await Deno.chmod(target, 0o644);
      await Deno.chmod(source, 0o644);
      assertEquals(await installProblems(target, source), [
        `${target} is not executable`,
        `the hook it resolves to is not executable: ${source}`,
      ]);
    }),
});

/** No permission bits to take away on Windows, and none that bind root. */
const PERMISSIONS_BIND = Deno.build.os !== "windows" && Deno.env.get("USER") !== "root";

Deno.test({
  name: "hook state: a link that cannot be followed for another reason than absence is kept",
  ignore: !PERMISSIONS_BIND,
  fn: () =>
    withFolder(async (dir) => {
      assert((await new Deno.Command("git", { args: ["init", "-q", dir] }).output()).success);
      const [locked, target] = [join(dir, "locked"), join(dir, ".git", "hooks", "pre-commit")];
      await Deno.mkdir(locked);
      await Deno.mkdir(join(dir, ".git", "hooks"), { recursive: true });
      await Deno.symlink(join(locked, "hook"), target);
      await Deno.chmod(locked, 0o000);
      try {
        await assertRejects(() => classifyHook(target, "unused"), Deno.errors.PermissionDenied);
        await assertRejects(() => installPreCommitHook(dir), Deno.errors.PermissionDenied);
        assert((await Deno.lstat(target)).isSymlink, "a link that may not dangle was deleted");
      } finally {
        await Deno.chmod(locked, 0o755);
      }
    }),
});

Deno.test({
  name: "hook state: a hook file that cannot be read is an error, not a foreign hook",
  ignore: !PERMISSIONS_BIND,
  fn: () =>
    withFolder(async (dir) => {
      const target = join(dir, "pre-commit");
      await Deno.writeTextFile(target, shimContent());
      await Deno.chmod(target, 0o000);
      await assertRejects(() => classifyHook(target, "unused"), Deno.errors.PermissionDenied);
    }),
});
