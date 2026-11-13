import { assertEquals } from "@std/assert";
import { assessBackends, type BackendProbe, chooseBackend } from "../../src/domain/sandbox.ts";

/**
 * Which engine the container backend runs on, or why it has none: rootless podman when it runs
 * locally with every cap it needs, else docker, else a reason naming what podman lacked.
 */

const IMAGE = `acme/dev@sha256:${"c".repeat(64)}`;
const ALL = { memory: true, swap: true, pids: true, cpuQuota: true };
const NONE = { memory: false, swap: false, pids: false, cpuQuota: false };

/** A Linux host whose rootless podman runs locally and can apply every cap, and nothing else. */
const PODMAN: BackendProbe = {
  os: "linux",
  arch: "x86_64",
  image: { kind: "pinned", ref: IMAGE },
  podman: "rootless",
  podmanRemote: false,
  podmanVersion: "4.8.0",
  podmanSeccomp: true,
  podmanLimits: ALL,
  podmanCpus: null,
  podmanPlatform: { arch: "x86_64", kernel: "6.8.0" },
  docker: false,
  dockerOnPodman: false,
  dockerSeccomp: true,
  dockerLimits: ALL,
  dockerCpus: null,
  dockerPlatform: { arch: "x86_64", kernel: "6.8.0" },
  bwrap: "absent",
  bwrapVersion: "bubblewrap 0.8.0",
  bwrapScope: false,
  sandboxExec: false,
};

const probe = (over: Partial<BackendProbe>): BackendProbe => ({ ...PODMAN, ...over });
const ON_PODMAN = {
  kind: "container",
  engine: "podman",
  image: IMAGE,
  dropped: [],
  cpus: null,
} as const;
const ON_DOCKER = {
  kind: "container",
  engine: "docker",
  image: IMAGE,
  dropped: [],
  cpus: null,
} as const;
const REMOTE_WHY =
  "container: podman answers from a remote service, which reads its own containers.conf, " +
  "and no docker";

/** The reason a static-only choice gives first: the container's. */
function firstWhy(host: BackendProbe): string | false {
  const chosen = chooseBackend(host);
  return chosen.kind === "static" && chosen.why[0];
}

Deno.test("container: a local rootless podman that can apply every cap runs it", () => {
  assertEquals(chooseBackend(PODMAN), ON_PODMAN);
});

Deno.test("container: rootless podman comes first, ahead of docker and bubblewrap", () => {
  assertEquals(chooseBackend(probe({ docker: true, bwrap: "usable" })), ON_PODMAN);
});

Deno.test("container: podman running as root is passed over for docker", () => {
  assertEquals(chooseBackend(probe({ podman: "root", docker: true, bwrap: "usable" })), ON_DOCKER);
});

Deno.test("container: rootless podman without delegated cgroups leaves the run to the next", () => {
  const uncapped = probe({ podmanLimits: NONE });
  assertEquals(chooseBackend({ ...uncapped, docker: true }), ON_DOCKER);
  assertEquals(chooseBackend({ ...uncapped, bwrap: "usable" }), { kind: "bwrap", scope: false });
});

Deno.test("container: docker carries the caps its host cannot apply; podman runs only capped", () => {
  const lacking = { memory: true, swap: false, pids: false, cpuQuota: true };
  const docker = chooseBackend(probe({ podman: "absent", docker: true, dockerLimits: lacking }));
  assertEquals(docker, { ...ON_DOCKER, dropped: ["memorySwap", "processes"] });
  assertEquals(chooseBackend(probe({ docker: true, dockerLimits: lacking })), ON_PODMAN);
});

Deno.test("container: a remote podman is passed over for docker, else says why there is none", () => {
  const remote = probe({ podmanRemote: true });
  assertEquals(chooseBackend({ ...remote, docker: true }), ON_DOCKER);
  assertEquals(firstWhy(remote), REMOTE_WHY);
});

Deno.test("container: on macOS a remote podman leaves the run to sandbox-exec, and says why", () => {
  const mac = probe({ os: "darwin", podmanRemote: true, sandboxExec: true });
  assertEquals(chooseBackend(mac), { kind: "seatbelt" });
  assertEquals(assessBackends(mac)[0], { kind: "container", why: REMOTE_WHY, onThisOs: true });
});

