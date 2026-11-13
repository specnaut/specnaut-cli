import { assert, assertEquals, assertMatch } from "@std/assert";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { SeatbeltRunner } from "../../src/infrastructure/sandbox_seatbelt_runner.ts";
import {
  HdiutilVolumes,
  type ScratchVolumes,
} from "../../src/infrastructure/sandbox_scratch_volume.ts";
import { exists, live, mountedOn, probed, runIn, withLayout } from "./sandbox_live_fixture.ts";

/**
 * The scratch cap of `sandbox-exec` on a real macOS host: a write past it fails for want of space,
 * inside the run, and the volume that capped it is detached and its image deleted after the run.
 * Skipped elsewhere, saying so.
 */

const MISSING = probed.sandboxExec ? null : "macOS with sandbox-exec";
const MIB = 1024 ** 2;

/** What the run's volume was while attached, and the folder its image was made in. */
type Seen = { mounted: boolean; mode: number; image: string };

/** The real volumes, each attach recorded in `seen` from outside the sandbox. */
function watching(launcher: DenoProcessLauncher, seen: Seen[]): ScratchVolumes {
  const real = new HdiutilVolumes(launcher);
  return {
    async attach(mount, bytes) {
      const volume = await real.attach(mount, bytes);
      const mode = Deno.statSync(mount).mode! & 0o777;
      seen.push({ mounted: mountedOn(mount), mode, image: volume.removal.at(-2)! });
      return volume;
    },
  };
}

Deno.test({
  name: live("seatbelt live: a write past the scratch cap fails with no space left", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy, scratch }) => {
      const seen: Seen[] = [];
      const capped = { ...policy, limits: { ...policy.limits, scratchBytes: 16 * MIB } };
      const fill = 'head -c 33554432 /dev/zero > "$TMPDIR/fill"; echo "head $?"';
      const mac = (l: DenoProcessLauncher) => new SeatbeltRunner(l, watching(l, seen));
      const { outcome, out } = await runIn(mac, capped, ["/bin/sh", "-c", `exec 2>&1; ${fill}`]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertMatch(out, /No space left on device/);
      assertMatch(out, /^head [1-9]\d*$/m);
      assertEquals(seen.length, 1);
      assert(seen[0].mounted, "nothing was mounted on the scratch for the run");
      assertEquals(seen[0].mode, 0o700, "the scratch volume's root is open to others");
      assertEquals(mountedOn(scratch), false, "the volume outlived the run");
      assertEquals(exists(seen[0].image), false, "the image outlived the run");
    }),
});

Deno.test({
  name: live("seatbelt live: a write within the scratch cap is made and read back", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const capped = { ...policy, limits: { ...policy.limits, scratchBytes: 16 * MIB } };
      const fill = 'head -c 4194304 /dev/zero > "$TMPDIR/f" && wc -c < "$TMPDIR/f"';
      const mac = (l: DenoProcessLauncher) => new SeatbeltRunner(l);
      const { outcome, out } = await runIn(mac, capped, ["/bin/sh", "-c", fill]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out.trim(), "4194304");
    }),
});
