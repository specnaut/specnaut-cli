import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import { within } from "../../src/domain/sandbox_paths.ts";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { HdiutilVolumes } from "../../src/infrastructure/sandbox_scratch_volume.ts";
import { exists } from "./sandbox_live_fixture.ts";
import { POSIX } from "./sandbox_runner_fixture.ts";
import {
  attachAnswer,
  type End,
  HDIUTIL,
  hdiutil,
  host,
  imageFolder,
  MIB,
  onMount,
  warningsOf,
} from "./sandbox_scratch_volume_fixture.ts";

/**
 * The scratch cap on macOS: a sparse APFS image of the cap's size, made in a private folder of its
 * own, attached on the scratch folder with its owners honoured. One that cannot be made, attached
 * or found mounted refuses the run, and leaves nothing. Its end is beside this file.
 */

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
        [HDIUTIL, "attach", "-plist", "-owners", "on", "-nobrowse", "-noautoopen", "-mountpoint"]
          .concat([mount, join(folder, "scratch.sparseimage")]),
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

/** The calls after the create and the attach, each its words after hdiutil's path. */
const after = (calls: string[][]) => calls.slice(2).map((c) => c.slice(1).join(" "));

test("an image attached but not mounted on the scratch has its disk detached, by its node", () =>
  onMount(async (mount) => {
    const { launcher, calls } = hdiutil({
      attach: [{ code: 0, stdout: attachAnswer("/dev/disk7") }],
    });
    const volumes = new HdiutilVolumes(launcher, host(false).volumeHost);
    await assertRejects(() => volumes.attach(mount, 8 * MIB), SandboxRefused, "is not mounted on");
    assertEquals(after(calls), ["detach /dev/disk7"]);
    assert(!exists(imageFolder(calls)), "the image folder is left");
  }));

test("an attached disk that will not detach is detached by force, else warned of", () =>
  onMount(async (mount) => {
    const busy = { code: 16, stderr: "resource busy" };
    const { launcher, calls } = hdiutil({ detach: [busy], "detach -force": [busy] });
    const volumes = new HdiutilVolumes(launcher, host(false).volumeHost);
    const warned = await warningsOf(() =>
      assertRejects(() => volumes.attach(mount, 8 * MIB), SandboxRefused, "is not mounted on")
    );
    assertEquals(after(calls), ["detach /dev/disk9", "detach -force /dev/disk9"]);
    assertEquals(warned, [
      "warning: the scratch image's disk /dev/disk9 could not be detached: exited 16: resource busy",
    ]);
  }));

test("an attach that names no disk is warned of, and refuses the run", () =>
  onMount(async (mount) => {
    const { launcher, calls } = hdiutil({ attach: [{ code: 0, stdout: "<plist></plist>" }] });
    const volumes = new HdiutilVolumes(launcher, host(false).volumeHost);
    const warned = await warningsOf(() =>
      assertRejects(() => volumes.attach(mount, 8 * MIB), SandboxRefused, "is not mounted on")
    );
    assertEquals(after(calls), []);
    assertEquals(warned, ["warning: the scratch image's attach named no disk to detach"]);
  }));

test("a missing hdiutil refuses the run", () =>
  assertRefused("could not start", { missing: true, mounted: false }));

test("a refused attach whose volume cannot be detached is warned of, its trap kept", () =>
  onMount(async (mount) => {
    const stuck = [{ code: 16, stderr: "resource busy" }];
    const ends = {
      attach: [{ code: 1, stderr: "late" }],
      detach: [...stuck],
      "detach -force": [...stuck],
    };
    const { launcher, calls } = hdiutil(ends);
    const { volumeHost, state } = host(true);
    const volumes = new HdiutilVolumes(launcher, volumeHost);
    try {
      const warned = await warningsOf(() =>
        assertRejects(() => volumes.attach(mount, 8 * MIB), SandboxRefused, "attach exited 1")
      );
      assertEquals(warned.length, 1);
      assertStringIncludes(warned[0], `${mount} could not be detached`);
      assertEquals(state.disarmed, 0, "a volume left is tried again at exit");
    } finally {
      await Deno.remove(imageFolder(calls), { recursive: true });
    }
  }));

test("the scratch folder is closed to writes under the volume, so none lands there after it", () =>
  onMount(async (mount) => {
    const { launcher } = hdiutil();
    const modes: number[] = [];
    const watching: ProcessLauncher = {
      ...launcher,
      start: (spec) => {
        if (spec.args[0] === "attach") modes.push(Deno.statSync(mount).mode! & 0o777);
        return launcher.start(spec);
      },
    };
    const volumes = new HdiutilVolumes(watching, host(true).volumeHost);
    const volume = await volumes.attach(mount, 8 * MIB);
    await volume.detach();
    assertEquals(modes, [0o500]);
  }));
