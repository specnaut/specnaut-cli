import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "./sandbox_live_fixture.ts";
import { POSIX } from "./sandbox_runner_fixture.ts";
import { detaching, HDIUTIL, warnings } from "./sandbox_scratch_volume_fixture.ts";

/**
 * The end of the scratch volume on macOS: detached, by force when busy, and its image deleted after
 * the run, by the runner, the exit trap, or the watchdog of a launcher killed with SIGKILL. A
 * forced detach only ever names a mount point: on a plain folder it would detach the volume that
 * holds the folder.
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

test("detach: one detached and deleted by another first is let be, never forced", async () => {
  const d = await detaching({ detach: [{ code: 1, stderr: "no such file" }] }, [true, false]);
  try {
    await Deno.remove(d.folder, { recursive: true });
    await d.volume.detach();
    assertEquals(d.detaches(), [`detach ${d.mount}`]);
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

test("the exit trap leaves a folder no volume is mounted on alone, and deletes the image", async () => {
  const d = await detaching({}, [false]);
  try {
    d.traps[0]();
    assertEquals(d.synced, []);
    assert(!exists(d.folder));
  } finally {
    await d.cleanup();
  }
});

test("the exit trap's forced detach that fails is warned of, naming the mount", async () => {
  const d = await detaching({ sync: [{ code: 1 }] }, [true]);
  try {
    const warned = warnings(() => d.traps[0]());
    assertEquals(warned.length, 1);
    assertStringIncludes(warned[0], d.mount);
    assertStringIncludes(warned[0], "exited 1");
  } finally {
    await d.cleanup();
  }
});

/** The watchdog's removal of `d`, with `hdiutil` in place of the system's, run to its end. */
async function removal(d: Awaited<ReturnType<typeof detaching>>, hdiutil: string) {
  const [cmd, ...args] = d.volume.removal;
  assertEquals(args.at(-1), HDIUTIL, "the removal does not take hdiutil last");
  const run = new Deno.Command(cmd, { args: [...args.slice(0, -1), hdiutil], stderr: "null" });
  return (await run.output()).code;
}

Deno.test({
  name: "HdiutilVolumes: the watchdog's removal detaches no plain folder, and deletes the image",
  ignore: Deno.build.os !== "darwin",
  fn: async () => {
    const d = await detaching({}, [true]);
    const fake = await Deno.makeTempDir({ prefix: "specnaut-fake-hdiutil-" });
    try {
      const marker = join(fake, "called");
      await Deno.writeTextFile(join(fake, "hdiutil"), `#!/bin/sh\necho "$@" > "${marker}"\n`);
      await Deno.chmod(join(fake, "hdiutil"), 0o700);
      assertEquals(await removal(d, join(fake, "hdiutil")), 0);
      assert(!exists(d.folder), "the image folder outlived the removal");
      assert(!exists(marker), "hdiutil was run on a folder no volume is mounted on");
      assert(d.volume.removal.includes(d.mount), "the removal does not name the mount");
    } finally {
      await Deno.remove(fake, { recursive: true });
      await d.cleanup();
    }
  },
});