Deno.test("container: a remote podman's reason comes before what it could not cap", () => {
  assertEquals(firstWhy(probe({ podmanRemote: true, podmanLimits: NONE })), REMOTE_WHY);
});

const OLD_WHY =
  "container: podman older than 4.8, whose containers.conf cannot empty a list, and no docker";
const UNREAD_WHY = "container: podman's version could not be read, and no docker";

Deno.test("container: podman older than 4.8 is passed over for docker, else says why", () => {
  for (const podmanVersion of ["4.7.2", "4.4.1", "3.4.4", "v4.7.0", "4.7.0-dev"]) {
    assertEquals(chooseBackend(probe({ podmanVersion, docker: true })), ON_DOCKER, podmanVersion);
    assertEquals(firstWhy(probe({ podmanVersion })), OLD_WHY, podmanVersion);
  }
  for (const podmanVersion of ["4.8.0", "4.8.0-rc1", "4.10.1", "5.0.0", "v5.2.3-dev"]) {
    assertEquals(chooseBackend(probe({ podmanVersion })), ON_PODMAN, podmanVersion);
  }
});

// The boundary as sandbox_container.ts states it: a 4.8 pre-release already reads the CLI's
// containers.conf, and no 4.7 patch does, however high.
Deno.test("container: a 4.8 pre-release is offered; the highest 4.7 patch is not", () => {
  assertEquals(chooseBackend(probe({ podmanVersion: "4.8.0-rc1" })), ON_PODMAN);
  assertEquals(firstWhy(probe({ podmanVersion: "4.7.9" })), OLD_WHY);
});

Deno.test("container: a podman whose version cannot be read is not offered, and says why", () => {
  for (const podmanVersion of [null, "", "garbled", "4", "four.eight", "4.8.0 extra"]) {
    assertEquals(firstWhy(probe({ podmanVersion })), UNREAD_WHY, String(podmanVersion));
    const withDocker = probe({ podmanVersion, docker: true });
    assertEquals(chooseBackend(withDocker), ON_DOCKER, String(podmanVersion));
  }
});

const ON_PODMAN_SERVICE =
  "docker answers from a podman service, which reads its own containers.conf";

Deno.test("container: docker that is a podman service is not offered, and says why", () => {
  const service = { docker: true, dockerOnPodman: true } as const;
  assertEquals(
    firstWhy(probe({ ...service, podmanRemote: true })),
    [
      "container: podman answers from a remote service, which reads its own containers.conf",
      ON_PODMAN_SERVICE,
    ].join(", and "),
  );
  assertEquals(
    firstWhy(probe({ ...service, podman: "absent" })),
    [
      "container: no rootless podman",
      ON_PODMAN_SERVICE,
    ].join(", and "),
  );
  assertEquals(chooseBackend(probe(service)), ON_PODMAN);
});

Deno.test("container: the offered engine carries the CPUs its own host has", () => {
  const counts = { podmanCpus: 1, dockerCpus: 4 };
  assertEquals(chooseBackend(probe({ ...counts, docker: true })), { ...ON_PODMAN, cpus: 1 });
  const docker = probe({ ...counts, docker: true, podmanRemote: true });
  assertEquals(chooseBackend(docker), { ...ON_DOCKER, cpus: 4 });
});

const UNCAPPED_WHY =
  "container: rootless podman without cgroup v2 pids, memory and cpu delegated, and no docker";

for (const controller of ["memory", "pids", "cpuQuota"] as const) {
  Deno.test(`container: rootless podman without ${controller} alone is passed over for docker, else uncapped`, () => {
    const lacking = probe({ podmanLimits: { ...ALL, [controller]: false } });
    assertEquals(chooseBackend({ ...lacking, docker: true }), ON_DOCKER);
    assertEquals(firstWhy(lacking), UNCAPPED_WHY);
  });
}

Deno.test("container: an engine without a syscall filter is passed over, with its reason", () => {
  const unfiltered = probe({ podmanSeccomp: false });
  assertEquals(chooseBackend({ ...unfiltered, docker: true }), ON_DOCKER);
  assertEquals(
    firstWhy(probe({ podmanSeccomp: false, docker: true, dockerSeccomp: false })),
    "container: podman runs containers without a syscall filter (seccomp), and docker runs " +
      "containers without a syscall filter (seccomp)",
  );
});
