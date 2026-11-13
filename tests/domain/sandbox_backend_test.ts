import { assertEquals } from "@std/assert";
import { assessBackends, type BackendProbe, chooseBackend } from "../../src/domain/sandbox.ts";
import type { ImageSource } from "../../src/domain/sandbox_image.ts";

/**
 * Which isolation backend runs a branch's gates: a container first, then bubblewrap, then
 * `sandbox-exec`, else nothing runs and the review is static only. A throwaway user is no backend.
 */

const IMAGE: ImageSource = { kind: "pinned", ref: `acme/dev@sha256:${"a".repeat(64)}` };
const NO_ENGINE_WHY = "container: no rootless podman, and no docker";
const CGROUPS_WHY =
  "container: rootless podman without cgroup v2 pids, memory and cpu delegated, and no docker";
const OLD_BWRAP_WHY = "bubblewrap: older than 0.8, which cannot forbid nested user namespaces";
const NO_IMAGE: ImageSource = { kind: "none", why: "no devcontainer" };

const NOTHING: BackendProbe = {
  os: "linux",
  arch: "x86_64",
  image: IMAGE,
  podman: "absent",
  podmanRemote: false,
  podmanVersion: "4.8.0",
  podmanLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
  docker: false,
  dockerLimits: { memory: true, swap: true, pids: true, cpuQuota: true },
  bwrap: "absent",
  bwrapVersion: "bubblewrap 0.8.0",
  bwrapScope: false,
  sandboxExec: false,
};

/** A container on each engine, as offered on a host that can apply every cap. */
const ON_PODMAN = { kind: "container", engine: "podman", image: IMAGE.ref, dropped: [] } as const;
const ON_DOCKER = { kind: "container", engine: "docker", image: IMAGE.ref, dropped: [] } as const;

const probe = (over: Partial<BackendProbe>): BackendProbe => ({ ...NOTHING, ...over });
const ALL = { memory: true, swap: true, pids: true, cpuQuota: true };

Deno.test("chooseBackend: rootless podman comes first, ahead of docker and bubblewrap", () => {
  const all = probe({ podman: "rootless", podmanLimits: ALL, docker: true, bwrap: "usable" });
  assertEquals(chooseBackend(all), ON_PODMAN);
});

Deno.test("chooseBackend: podman running as root is passed over for docker", () => {
  const rooted = probe({ podman: "root", podmanLimits: ALL, docker: true, bwrap: "usable" });
  assertEquals(chooseBackend(rooted), ON_DOCKER);
});

Deno.test("chooseBackend: rootless podman without delegated cgroups cannot cap a run", () => {
  const uncapped = probe({ podman: "rootless", docker: true });
  assertEquals(chooseBackend(uncapped), ON_DOCKER);
  const alone = chooseBackend(probe({ podman: "rootless", bwrap: "usable" }));
  assertEquals(alone, { kind: "bwrap", scope: false });
  const nothing = chooseBackend(probe({ podman: "rootless" }));
  assertEquals(nothing.kind === "static" && nothing.why[0], CGROUPS_WHY);
});

Deno.test("chooseBackend: docker carries the caps its host cannot apply; podman runs only capped", () => {
  const lacking = { memory: true, swap: false, pids: false, cpuQuota: true };
  const docker = chooseBackend(probe({ docker: true, dockerLimits: lacking }));
  assertEquals(docker, { ...ON_DOCKER, dropped: ["memorySwap", "processes"] });
  const podman = probe({ podman: "rootless", podmanLimits: ALL, dockerLimits: lacking });
  assertEquals(chooseBackend(podman), ON_PODMAN);
});

Deno.test("chooseBackend: docker comes before bubblewrap", () => {
  const both = probe({ docker: true, bwrap: "usable" });
  assertEquals(chooseBackend(both), ON_DOCKER);
});

Deno.test("chooseBackend: no digest-pinned image means no container, whatever engine exists", () => {
  const engines = probe({
    image: NO_IMAGE,
    podman: "rootless",
    podmanLimits: ALL,
    docker: true,
    bwrap: "usable",
  });
  assertEquals(chooseBackend(engines), { kind: "bwrap", scope: false });
});

Deno.test("chooseBackend: bubblewrap blocked by the user-namespace restriction is passed over", () => {
  assertEquals(chooseBackend(probe({ bwrap: "userns_restricted" })), {
    kind: "static",
    why: [NO_ENGINE_WHY, "bubblewrap: user namespaces restricted"],
  });
});

Deno.test("chooseBackend: bubblewrap older than 0.8 cannot forbid nested user namespaces", () => {
  for (const bwrapVersion of ["bubblewrap 0.7.0", "0.6.1", "garbled", null]) {
    const old = chooseBackend(probe({ bwrap: "usable", bwrapVersion }));
    assertEquals(old.kind === "static" && old.why.at(-1), OLD_BWRAP_WHY, String(bwrapVersion));
  }
  for (const bwrapVersion of ["bubblewrap 0.8.0", "0.11.0", "1.0.0"]) {
    assertEquals(chooseBackend(probe({ bwrap: "usable", bwrapVersion })), {
      kind: "bwrap",
      scope: false,
    });
  }
});

