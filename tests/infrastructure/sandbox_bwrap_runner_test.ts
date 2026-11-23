import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import { bwrapArgs, scopeArgs } from "../../src/domain/sandbox_bwrap_args.ts";
import { SECCOMP_FD, seccompFilter } from "../../src/domain/sandbox_seccomp.ts";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { BwrapRunner } from "../../src/infrastructure/sandbox_bwrap_runner.ts";
import { runnerFor } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import {
  BWRAP,
  COMMAND,
  fakeLauncher,
  IMAGE,
  plantedPrograms,
  POSIX,
  SYSTEMD_RUN,
} from "./sandbox_runner_fixture.ts";

/**
 * Bubblewrap in a systemd user scope: the scope's prefix, then the same shell line and bubblewrap
 * as without one; a scope that did not start means nothing ran, never an uncapped run.
 */

/** The marker the scoped shell line is given: the word after the line's `$0`. */
const markerOf = (args: readonly string[]) => args[args.indexOf("-c") + 3];

/** A launcher whose run makes the marker, as the shell inside a scope that started does. */
function startingScope(code: number) {
  const { launcher, launches } = fakeLauncher(code);
  const scoped: ProcessLauncher = {
    ...launcher,
    start: (spec) => {
      Deno.writeTextFileSync(markerOf(spec.args), "");
      return launcher.start(spec);
    },
  };
  return { launcher: scoped, launches };
}

Deno.test({
  name: "BwrapRunner in a scope: systemd-run with the scope's caps, then the shell line and bwrap",
  ignore: !POSIX,
  fn: async () => {
    const { launcher, launches } = startingScope(5);
    const policy = policyOf("bwrap");
    const runner = new BwrapRunner("x86_64", launcher, "/usr/bin:/bin", BWRAP, SYSTEMD_RUN);
    assertEquals(await runner.run(policy, COMMAND), { kind: "exited", code: 5 });
    const [{ spec }] = launches;
    assertEquals(spec.cmd, SYSTEMD_RUN);
    const line = `: > "$1" || exit 125; shift; exec ${SECCOMP_FD}<&0 </dev/null; exec "$@"`;
    assertEquals(spec.args, [
      ...scopeArgs(policy),
      "/bin/sh",
      "-c",
      line,
      "sh",
      markerOf(spec.args),
      BWRAP,
      ...bwrapArgs(policy, COMMAND),
    ]);
    assertEquals(spec.stdin, seccompFilter("x86_64"));
    assertEquals([spec.env, launches.length], [{ PATH: "/usr/bin:/bin" }, 1]);
  },
});

const BUS = { XDG_RUNTIME_DIR: "/run/user/1000", DBUS_SESSION_BUS_ADDRESS: "unix:path=/b" };

Deno.test({
  name: "BwrapRunner in a scope: systemd-run gets PATH and the user bus, bwrap alone PATH only",
  ignore: !POSIX,
  fn: async () => {
    const policy = policyOf("bwrap");
    const scoped = startingScope(0);
    await new BwrapRunner("x86_64", scoped.launcher, "/usr/bin", BWRAP, SYSTEMD_RUN, BUS).run(
      policy,
      COMMAND,
    );
    assertEquals(scoped.launches[0].spec.env, { PATH: "/usr/bin", ...BUS });
    const bare = fakeLauncher(0);
    await new BwrapRunner("x86_64", bare.launcher, "/usr/bin", BWRAP, null, BUS).run(
      policy,
      COMMAND,
    );
    assertEquals(bare.launches[0].spec.env, { PATH: "/usr/bin" });
  },
});

Deno.test({
  name: "BwrapRunner in a scope: a scope that did not start is not run, with its cause",
  ignore: !POSIX,
  fn: async () => {
    const { launcher } = fakeLauncher(1);
    const runner = new BwrapRunner("x86_64", launcher, "/usr/bin", BWRAP, SYSTEMD_RUN);
    const run = () => runner.run(policyOf("bwrap"), COMMAND);
    await assertRejects(run, SandboxRefused, "systemd user scope did not start");
  },
});

Deno.test({
  name: "BwrapRunner in a scope: the marker's folder is gone after the run",
  ignore: !POSIX,
  fn: async () => {
    const { launcher, launches } = startingScope(0);
    await new BwrapRunner("aarch64", launcher, "/usr/bin", BWRAP, SYSTEMD_RUN).run(
      policyOf("bwrap"),
      COMMAND,
    );
    const marker = markerOf(launches[0].spec.args);
    assert(marker.startsWith("/"), marker);
    assertEquals(await Deno.stat(marker).then(() => "left", () => "gone"), "gone");
  },
});

Deno.test({
  name: "runnerFor: in a scope exactly when the backend says so, each program at its file found",
  ignore: !POSIX,
  fn: async () => {
    await using planted = await plantedPrograms(["bwrap", "systemd-run"]);
    const host = { arch: "x86_64", path: planted.dir, bus: BUS };
    const policy = policyOf("bwrap");
    const scoped = startingScope(0);
    await runnerFor({ kind: "bwrap", scope: true }, scoped.launcher, host).run(policy, COMMAND);
    const [{ spec }] = scoped.launches;
    assertEquals(spec.cmd, planted.at("systemd-run"));
    assertEquals(spec.args[spec.args.indexOf("-c") + 4], planted.at("bwrap"));
    assertEquals(spec.env, { PATH: planted.dir, ...BUS });
    const bare = fakeLauncher(0);
    await runnerFor({ kind: "bwrap", scope: false }, bare.launcher, host).run(policy, COMMAND);
    assertEquals(bare.launches[0].spec.cmd, "/bin/sh");
    assertEquals(bare.launches[0].spec.args[3], planted.at("bwrap"));
  },
});

Deno.test("runnerFor: a program gone from the PATH since the probe is refused, not guessed", async () => {
  const { launcher, launches } = fakeLauncher(0);
  await using planted = await plantedPrograms(["bwrap"]);
  const host = { arch: "x86_64", path: planted.dir, bus: {} };
  const podman = {
    kind: "container",
    engine: "podman",
    image: IMAGE,
    dropped: [],
    cpus: null,
    arch: "x86_64",
  } as const;
  assertThrows(() => runnerFor(podman, launcher, host), SandboxRefused, "podman");
  const scoped = () => runnerFor({ kind: "bwrap", scope: true }, launcher, host);
  assertThrows(scoped, SandboxRefused, "systemd-run");
  assertEquals(launches, []);
});
