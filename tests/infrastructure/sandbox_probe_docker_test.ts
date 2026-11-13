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
    SecurityOptions: ["name=seccomp,profile=builtin", "name=cgroupns"],
    Architecture: "x86_64",
    KernelVersion: "6.8.0-1017-azure",
    ...over,
  }));

/** What `docker version` prints of a server made of the components `names`. */
const dockerVersion = (...names: string[]) =>
  ok(JSON.stringify({ Server: { Components: names.map((Name) => ({ Name, Version: "1" })) } }));

/** A docker daemon of its own answering `info`, and its version naming docker's components. */
const daemon = (info: ReturnType<typeof ok>) => ({
  "docker info": info,
  "docker version": dockerVersion("Engine", "containerd", "runc"),
});

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
  const { prober: up, calls } = prober("linux", daemon(dockerInfo()));
  assertEquals((await up.probe()).docker, true);
  assertEquals(calls.find((c) => c.cmd === "docker")?.args, ["info", "--format", "{{json .}}"]);
  const noVersion = prober("linux", daemon(dockerInfo({ ServerVersion: "" })));
  assertEquals((await noVersion.prober.probe()).docker, false);
  assertEquals((await prober("linux", { docker: ok("garbled") }).prober.probe()).docker, false);
  const down = { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
  assertEquals((await prober("linux", { docker: down }).prober.probe()).docker, false);
});

Deno.test("probe: docker's daemon reports which limits its host can apply", async () => {
  const all = await prober("linux", daemon(dockerInfo())).prober.probe();
  assertEquals(all.dockerLimits, { memory: true, swap: true, pids: true, cpuQuota: true });
  const some = dockerInfo({ SwapLimit: false, PidsLimit: undefined });
  const lacking = await prober("linux", daemon(some)).prober.probe();
  assertEquals(lacking.dockerLimits, { memory: true, swap: false, pids: false, cpuQuota: true });
});

Deno.test("probe: a limit docker's host lacks, false or left out, is a cap the run goes without", async () => {
  assertEquals(capsLacking(await prober("linux", daemon(dockerInfo())).prober.probe()), []);
  for (const [flag, cap] of Object.entries(DOCKER_FLAGS)) {
    for (const lacking of [{ [flag]: false }, { [flag]: undefined }]) {
      const probed = await prober("linux", daemon(dockerInfo(lacking))).prober.probe();
      assertEquals(capsLacking(probed), [cap], JSON.stringify(lacking));
    }
  }
});

Deno.test("probe: docker without a CPU quota runs without --cpus, and reports the CPU cap", async () => {
  const probed = await prober("linux", daemon(dockerInfo({ CpuCfsQuota: false }))).prober
    .probe();
  const backend = chooseBackend(probed);
  if (backend.kind !== "container") throw new Error(`not a container: ${backend.kind}`);
  assertEquals(capsLacking(probed), ["cpus"]);
  // Docker refuses `--cpus` outright on such a host, so a run carrying it would never start.
  const run = { ...backend, name: "specnaut-sandbox-c", seccomp: "/tmp/specnaut-engine-c/p.json" };
  const args = containerArgs(policyOf("container"), run, ["true"]);
  assertEquals(args.includes("--cpus"), false);
  assertEquals(args.includes("--memory"), true);
});

Deno.test("probe: docker without the paged-out bound keeps the memory cap, reported apart", async () => {
  const probed = await prober("linux", daemon(dockerInfo({ SwapLimit: false }))).prober.probe();
  assertEquals(capsLacking(probed), ["memorySwap"]);
});

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
    (await prober("linux", daemon(dockerInfo({ NCPU }))).prober.probe()).dockerCpus;
  assertEquals(await cpusOf(1), 1);
  for (const NCPU of [undefined, 0, 1.5, "1", -2]) {
    assertEquals(await cpusOf(NCPU), null, `${NCPU}`);
  }
});

Deno.test("probe: docker's own daemon is one whose components can be read and name no podman", async () => {
  const probed = await withVersion(dockerVersion("Engine", "containerd", "runc")).prober.probe();
  assertEquals([probed.docker, probed.dockerOnPodman], [true, false]);
  assertEquals(chooseBackend(probed).kind, "container");
});

const UNREAD_WHY = "container: no rootless podman, and docker's components could not be read, " +
  "so it may be a podman service";

for (
  const [what, version] of [
    ["fails", { code: 1, stdout: "", stderr: "Error response from daemon" }],
    ["is not JSON", ok("garbled")],
    ["has no component list", ok(JSON.stringify({ Server: { Version: "27.1.0" } }))],
  ] as const
) {
  Deno.test(`probe: docker whose version ${what} may be a podman service, and is not run on`, async () => {
    const probed = await withVersion(version).prober.probe();
    assertEquals([probed.docker, probed.dockerOnPodman], [true, null]);
    const chosen = chooseBackend(probed);
    assertEquals(chosen.kind === "static" && chosen.why[0], UNREAD_WHY);
  });
}

Deno.test("probe: docker filters syscalls only where its security options name a confining seccomp", async () => {
  const filterOf = async (SecurityOptions: unknown) =>
    (await prober("linux", daemon(dockerInfo({ SecurityOptions }))).prober.probe()).dockerSeccomp;
  assertEquals(await filterOf(["name=seccomp,profile=builtin"]), true);
  assertEquals(await filterOf(["name=apparmor", "name=seccomp,profile=default"]), true);
  assertEquals(await filterOf(["name=seccomp,profile=unconfined"]), false);
  for (const options of [["name=apparmor", "name=rootless"], [], undefined, "name=seccomp"]) {
    assertEquals(await filterOf(options), false, JSON.stringify(options));
  }
});

Deno.test("probe: docker without a syscall filter is not run on, and says why", async () => {
  const off = dockerInfo({ SecurityOptions: ["name=seccomp,profile=unconfined"] });
  const chosen = chooseBackend(await prober("linux", daemon(off)).prober.probe());
  assertEquals(
    chosen.kind === "static" && chosen.why[0],
    "container: no rootless podman, and docker runs containers without a syscall filter (seccomp)",
  );
});

Deno.test("probe: docker's platform is its daemon's Architecture and KernelVersion", async () => {
  const platformOf = async (over: Record<string, unknown>) =>
    (await prober("linux", daemon(dockerInfo(over))).prober.probe()).dockerPlatform;
  assertEquals(await platformOf({}), { arch: "x86_64", kernel: "6.8.0-1017-azure" });
  const desktop = { Architecture: "aarch64", KernelVersion: "6.10.14-linuxkit" };
  assertEquals(await platformOf(desktop), { arch: "aarch64", kernel: "6.10.14-linuxkit" });
  for (const unread of [undefined, "", 64]) {
    const over = { Architecture: unread, KernelVersion: unread };
    assertEquals(await platformOf(over), { arch: null, kernel: null }, `${unread}`);
  }
});
