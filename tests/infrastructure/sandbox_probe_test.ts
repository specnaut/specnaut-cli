import { assertEquals } from "@std/assert";
import { ENGINE_ENV, IMAGE, ok, prober } from "./sandbox_probe_fixture.ts";

/**
 * What the host offers a sandbox, read from the tools themselves: bubblewrap's version and a trial
 * run, and a trial `sandbox-exec`. Nothing is asked on Windows, and nothing is asked of a tool on
 * an OS where the domain would not use it. Podman's and docker's reports, and the limits each can
 * apply, are `sandbox_probe_podman_test.ts`'s and `sandbox_probe_docker_test.ts`'s.
 */

Deno.test("probe: nothing installed on Linux reads as nothing offered", async () => {
  const { prober: p } = prober("linux", {});
  assertEquals(await p.probe(), {
    os: "linux",
    arch: "x86_64",
    image: IMAGE,
    podman: "absent",
    podmanRemote: false,
    podmanVersion: null,
    podmanLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
    docker: false,
    dockerOnPodman: false,
    dockerLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
    bwrap: "absent",
    bwrapVersion: null,
    bwrapScope: false,
    sandboxExec: false,
  });
});

Deno.test("probe: bubblewrap's version, and a trial run that passes", async () => {
  const { prober: p, calls } = prober("linux", {
    "bwrap --version": ok("bubblewrap 0.9.0\n"),
    "bwrap --unshare-all": ok(),
  });
  const probed = await p.probe();
  assertEquals([probed.bwrap, probed.bwrapVersion], ["usable", "bubblewrap 0.9.0"]);
  const trial = calls.find((c) => c.cmd === "bwrap" && c.args[0] !== "--version");
  assertEquals(trial?.args, [
    "--unshare-all",
    "--unshare-user",
    "--die-with-parent",
    "--ro-bind",
    "/",
    "/",
    "--",
    "/bin/true",
  ]);
});

Deno.test("probe: a trial stopped by the user-namespace restriction says so", async () => {
  for (
    const stderr of [
      "bwrap: setting up uid map: Permission denied\n",
      "bwrap: No permissions to creating new namespace, likely because the kernel does not allow non-privileged user namespaces.\n",
    ]
  ) {
    const { prober: p } = prober("linux", {
      "bwrap --version": ok("bubblewrap 0.9.0\n"),
      "bwrap --unshare-all": { code: 1, stdout: "", stderr },
    });
    assertEquals((await p.probe()).bwrap, "userns_restricted", stderr);
  }
});

Deno.test("probe: a trial that fails for another reason is a failed trial", async () => {
  const { prober: p } = prober("linux", {
    "bwrap --version": ok("bubblewrap 0.9.0\n"),
    "bwrap --unshare-all": {
      code: 1,
      stdout: "",
      stderr: "bwrap: execvp /bin/true: No such file\n",
    },
  });
  assertEquals((await p.probe()).bwrap, "trial_failed");
});

Deno.test("probe: sandbox-exec on macOS, through a trial profile", async () => {
  const { prober: p, calls } = prober("darwin", { "/usr/bin/sandbox-exec": ok() });
  assertEquals((await p.probe()).sandboxExec, true);
  assertEquals(calls.find((c) => c.cmd === "/usr/bin/sandbox-exec")?.args, [
    "-p",
    "(version 1)(allow default)",
    "--",
    "/usr/bin/true",
  ]);
  const failed = prober("darwin", {
    "/usr/bin/sandbox-exec": { code: 71, stdout: "", stderr: "" },
  });
  assertEquals((await failed.prober.probe()).sandboxExec, false);
});

Deno.test("probe: bubblewrap is not asked on macOS, nor sandbox-exec on Linux", async () => {
  const mac = prober("darwin", {});
  await mac.prober.probe();
  assertEquals(mac.calls.some((c) => c.cmd === "bwrap"), false);
  const linux = prober("linux", {});
  await linux.prober.probe();
  assertEquals(linux.calls.some((c) => c.cmd === "/usr/bin/sandbox-exec"), false);
});

Deno.test("probe: on Windows nothing is run at all", async () => {
  const { prober: p, calls } = prober("windows", { docker: ok('{"ServerVersion":"27.1.0"}') });
  const probed = await p.probe();
  assertEquals(calls, []);
  assertEquals([probed.docker, probed.podman, probed.bwrap], [false, "absent", "absent"]);
});

const USABLE_BWRAP = { "bwrap --version": ok("bubblewrap 0.9.0\n"), "bwrap --unshare-all": ok() };

Deno.test("probe: a user scope with pids, memory and cpu delegated is bubblewrap's scope", async () => {
  const delegated = prober("linux", {
    ...USABLE_BWRAP,
    "systemd-run --user": ok("cpuset cpu io memory pids\n"),
  });
  assertEquals((await delegated.prober.probe()).bwrapScope, true);
  const trial = delegated.calls.find((c) => c.cmd === "systemd-run");
  assertEquals(trial?.args.slice(0, 4), ["--user", "--scope", "--quiet", "--collect"]);
  // systemd enables a controller in a scope only when the scope sets a limit through it, as a
  // real run does: a trial scope without them would never see cpu.
  const props = trial!.args.filter((_, i, a) => a[i - 1] === "-p").map((p) => p.split("=")[0]);
  assertEquals(props.sort(), ["CPUQuota", "MemoryMax", "OOMPolicy", "TasksMax"]);
  assertEquals(trial!.args.at(-3), "/bin/sh");
  const partial = prober("linux", { ...USABLE_BWRAP, "systemd-run --user": ok("cpu memory\n") });
  assertEquals((await partial.prober.probe()).bwrapScope, false);
  const refused = { code: 1, stdout: "", stderr: "Failed to connect to bus" };
  const none = prober("linux", { ...USABLE_BWRAP, "systemd-run --user": refused });
  assertEquals((await none.prober.probe()).bwrapScope, false);
});

Deno.test("probe: no user scope is asked for without a usable bubblewrap", async () => {
  const { prober: p, calls } = prober("linux", { "systemd-run --user": ok("cpu memory pids\n") });
  assertEquals((await p.probe()).bwrapScope, false);
  assertEquals(calls.filter((c) => c.cmd === "systemd-run"), []);
  const mac = prober("darwin", { "systemd-run --user": ok("cpu memory pids\n") });
  assertEquals((await mac.prober.probe()).bwrapScope, false);
  assertEquals(mac.calls.filter((c) => c.cmd === "systemd-run"), []);
});

Deno.test("probe: podman and docker are asked with the environment a run starts them with", async () => {
  const { prober: p, calls } = prober("linux", {});
  await p.probe();
  const engines = calls.filter((c) => c.cmd === "podman" || c.cmd === "docker");
  assertEquals(engines.map((c) => [c.cmd, c.opts]), [
    ["podman", { env: ENGINE_ENV }],
    ["docker", { env: ENGINE_ENV }],
  ]);
});
