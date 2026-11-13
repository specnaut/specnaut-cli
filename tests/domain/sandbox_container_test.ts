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
  podmanLimits: ALL,
  docker: false,
  dockerOnPodman: false,
  dockerLimits: ALL,
  bwrap: "absent",
  bwrapVersion: null,
  bwrapScope: false,
  sandboxExec: false,
};

const probe = (over: Partial<BackendProbe>): BackendProbe => ({ ...PODMAN, ...over });
const ON_PODMAN = { kind: "container", engine: "podman", image: IMAGE, dropped: [] } as const;
const ON_DOCKER = { kind: "container", engine: "docker", image: IMAGE, dropped: [] } as const;
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

const UNCAPPED_WHY =
  "container: rootless podman without cgroup v2 pids, memory and cpu delegated, and no docker";

for (const controller of ["memory", "pids", "cpuQuota"] as const) {
  Deno.test(`container: rootless podman without ${controller} alone is passed over for docker, else uncapped`, () => {
    const lacking = probe({ podmanLimits: { ...ALL, [controller]: false } });
    assertEquals(chooseBackend({ ...lacking, docker: true }), ON_DOCKER);
    assertEquals(firstWhy(lacking), UNCAPPED_WHY);
  });
}
