import { assertEquals } from "@std/assert";
import { chooseBackend } from "../../src/domain/sandbox.ts";
import type { BackendProbe } from "../../src/domain/sandbox.ts";
import { capsWithout } from "../../src/domain/sandbox_limits.ts";
import { ok, prober } from "./sandbox_probe_fixture.ts";

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
  SwapLimit: "memoryBytes",
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
