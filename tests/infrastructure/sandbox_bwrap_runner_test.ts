import { assert, assertEquals, assertRejects } from "@std/assert";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import { bwrapArgs, scopeArgs } from "../../src/domain/sandbox_args.ts";
import { SECCOMP_FD, seccompFilter } from "../../src/domain/sandbox_seccomp.ts";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { BwrapRunner } from "../../src/infrastructure/sandbox_bwrap_runner.ts";
import { runnerFor } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { COMMAND, fakeLauncher, POSIX } from "./sandbox_runner_fixture.ts";

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
    const runner = new BwrapRunner("x86_64", launcher, "/usr/bin:/bin", true);
    assertEquals(await runner.run(policy, COMMAND), { kind: "exited", code: 5 });
    const [{ spec }] = launches;
    const [cmd, ...prefix] = scopeArgs(policy);
    assertEquals(spec.cmd, cmd);
    const line = `: > "$1" || exit 125; shift; exec ${SECCOMP_FD}<&0 </dev/null; exec "$@"`;
    assertEquals(spec.args, [
      ...prefix,
      "/bin/sh",
      "-c",
      line,
      "sh",
      markerOf(spec.args),
      "bwrap",
      ...bwrapArgs(policy, COMMAND),
    ]);
    assertEquals(spec.stdin, seccompFilter("x86_64"));
    assertEquals([spec.env, launches.length], [{ PATH: "/usr/bin:/bin" }, 1]);
  },
});

Deno.test({
  name: "BwrapRunner in a scope: a scope that did not start is not run, with its cause",
  ignore: !POSIX,
  fn: async () => {
    const { launcher } = fakeLauncher(1);
    const runner = new BwrapRunner("x86_64", launcher, "/usr/bin", true);
    const run = () => runner.run(policyOf("bwrap"), COMMAND);
    await assertRejects(run, SandboxRefused, "systemd user scope did not start");
  },
});

Deno.test({
  name: "BwrapRunner in a scope: the marker's folder is gone after the run",
  ignore: !POSIX,
  fn: async () => {
    const { launcher, launches } = startingScope(0);
    await new BwrapRunner("aarch64", launcher, "/usr/bin", true).run(policyOf("bwrap"), COMMAND);
    const marker = markerOf(launches[0].spec.args);
    assert(marker.startsWith("/"), marker);
    assertEquals(await Deno.stat(marker).then(() => "left", () => "gone"), "gone");
  },
});

Deno.test("runnerFor: bubblewrap runs in a scope exactly when the backend says so", () => {
  const { launcher } = fakeLauncher(0);
  const host = { arch: "x86_64", path: "/usr/bin" };
  const scoped = runnerFor({ kind: "bwrap", scope: true }, launcher, host);
  const bare = runnerFor({ kind: "bwrap", scope: false }, launcher, host);
  assertEquals([(scoped as BwrapRunner).scope, (bare as BwrapRunner).scope], [true, false]);
});