Deno.test("chooseBackend: bubblewrap is a Linux backend only", () => {
  assertEquals(chooseBackend(probe({ os: "darwin", bwrap: "usable" })), {
    kind: "static",
    why: [NO_ENGINE_WHY, "sandbox-exec: not available"],
  });
});

Deno.test("chooseBackend: sandbox-exec on macOS when no container runs", () => {
  const mac = probe({ os: "darwin", image: NO_IMAGE, docker: true, sandboxExec: true });
  assertEquals(chooseBackend(mac), { kind: "seatbelt" });
});

Deno.test("chooseBackend: sandbox-exec is a macOS backend only", () => {
  assertEquals(chooseBackend(probe({ sandboxExec: true })), {
    kind: "static",
    why: [NO_ENGINE_WHY, "bubblewrap: not installed"],
  });
});

Deno.test("chooseBackend: Windows is static only, even with an engine and a pinned image", () => {
  const win = probe({ os: "windows", podman: "rootless", podmanLimits: ALL, docker: true });
  assertEquals(chooseBackend(win), { kind: "static", why: ["no sandbox on Windows"] });
});

Deno.test("chooseBackend: with no backend it is static only, and says why for each one", () => {
  const chosen = chooseBackend(probe({ image: NO_IMAGE }));
  assertEquals(chosen.kind, "static");
  if (chosen.kind === "static") {
    assertEquals(chosen.why, [
      "no container image: no devcontainer",
      "bubblewrap: not installed",
    ]);
  }
});

Deno.test("chooseBackend: bubblewrap whose trial run failed is passed over, with that reason", () => {
  assertEquals(chooseBackend(probe({ bwrap: "trial_failed" })), {
    kind: "static",
    why: [NO_ENGINE_WHY, "bubblewrap: a trial run failed"],
  });
});

Deno.test("chooseBackend: bubblewrap needs a syscall filter for the host's architecture", () => {
  assertEquals(chooseBackend(probe({ bwrap: "usable", arch: "aarch64" })), {
    kind: "bwrap",
    scope: false,
  });
  assertEquals(chooseBackend(probe({ bwrap: "usable", arch: "riscv64" })), {
    kind: "static",
    why: [NO_ENGINE_WHY, "bubblewrap: no syscall filter for riscv64"],
  });
});

Deno.test("assessBackends: each backend in selection order, offered or with its reason", () => {
  const mac = probe({ os: "darwin", image: NO_IMAGE, sandboxExec: true });
  assertEquals(assessBackends(mac), [
    { kind: "container", why: "no container image: no devcontainer", onThisOs: true },
    { kind: "bwrap", why: "bubblewrap: Linux only", onThisOs: false },
    { kind: "seatbelt", offered: { kind: "seatbelt" } },
  ]);
  const linux = probe({ docker: true, bwrap: "usable" });
  assertEquals(assessBackends(linux), [
    { kind: "container", offered: ON_DOCKER },
    { kind: "bwrap", offered: { kind: "bwrap", scope: false } },
    { kind: "seatbelt", why: "sandbox-exec: macOS only", onThisOs: false },
  ]);
});

Deno.test("assessBackends: on Windows no backend runs, each for that reason", () => {
  const win = probe({ os: "windows", docker: true, bwrap: "usable", sandboxExec: true });
  assertEquals(assessBackends(win).map((s) => "why" in s && s.why), [
    "no sandbox on Windows",
    "no sandbox on Windows",
    "no sandbox on Windows",
  ]);
});

Deno.test("chooseBackend: the first backend assessBackends offers, whatever the host", () => {
  for (const os of ["linux", "darwin"]) {
    for (const docker of [true, false]) {
      for (const bwrap of ["usable", "absent"] as const) {
        for (const sandboxExec of [true, false]) {
          const host = probe({ os, docker, bwrap, sandboxExec });
          const first = assessBackends(host).find((s) => "offered" in s);
          const chosen = chooseBackend(host);
          assertEquals(chosen, first && "offered" in first ? first.offered : chosen);
          if (first === undefined) assertEquals(chosen.kind, "static");
        }
      }
    }
  }
});

Deno.test("chooseBackend: bubblewrap runs in a user scope exactly when the probe found one", () => {
  assertEquals(chooseBackend(probe({ bwrap: "usable", bwrapScope: true })), {
    kind: "bwrap",
    scope: true,
  });
  assertEquals(chooseBackend(probe({ bwrap: "usable" })), { kind: "bwrap", scope: false });
});
