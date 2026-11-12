import { assertEquals } from "@std/assert";
import type { SubprocessOptions, SubprocessResult } from "../../src/application/ports.ts";
import type { ImageSource } from "../../src/domain/sandbox_image.ts";
import { HostBackendProber } from "../../src/infrastructure/sandbox_probe.ts";

/**
 * What the host offers a sandbox, read from the tools themselves: podman's own report of rootless
 * and delegated cgroups, a docker daemon that answers, bubblewrap's version and a trial run, and a
 * trial `sandbox-exec`. Nothing is asked on Windows, and nothing is asked of a tool on an OS where
 * the domain would not use it.
 */

const IMAGE: ImageSource = { kind: "pinned", ref: `acme/dev@sha256:${"d".repeat(64)}` };
const NOT_FOUND: SubprocessResult = { code: 127, stdout: "", stderr: "not found" };

type Call = { cmd: string; args: string[] };

function prober(os: string, answers: Record<string, SubprocessResult>) {
  const calls: Call[] = [];
  const run = {
    run(cmd: string, args: string[], _opts?: SubprocessOptions): Promise<SubprocessResult> {
      calls.push({ cmd, args });
      const key = `${cmd} ${args[0]}`;
      return Promise.resolve(answers[key] ?? answers[cmd] ?? NOT_FOUND);
    },
  };
  return {
    calls,
    prober: new HostBackendProber(run, { os, arch: "x86_64" }, () => Promise.resolve(IMAGE)),
  };
}

const ok = (stdout = ""): SubprocessResult => ({ code: 0, stdout, stderr: "" });
const podmanInfo = (rootless: boolean, version: string, controllers: string[]) =>
  ok(JSON.stringify({
    host: { security: { rootless }, cgroupVersion: version, cgroupControllers: controllers },
  }));

Deno.test("probe: nothing installed on Linux reads as nothing offered", async () => {
  const { prober: p } = prober("linux", {});
  assertEquals(await p.probe(), {
    os: "linux",
    arch: "x86_64",
    image: IMAGE,
    podman: "absent",
    podmanCgroups: false,
    docker: false,
    bwrap: "absent",
    bwrapVersion: null,
    sandboxExec: false,
  });
});

Deno.test("probe: rootless podman with pids, memory and cpu delegated on cgroup v2", async () => {
  const all = prober("linux", { podman: podmanInfo(true, "v2", ["cpu", "memory", "pids", "io"]) });
  const probed = await all.prober.probe();
  assertEquals([probed.podman, probed.podmanCgroups], ["rootless", true]);
  const partial = prober("linux", { podman: podmanInfo(true, "v2", ["cpu", "memory"]) });
  assertEquals((await partial.prober.probe()).podmanCgroups, false);
  const v1 = prober("linux", { podman: podmanInfo(true, "v1", ["cpu", "memory", "pids"]) });
  assertEquals((await v1.prober.probe()).podmanCgroups, false);
  const root = prober("linux", { podman: podmanInfo(false, "v2", ["cpu", "memory", "pids"]) });
  assertEquals((await root.prober.probe()).podman, "root");
});

Deno.test("probe: podman whose report is not JSON is not used", async () => {
  const { prober: p } = prober("linux", { podman: ok("garbled") });
  const probed = await p.probe();
  assertEquals([probed.podman, probed.podmanCgroups], ["absent", false]);
});

Deno.test("probe: docker counts only when its daemon answers with a version", async () => {
  assertEquals((await prober("linux", { docker: ok("27.1.0\n") }).prober.probe()).docker, true);
  assertEquals((await prober("linux", { docker: ok("\n") }).prober.probe()).docker, false);
  const down = { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
  assertEquals((await prober("linux", { docker: down }).prober.probe()).docker, false);
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
  const { prober: p, calls } = prober("windows", { docker: ok("27.1.0") });
  const probed = await p.probe();
  assertEquals(calls, []);
  assertEquals([probed.docker, probed.podman, probed.bwrap], [false, "absent", "absent"]);
});
