import { assertEquals } from "@std/assert";
import { type BackendProbe, chooseBackend } from "../../src/domain/sandbox.ts";
import { LINUX_BWRAP } from "./sandbox_fixture.ts";

/**
 * An engine runs a container only on a platform the CLI's syscall profile is checked on: an
 * x86_64 or aarch64 machine, under a kernel of 4.8 or later, where a traced process can no longer
 * step past a syscall filter. Each engine reports its own (docker's daemon, a local podman's
 * host), which may not be the CLI's: a VM, or an emulated machine.
 */

const ALL = { memory: true, swap: true, pids: true, cpuQuota: true };
const IMAGE = `acme/dev@sha256:${"c".repeat(64)}`;
const GOOD = { arch: "x86_64", kernel: "6.8.0-45-generic" };
const NO_BWRAP = {
  ...LINUX_BWRAP,
  bwrap: "absent",
  image: { kind: "pinned", ref: IMAGE },
} as const;

const onPodman = (podmanPlatform: BackendProbe["podmanPlatform"]): BackendProbe => ({
  ...NO_BWRAP,
  podman: "rootless",
  podmanVersion: "4.9.3",
  podmanLimits: ALL,
  podmanPlatform,
});
const onDocker = (dockerPlatform: BackendProbe["dockerPlatform"]): BackendProbe => ({
  ...NO_BWRAP,
  docker: true,
  dockerPlatform,
});

/** The engine chosen on `probe`, or the container's reason when none is. */
function verdict(probe: BackendProbe): string {
  const chosen = chooseBackend(probe);
  if (chosen.kind === "container") return chosen.engine;
  return chosen.kind === "static" ? chosen.why[0] : chosen.kind;
}

const NO_DOCKER = "and no docker";

Deno.test("container platform: x86_64 and aarch64 under a kernel of 4.8 or later are run on", () => {
  for (const arch of ["x86_64", "aarch64"]) {
    for (const kernel of ["4.8.0", "5.15.0-1068-azure", "6.10.14-linuxkit", "10.0"]) {
      assertEquals(verdict(onPodman({ arch, kernel })), "podman", `${arch} ${kernel}`);
      assertEquals(verdict(onDocker({ arch, kernel })), "docker", `${arch} ${kernel}`);
    }
  }
});

Deno.test("container platform: an engine on another architecture is not run on, and says why", () => {
  for (const arch of ["s390x", "ppc64le", "riscv64", "armv7l", "i686", null]) {
    const on = arch ?? "an architecture it did not report";
    assertEquals(
      verdict(onPodman({ ...GOOD, arch })),
      `container: podman runs on ${on}, which the CLI's syscall profile is not checked on, ` +
        NO_DOCKER,
    );
    assertEquals(
      verdict(onDocker({ ...GOOD, arch })),
      "container: no rootless podman, and docker runs on " +
        `${on}, which the CLI's syscall profile is not checked on`,
    );
  }
});

Deno.test("container platform: an engine under a kernel older than 4.8, or unread, is not run on", () => {
  const why = (engine: string) =>
    `${engine}'s kernel is older than 4.8 or could not be read, and before 4.8 a traced ` +
    "process could step past a syscall filter";
  for (
    const kernel of ["4.7.10", "3.10.0-1160.el7.x86_64", "4", "5", "v6.8", "garbled", "", null]
  ) {
    assertEquals(
      verdict(onPodman({ ...GOOD, kernel })),
      `container: ${why("podman")}, ${NO_DOCKER}`,
    );
    assertEquals(
      verdict(onDocker({ ...GOOD, kernel })),
      `container: no rootless podman, and ${why("docker")}`,
    );
  }
});
