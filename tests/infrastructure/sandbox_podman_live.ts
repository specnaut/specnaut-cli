import { containerEngine } from "../../src/domain/sandbox_container.ts";
import { isPinned } from "../../src/domain/sandbox_image.ts";
import { engineEnv } from "../../src/infrastructure/sandbox_engine_env.ts";
import { LIVE_IMAGE, probed } from "./sandbox_live_fixture.ts";

/**
 * What a live test of the sandbox's own podman configuration lacks here, or `null`: a remote
 * podman client (macOS, Windows) applies its machine's configuration, not the one a test writes,
 * so Linux only.
 */
export const NO_LOCAL_PODMAN = Deno.build.os !== "linux"
  ? "a local podman on Linux, as a remote client applies its machine's containers.conf"
  : containerEngine(probed) !== "podman"
  ? "a local rootless podman 4.8 or later, with seccomp and the pids, memory and cpu controllers"
  : isPinned(LIVE_IMAGE)
  ? null
  : "a digest-pinned image with /bin/sh, named in SPECNAUT_LIVE_IMAGE";

/** podman with `args`, outside the sandbox, under the engine environment a run gets. */
export async function plainPodman(args: string[]): Promise<{ code: number; out: string }> {
  const { code, stdout } = await new Deno.Command("podman", {
    args,
    env: engineEnv(Deno.env.toObject()),
    clearEnv: true,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  return { code, out: new TextDecoder().decode(stdout) };
}
