import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import { within } from "../../src/domain/sandbox_paths.ts";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { HdiutilVolumes } from "../../src/infrastructure/sandbox_scratch_volume.ts";
import { POSIX } from "./sandbox_runner_fixture.ts";

/**
 * The scratch cap on macOS: a sparse APFS image of the cap's size, made in a private folder of its
 * own, attached on the scratch folder with its owners honoured, and detached and deleted after the
 * run. One that cannot be made, attached or found mounted refuses the run, and leaves nothing.
 */

const HDIUTIL = "/usr/bin/hdiutil";
const MIB = 1024 ** 2;

/** How one hdiutil call ends: its exit code and what it wrote to its standard error. */
type End = { readonly code: number; readonly stderr?: string };

/**
 * A launcher standing in for hdiutil: each call ends as the next of `ends[<verb>]` says (a detach
 * forced is `detach -force`), else with 0; `missing` makes every start throw.
 */
function hdiutil(ends: Record<string, End[]> = {}, missing = false) {
  const calls: string[][] = [];
  const synced: string[][] = [];
  const launcher: ProcessLauncher = {
    start(spec) {
      if (missing) throw new Deno.errors.NotFound(`no ${spec.cmd}`);
      calls.push([spec.cmd, ...spec.args]);
      const verb = spec.args.includes("-force") ? `${spec.args[0]} -force` : spec.args[0];
      const end = ends[verb]?.shift() ?? { code: 0 };
      const ended = Promise.resolve(end.code);
      const stderr = Promise.resolve(end.stderr ?? "");
      return { pid: 1, ended, exited: ended, stderr, stop() {}, release() {} };
    },
    runSync(spec) {
      synced.push([spec.cmd, ...spec.args]);
      return 0;
    },
  };
  return { launcher, calls, synced };
}

/**
 * A host whose mount point is mounted as `state.mounted` answers, in turn, the last answer kept;
 * its exit traps are kept, not armed.
 */
function host(mounted: boolean) {
  const state = { mounted: [mounted], disarmed: 0 };
  const traps: (() => void)[] = [];
  const answer = () => state.mounted.length > 1 ? state.mounted.shift()! : state.mounted[0];
  const volumeHost = {
    mounted: () => Promise.resolve(answer()),
    arm: (cleanup: () => void) => {
      traps.push(cleanup);
      return () => void state.disarmed++;
    },
  };
  return { volumeHost, traps, state };
}

/** The image folder the create call named: the parent of the image's base name. */
const imageFolder = (calls: string[][]) => dirname(calls[0].at(-1)!);

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/** `fn` given a real, empty folder to mount on, open to all at first, removed after it. */
async function onMount(fn: (mount: string) => Promise<void>): Promise<void> {
  const mount = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-mount-" }));
  await Deno.chmod(mount, 0o755);
  try {
    await fn(mount);
  } finally {
    await Deno.remove(mount, { recursive: true });
  }
}

const test = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name: `HdiutilVolumes: ${name}`, ignore: !POSIX, fn });

test("a sparse APFS image of the cap, attached on the mount, owners honoured, unbrowsed", () =>
  onMount(async (mount) => {
    const { launcher, calls } = hdiutil();
    const volume = await new HdiutilVolumes(launcher, host(true).volumeHost).attach(mount, 8 * MIB);
    const folder = imageFolder(calls);
    try {
      assertEquals(calls, [
        [HDIUTIL, "create", "-size", "8m", "-type", "SPARSE", "-fs", "APFS"]
          .concat(["-volname", "specnaut-scratch", join(folder, "scratch")]),
        [HDIUTIL, "attach", "-owners", "on", "-nobrowse", "-noautoopen", "-mountpoint", mount]
          .concat([join(folder, "scratch.sparseimage")]),
      ]);
      assert(!within(folder, mount) && !within(mount, folder), "the image is in its own folder");
      assertEquals(Deno.statSync(folder).mode! & 0o777, 0o700);
      // Its root is the user's alone, as the scratch folder it is mounted on was.
      assertEquals(Deno.statSync(mount).mode! & 0o777, 0o700);
    } finally {
      await volume.detach();
    }
  }));

test("a cap that is not a whole number of MiB is rounded up, never down", () =>
  onMount(async (mount) => {
    const { launcher, calls } = hdiutil();
    const volumes = new HdiutilVolumes(launcher, host(true).volumeHost);
    await (await volumes.attach(mount, 8 * MIB + 1)).detach();
    assertEquals(calls[0].slice(2, 4), ["-size", "9m"]);
  }));

type Failing = { ends?: Record<string, End[]>; missing?: boolean; mounted?: boolean };

/**
 * Asserts an attach whose hdiutil ends as `ends` say (or is `missing`), on a host where the mount
 * is `mounted` after it, refuses the run naming `why`, and leaves no image and no trap.
 */
