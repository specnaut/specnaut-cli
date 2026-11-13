import { assert, assertEquals, assertRejects } from "@std/assert";
import { exists } from "./sandbox_live_fixture.ts";
import { POSIX } from "./sandbox_runner_fixture.ts";
import { detaching, HDIUTIL } from "./sandbox_scratch_volume_fixture.ts";

/**
 * The end of the scratch volume on macOS: detached, by force when busy, and its image deleted after
 * the run, by the runner, the exit trap, or the watchdog of a launcher killed with SIGKILL.
 */

const test = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name: `HdiutilVolumes: ${name}`, ignore: !POSIX, fn });

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
