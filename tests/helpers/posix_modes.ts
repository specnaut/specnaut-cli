import { join } from "@std/path";

/**
 * Whether this process reads through any POSIX mode, decided by trying at module
 * load, so a test whose fixture needs a folder that refuses it registers
 * `ignore: WINDOWS || RUNS_AS_ROOT`: IGNORED under root, as in a container, never
 * returned from early and reported green. By trying because `Deno.uid` needs a
 * permission the task does not grant.
 */
export const RUNS_AS_ROOT: boolean = await readsThroughModes();

async function readsThroughModes(): Promise<boolean> {
  if (Deno.build.os === "windows") return false;
  const dir = await Deno.makeTempDir({ prefix: "specnaut-mode-probe-" });
  const closed = join(dir, "closed");
  try {
    await Deno.mkdir(closed);
    await Deno.chmod(closed, 0o000);
    return await Deno.readDir(closed)[Symbol.asyncIterator]().next().then(() => true, () => false);
  } finally {
    await Deno.chmod(closed, 0o755);
    await Deno.remove(dir, { recursive: true });
  }
}