async function assertRefused(why: string, { ends = {}, missing, mounted = true }: Failing) {
  await onMount(async (mount) => {
    const { launcher, calls } = hdiutil(ends, missing);
    const { volumeHost, state } = host(mounted);
    const volumes = new HdiutilVolumes(launcher, volumeHost);
    await assertRejects(() => volumes.attach(mount, 8 * MIB), SandboxRefused, why);
    if (calls.length > 0) assert(!exists(imageFolder(calls)), "the image folder is left");
    assertEquals(state.disarmed, 1, "the exit trap is left armed");
  });
}

test("an image that cannot be made refuses the run, with what hdiutil said", () =>
  assertRefused("hdiutil create exited 1: no room", {
    ends: { create: [{ code: 1, stderr: "no room" }] },
  }));

test("an image that cannot be attached refuses the run, and is deleted", () =>
  assertRefused("hdiutil attach exited 1: busy", {
    ends: { attach: [{ code: 1, stderr: "busy\n" }] },
  }));

test("an attach that leaves nothing mounted on the scratch refuses the run", () =>
  assertRefused("is not mounted on", { mounted: false }));

test("a missing hdiutil refuses the run", () =>
  assertRefused("could not start", { missing: true, mounted: false }));

/**
 * An attached volume on a fresh mount whose detaches end as `ends` say, the mount then mounted as
 * `mounted` answers in turn.
 */
async function detaching(ends: Record<string, End[]>, mounted: boolean[]) {
  const mount = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-mount-" }));
  const { launcher, calls, synced } = hdiutil(ends);
  const { volumeHost, traps, state } = host(true);
  const volume = await new HdiutilVolumes(launcher, volumeHost).attach(mount, 8 * MIB);
  state.mounted = [...mounted];
  const folder = imageFolder(calls);
  const detaches = () => calls.slice(2).map((c) => c.slice(1).join(" "));
  const cleanup = () => Deno.remove(mount, { recursive: true });
  return { volume, folder, detaches, synced, traps, state, cleanup, mount };
}

test("detach: a plain detach, then the image folder is deleted and the trap disarmed", async () => {
  const d = await detaching({}, [true]);
  try {
    await d.volume.detach();
    assertEquals(d.detaches(), [`detach ${d.mount}`]);
    assert(!exists(d.folder));
    assertEquals(d.state.disarmed, 1);
  } finally {
    await d.cleanup();
  }
});

test("detach: a busy volume is detached by force", async () => {
  const d = await detaching({ detach: [{ code: 16, stderr: "busy" }] }, [true]);
  try {
    await d.volume.detach();
    assertEquals(d.detaches(), [`detach ${d.mount}`, `detach -force ${d.mount}`]);
    assert(!exists(d.folder));
  } finally {
    await d.cleanup();
  }
});

test("detach: one the watchdog detached and deleted first is let be", async () => {
  const gone = [{ code: 1, stderr: "no such file" }];
  const d = await detaching({ detach: [...gone], "detach -force": [...gone] }, [true, false]);
  try {
    // The watchdog's removal ran once the run's group was gone, while the run still drained.
    await Deno.remove(d.folder, { recursive: true });
    await d.volume.detach();
    assertEquals(d.detaches(), [`detach ${d.mount}`, `detach -force ${d.mount}`]);
    assert(!exists(d.folder));
    assertEquals(d.state.disarmed, 1);
  } finally {
    await d.cleanup();
  }
});

test("detach: a volume still mounted after the forced detach is raised, the trap kept", async () => {
  const stuck = [{ code: 16, stderr: "resource busy" }];
  const d = await detaching({ detach: [...stuck], "detach -force": [...stuck] }, [true]);
  try {
    await assertRejects(() => d.volume.detach(), Error, `${d.mount} could not be detached`);
    assertEquals(d.state.disarmed, 0, "a volume left is tried again at exit");
  } finally {
    await Deno.remove(d.folder, { recursive: true });
    await d.cleanup();
  }
});

test("the exit trap detaches by force and deletes the image, synchronously", async () => {
  const d = await detaching({}, [true]);
  try {
    assertEquals(d.traps.length, 1);
    d.traps[0]();
    assertEquals(d.synced, [[HDIUTIL, "detach", "-force", d.mount]]);
    assert(!exists(d.folder));
  } finally {
    await d.cleanup();
  }
});

test("the watchdog's removal deletes the image even when its detach fails", async () => {
  const d = await detaching({}, [true]);
  try {
    const [cmd, ...args] = d.volume.removal;
    const run = new Deno.Command(cmd, { args, stdout: "null", stderr: "null" });
    assertEquals((await run.output()).code, 0);
    assert(!exists(d.folder), "the image folder outlived the removal");
    assert(d.volume.removal.includes(d.mount), "the removal does not name the mount");
  } finally {
    await d.cleanup();
  }
});
