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
  podmanLimits: ALL,
  docker: false,
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
