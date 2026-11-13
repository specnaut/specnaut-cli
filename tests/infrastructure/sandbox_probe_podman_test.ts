import { assertEquals } from "@std/assert";
import { chooseBackend } from "../../src/domain/sandbox.ts";
import { capsWithout } from "../../src/domain/sandbox_limits.ts";
import { ok, prober } from "./sandbox_probe_fixture.ts";

/**
 * Podman as the probe finds it: whether it runs as the user, and the limits it can apply, read as
 * docker's are. Each cgroup v2 controller it holds is one limit; the memory cap's bound on what a
 * run pages out holds only where the user's own cgroup has the file podman looks for, and podman
 * drops that bound, warning, where it does not.
 */

/**
 * Podman's report of a local engine; `host` sets or replaces what its `host` says, and `release`
 * is its `version`.
 */
const podmanInfo = (
  rootless: boolean,
  version: string,
  controllers: string[],
  host: Record<string, unknown> = {},
  release: Record<string, unknown> = { Version: "4.9.3" },
) =>
  ok(JSON.stringify({
    version: release,
    host: {
      security: { rootless },
      serviceIsRemote: false,
      cgroupVersion: version,
      cgroupControllers: controllers,
      ...host,
    },
  }));
const ALL = ["cpu", "memory", "pids", "io"];
const FAILED = { code: 1, stdout: "", stderr: "" };

/** The limits a probe finds with podman reporting `info`, and the trial answering `trial`. */
async function limitsOf(info = podmanInfo(true, "v2", ALL), trial = ok()) {
  const { prober: p, calls } = prober("linux", { podman: info, "/bin/sh -c": trial });
  const probed = await p.probe();
  return { probed, trials: calls.filter((c) => c.cmd === "/bin/sh") };
}

Deno.test("probe: podman's limits are its cgroup v2 controllers, read as docker's are", async () => {
  const { probed } = await limitsOf();
  assertEquals(probed.podman, "rootless");
  assertEquals(probed.podmanLimits, { memory: true, swap: true, pids: true, cpuQuota: true });
  const partial = await limitsOf(podmanInfo(true, "v2", ["cpu", "memory"]));
  assertEquals(partial.probed.podmanLimits, {
    memory: true,
    swap: true,
    pids: false,
    cpuQuota: true,
  });
  const v1 = await limitsOf(podmanInfo(true, "v1", ALL));
  assertEquals(Object.values(v1.probed.podmanLimits), [false, false, false, false]);
  assertEquals(v1.trials, []);
  const root = await limitsOf(podmanInfo(false, "v2", ALL));
  assertEquals(root.probed.podman, "root");
});

Deno.test("probe: podman bounds paged-out memory only where the user's cgroup has the file", async () => {
  const { trials } = await limitsOf();
  assertEquals(trials.length, 1);
  assertEquals(trials[0].args[0], "-c");
  assertEquals(trials[0].args[1].includes("/proc/self/cgroup"), true, trials[0].args[1]);
  assertEquals(trials[0].args[1].endsWith('/memory.swap.max"'), true, trials[0].args[1]);
  const lacking = await limitsOf(undefined, FAILED);
  assertEquals(lacking.probed.podmanLimits.swap, false);
  assertEquals(lacking.probed.podmanLimits.memory, true);
  const noMemory = await limitsOf(podmanInfo(true, "v2", ["cpu", "pids"]));
  assertEquals([noMemory.probed.podmanLimits.swap, noMemory.trials], [false, []]);
});

Deno.test("probe: podman whose host lacks the bound is offered, and reports it UNCAPPED", async () => {
  const { probed } = await limitsOf(undefined, FAILED);
  const backend = chooseBackend(probed);
  assertEquals(backend.kind === "container" && backend.engine, "podman");
  if (backend.kind !== "container") return;
  assertEquals(backend.dropped, ["memorySwap"]);
  assertEquals(capsWithout(backend), ["memorySwap"]);
});

Deno.test("probe: a remote podman is read as remote, and its bound is not tried here", async () => {
  const local = await limitsOf();
  assertEquals(local.probed.podmanRemote, false);
  const remote = await limitsOf(podmanInfo(true, "v2", ALL, { serviceIsRemote: true }));
  assertEquals([remote.probed.podmanRemote, remote.trials], [true, []]);
  assertEquals(remote.probed.podmanLimits, {
    memory: true,
    swap: false,
    pids: true,
    cpuQuota: true,
  });
});

Deno.test("probe: a podman whose report does not say it is local is counted remote", async () => {
  const unsaid = await limitsOf(podmanInfo(true, "v2", ALL, { serviceIsRemote: undefined }));
  assertEquals([unsaid.probed.podmanRemote, unsaid.trials], [true, []]);
});

Deno.test("probe: podman's version is what its report says, or null when it says none", async () => {
  assertEquals((await limitsOf()).probed.podmanVersion, "4.9.3");
  for (const release of [{}, { Version: 4.9 }, { Version: null }]) {
    const { probed } = await limitsOf(podmanInfo(true, "v2", ALL, {}, release));
    assertEquals(probed.podmanVersion, null, JSON.stringify(release));
  }
});

Deno.test("probe: the CPUs podman's host has are its host.cpus, when that is a count", async () => {
  const cpusOf = async (cpus: unknown) =>
    (await limitsOf(podmanInfo(true, "v2", ALL, { cpus }))).probed.podmanCpus;
  assertEquals(await cpusOf(1), 1);
  for (const cpus of [undefined, 0, 2.5, "1"]) assertEquals(await cpusOf(cpus), null, `${cpus}`);
});

Deno.test("probe: podman whose report is not JSON is not used", async () => {
  const { probed } = await limitsOf(ok("garbled"));
  assertEquals([probed.podman, probed.podmanLimits.memory], ["absent", false]);
});
