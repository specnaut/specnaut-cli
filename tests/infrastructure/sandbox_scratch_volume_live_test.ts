import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import {
  DenoProcessLauncher,
  type ProcessLauncher,
} from "../../src/infrastructure/sandbox_process.ts";
import { HdiutilVolumes } from "../../src/infrastructure/sandbox_scratch_volume.ts";
import { capture, exists, live, mountedOn } from "./sandbox_live_fixture.ts";
import { HDIUTIL, MIB, onMount, warningsOf } from "./sandbox_scratch_volume_fixture.ts";

/**
 * The scratch volume's attach with the real hdiutil, on macOS: an image that attached but is not
 * found mounted where it was asked has its disk detached, by the node the attach named. Skipped
 * elsewhere, saying so.
 */

const MISSING = Deno.build.os === "darwin" && exists(HDIUTIL) ? null : "macOS with hdiutil";

/** The real launcher, each attach's image and answer kept in `attaches` as it is read. */
function keepingAttaches(attaches: { image: string; answer: string }[]): ProcessLauncher {
  const real = new DenoProcessLauncher(capture().stream, capture().stream);
  return {
    runSync: (spec) => real.runSync(spec),
    start(spec) {
      const started = real.start(spec);
      const image = spec.args.at(-1)!;
      if (spec.args[0] === "attach") {
        started.stdout.then((answer) => attaches.push({ image, answer }));
      }
      return started;
    },
  };
}

/** What `hdiutil info` lists now: every image attached on this host, by its path. */
function attachedNow(): string {
  const info = new Deno.Command(HDIUTIL, { args: ["info"], stdout: "piped" }).outputSync();
  return new TextDecoder().decode(info.stdout);
}

Deno.test({
  name: live(
    "seatbelt hdiutil live: an image attached but not found mounted has its disk detached",
    MISSING,
  ),
  ignore: MISSING !== null,
  fn: () =>
    onMount(async (mount) => {
      const attaches: { image: string; answer: string }[] = [];
      // The host is told nothing is mounted: the attach mounted it, the volumes cannot see it.
      const blind = { mounted: () => false, arm: () => () => {} };
      const volumes = new HdiutilVolumes(keepingAttaches(attaches), blind);
      try {
        await warningsOf(() =>
          assertRejects(() => volumes.attach(mount, 8 * MIB), SandboxRefused, "is not mounted on")
        );
        assertEquals(attaches.length, 1);
        assertMatch(attaches[0].answer, /<string>\/dev\/disk[0-9]+<\/string>/);
        assertEquals(mountedOn(mount), false, "the volume is still mounted on the scratch");
        assert(!attachedNow().includes(attaches[0].image), "the image's disk is still attached");
      } finally {
        if (mountedOn(mount)) {
          await new Deno.Command(HDIUTIL, { args: ["detach", "-force", mount] }).output();
        }
      }
    }),
});
