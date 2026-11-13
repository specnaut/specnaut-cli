import { assertEquals } from "@std/assert";
import { chooseBackend } from "../../src/domain/sandbox.ts";
import type { BackendProbe } from "../../src/domain/sandbox.ts";
import { containerArgs } from "../../src/domain/sandbox_args.ts";
import { capsWithout } from "../../src/domain/sandbox_limits.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { ENGINE_ENV, ok, prober } from "./sandbox_probe_fixture.ts";

/**
 * Docker as the probe finds it: a daemon that answers with a version, and the limits it reports
 * the host can apply. Its daemon discards a cap the host has no cgroup controller for, whatever
 * the arguments say, so each one it lacks is a cap the run goes without, and is reported.
 */

/** What `docker info` prints of a daemon that can apply every limit, with `over` on top. */
const dockerInfo = (over: Record<string, unknown> = {}) =>
  ok(JSON.stringify({
    ServerVersion: "27.1.0",
    MemoryLimit: true,
    SwapLimit: true,
    PidsLimit: true,
    CpuCfsQuota: true,
    ...over,
  }));

/** The cap a run goes without when `docker info` says its host lacks each limit. */
const DOCKER_FLAGS = {
  MemoryLimit: "memoryBytes",
  SwapLimit: "memorySwap",
  PidsLimit: "processes",
  CpuCfsQuota: "cpus",
} as const;

/** The caps a run on what `probed` offers goes without; it must offer a backend. */
function capsLacking(probed: BackendProbe) {
  const backend = chooseBackend(probed);
  if (backend.kind === "static") throw new Error(`no backend: ${backend.why.join("; ")}`);
  return capsWithout(backend);
}

Deno.test("probe: docker counts only when its daemon answers with a version", async () => {
  const { prober: up, calls } = prober("linux", { docker: dockerInfo() });
  assertEquals((await up.probe()).docker, true);
  assertEquals(calls.find((c) => c.cmd === "docker")?.args, ["info", "--format", "{{json .}}"]);
  const noVersion = prober("linux", { docker: dockerInfo({ ServerVersion: "" }) });
  assertEquals((await noVersion.prober.probe()).docker, false);
  assertEquals((await prober("linux", { docker: ok("garbled") }).prober.probe()).docker, false);
  const down = { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
  assertEquals((await prober("linux", { docker: down }).prober.probe()).docker, false);
});

Deno.test("probe: docker's daemon reports which limits its host can apply", async () => {
  const all = await prober("linux", { docker: dockerInfo() }).prober.probe();
  assertEquals(all.dockerLimits, { memory: true, swap: true, pids: true, cpuQuota: true });
  const some = dockerInfo({ SwapLimit: false, PidsLimit: undefined });
  const lacking = await prober("linux", { docker: some }).prober.probe();
  assertEquals(lacking.dockerLimits, { memory: true, swap: false, pids: false, cpuQuota: true });
});

Deno.test("probe: a limit docker's host lacks, false or left out, is a cap the run goes without", async () => {
  assertEquals(capsLacking(await prober("linux", { docker: dockerInfo() }).prober.probe()), []);
  for (const [flag, cap] of Object.entries(DOCKER_FLAGS)) {
    for (const lacking of [{ [flag]: false }, { [flag]: undefined }]) {
      const probed = await prober("linux", { docker: dockerInfo(lacking) }).prober.probe();
      assertEquals(capsLacking(probed), [cap], JSON.stringify(lacking));
    }
  }
});

Deno.test("probe: docker without a CPU quota runs without --cpus, and reports the CPU cap", async () => {
  const probed = await prober("linux", { docker: dockerInfo({ CpuCfsQuota: false }) }).prober
    .probe();
  const backend = chooseBackend(probed);
  if (backend.kind !== "container") throw new Error(`not a container: ${backend.kind}`);
  assertEquals(capsLacking(probed), ["cpus"]);
  // Docker refuses `--cpus` outright on such a host, so a run carrying it would never start.
  const run = { ...backend, name: "specnaut-sandbox-c" };
  const args = containerArgs(policyOf("container"), run, ["true"]);
  assertEquals(args.includes("--cpus"), false);
  assertEquals(args.includes("--memory"), true);
});

Deno.test("probe: docker without the paged-out bound keeps the memory cap, reported apart", async () => {
  const probed = await prober("linux", { docker: dockerInfo({ SwapLimit: false }) }).prober.probe();
  assertEquals(capsLacking(probed), ["memorySwap"]);
});

/** What `docker version` prints of a server made of the components `names`. */
const dockerVersion = (...names: string[]) =>
  ok(JSON.stringify({ Server: { Components: names.map((Name) => ({ Name, Version: "1" })) } }));

/** The probe of a docker daemon answering `version` to `docker version`. */
const withVersion = (version: ReturnType<typeof ok>) =>
  prober("linux", { "docker info": dockerInfo(), "docker version": version });

Deno.test("probe: a docker daemon that is a podman service is read as one, and not run on", async () => {
  const { prober: p, calls } = withVersion(dockerVersion("Podman Engine"));
  const probed = await p.probe();
  assertEquals([probed.docker, probed.dockerOnPodman], [true, true]);
  const asked = calls.find((c) => c.cmd === "docker" && c.args[0] === "version");
  assertEquals(asked?.args, ["version", "--format", "{{json .}}"]);
  assertEquals(asked?.opts, { env: ENGINE_ENV });
  assertEquals(chooseBackend(probed).kind, "static");
});

Deno.test("probe: the CPUs docker's host has are its NCPU, when that is a count", async () => {
  const cpusOf = async (NCPU: unknown) =>
    (await prober("linux", { docker: dockerInfo({ NCPU }) }).prober.probe()).dockerCpus;
  assertEquals(await cpusOf(1), 1);
  for (const NCPU of [undefined, 0, 1.5, "1", -2]) {
    assertEquals(await cpusOf(NCPU), null, `${NCPU}`);
  }
});

Deno.test("probe: docker's own daemon, or a version that says nothing, is docker's own", async () => {
  const failed = { code: 1, stdout: "", stderr: "" };
  for (const version of [dockerVersion("Engine", "containerd", "runc"), failed, ok("garbled")]) {
    const probed = await withVersion(version).prober.probe();
    assertEquals([probed.docker, probed.dockerOnPodman], [true, false], version.stdout);
  }
});
